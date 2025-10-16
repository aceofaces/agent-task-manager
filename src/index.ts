#!/usr/bin/env node

/**
 * Agent Task Manager - MCP Server
 * Workflow orchestrator wrapping Linear and Notion with task management semantics
 */

import { config as loadEnv } from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
  ResourceLink,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import { WorkflowOrchestrator } from './orchestrator/workflow-orchestrator.js';
import {
  ConfigSchema,
  CreateTaskInputSchema,
  BatchCreateTasksInputSchema,
  DecomposeTaskInputSchema,
  UpdateTaskInputSchema,
  ExtractLessonInputSchema,
  TaskLookupSchema,
  LessonSearchSchema,
  ProjectsConfigSchema,
  ListTasksInputSchema,
  QueryTasksInputSchema,
  GetReadyTasksInputSchema,
} from './types.js';
import type { Config } from './types.js';
import { zodToJson } from './utils/zod-to-json.js';
import { formatTaskOutput, formatTaskTree } from './utils/output-formatter.js';
import {
  listResources,
  listResourceTemplates,
  readResource,
} from './resources.js';

loadEnv();

const SERVER_INSTRUCTIONS = `Core rules:
- JSON only—no natural language wrappers
- Fibonacci effort (1,2,3,5,8,13,21). Effort >3 needs uncertainties + decomposition
- Resolve uncertainties before marking done
- Reference tasks by Linear key (format: ORG-###, e.g. NON-123)

Workflow:
1. create_task → capture work
2. update_task → track status/lessons/uncertainties (call before/after work)
3. decompose_task → split effort >3 tasks before execution
4. list_tasks/query_task → discover/bulk-modify tasks

Resources: help://quickstart (start here), config://server, help://effort-calibration, help://tool-selection`;

/**
 * Load configuration from environment variables
 */
function loadConfig(): Config {
  const linearApiKey = process.env.LINEAR_API_KEY;
  const linearTeamId = process.env.LINEAR_TEAM_ID;
  const storageBackendEnv = process.env.STORAGE_BACKEND || 'basic-memory';
  const storageBackend: 'notion' | 'basic-memory' = storageBackendEnv === 'notion' ? 'notion' : 'basic-memory';

  if (!linearApiKey || !linearTeamId) {
    throw new Error(
      'Missing required environment variables: LINEAR_API_KEY, LINEAR_TEAM_ID'
    );
  }

  // Parse project mappings from JSON env var
  const projectMappingsJson = process.env.PROJECT_MAPPINGS || '{}';
  let projectMappingsRaw: unknown = {};
  try {
    projectMappingsRaw = JSON.parse(projectMappingsJson);
  } catch (error) {
    console.error('Failed to parse PROJECT_MAPPINGS:', error);
    throw new Error('PROJECT_MAPPINGS must be valid JSON');
  }

  const projects = ProjectsConfigSchema.parse(projectMappingsRaw ?? {});

  const projectKeys = Object.keys(projects);
  let defaultProject = process.env.DEFAULT_PROJECT?.trim();

  if (defaultProject && !projects[defaultProject]) {
    console.warn(
      `DEFAULT_PROJECT "${defaultProject}" is not present in PROJECT_MAPPINGS. Falling back to auto-detection.`
    );
    defaultProject = undefined;
  }

  if (!defaultProject && projectKeys.length === 1) {
    [defaultProject] = projectKeys;
  }

  // Build config object based on storage backend
  const configData: Partial<Config> & {
    linear: Config['linear'];
    storageBackend: Config['storageBackend'];
    projects: Config['projects'];
    defaultProject?: Config['defaultProject'];
    basicMemory?: Config['basicMemory'];
    notion?: Config['notion'];
  } = {
    linear: {
      apiKey: linearApiKey,
      teamId: linearTeamId,
    },
    storageBackend,
    projects,
    defaultProject,
  };

  if (storageBackend === 'basic-memory') {
    const basicMemoryRootPath = process.env.BASIC_MEMORY_ROOT_PATH;
    const basicMemoryGlobalPath = process.env.BASIC_MEMORY_GLOBAL_PATH;

    if (!basicMemoryRootPath) {
      throw new Error(
        'BASIC_MEMORY_ROOT_PATH is required when STORAGE_BACKEND is "basic-memory"'
      );
    }

    configData.basicMemory = {
      rootPath: basicMemoryRootPath,
      globalPath: basicMemoryGlobalPath,
    };
  } else {
    // Notion backend
    const notionApiKey = process.env.NOTION_API_KEY;

    if (!notionApiKey) {
      throw new Error(
        'NOTION_API_KEY is required when STORAGE_BACKEND is "notion". Set STORAGE_BACKEND=basic-memory to use local file storage instead.'
      );
    }

    configData.notion = {
      apiKey: notionApiKey,
      globalLessonsDbId: process.env.NOTION_GLOBAL_LESSONS_DB_ID,
      globalLessonsDataSourceId: process.env.NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID,
      globalDecisionsDbId: process.env.NOTION_GLOBAL_DECISIONS_DB_ID,
      globalDecisionsDataSourceId: process.env.NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID,
    };
  }

  const config = ConfigSchema.parse(configData);

  return config;
}

type ConfigState =
  | { status: 'unloaded' }
  | { status: 'ready'; config: Config }
  | { status: 'error'; error: Error };

let configState: ConfigState = { status: 'unloaded' };
let orchestratorInstance: WorkflowOrchestrator | null = null;
let orchestratorInitialization: Promise<WorkflowOrchestrator> | null = null;

function ensureConfig(): Config {
  if (configState.status === 'ready') {
    return configState.config;
  }

  if (configState.status === 'error') {
    throw configState.error;
  }

  try {
    const config = loadConfig();
    configState = { status: 'ready', config };
    return config;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    configState = { status: 'error', error: normalizedError };
    throw normalizedError;
  }
}

function tryGetConfig(): { config?: Config; error?: Error } {
  try {
    return { config: ensureConfig() };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function ensureOrchestrator(): Promise<WorkflowOrchestrator> {
  if (orchestratorInstance) {
    return orchestratorInstance;
  }

  if (orchestratorInitialization) {
    return orchestratorInitialization;
  }

  orchestratorInitialization = Promise.resolve().then(() => {
    const config = ensureConfig();
    const uncertaintyModeEnv = (process.env.UNCERTAINTY_RESOLUTION_MODE || 'warn').toLowerCase();
    const uncertaintyMode: 'off' | 'warn' | 'block' =
      uncertaintyModeEnv === 'off' || uncertaintyModeEnv === 'block'
        ? uncertaintyModeEnv
        : 'warn';

    const instance = new WorkflowOrchestrator(config, { uncertaintyMode });
    orchestratorInstance = instance;
    return instance;
  });

  try {
    return await orchestratorInitialization;
  } catch (error) {
    orchestratorInitialization = null;
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    throw normalizedError;
  }
}

/**
 * Main server setup
 */
async function main() {
  const server = new Server(
    {
      name: 'agent-task-manager',
      title: 'Agent Task Manager',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  const toolDefinitions = [
    {
      name: 'create_task',
      title: 'Create Task',
      description: `Capture work. Effort ≥3 recommended (persistent). For effort <3, use TodoWrite (session-local).

Effort >3 → uncertainties required + decompose before execution.

Note: project auto-selects when configured

@example {title: "Add OAuth", effort: 5, uncertainties: ["PKCE vs implicit?"]}`,
      inputSchema: zodToJson(CreateTaskInputSchema),
    },
    {
      name: 'batch_create_tasks',
      title: 'Batch Create Tasks',
      description: `Create multiple tasks. Use dependsOnBatchIndex (0-indexed) for internal dependencies.

@example Independent tasks
{"tasks":[{"title":"Research API","effort":2},{"title":"Design schema","effort":3}]}

@example With dependency (Task 2 → Task 1)
{"tasks":[{"title":"Research","effort":2},{"title":"Implement","effort":5,"dependsOnBatchIndex":[0],"uncertainties":["API stability"]}]}

@example Sequential chain
{"tasks":[{"title":"Design","effort":3},{"title":"Implement","effort":5,"dependsOnBatchIndex":[0]},{"title":"Document","effort":2,"dependsOnBatchIndex":[1]}]}`,
      inputSchema: zodToJson(BatchCreateTasksInputSchema),
    },
    {
      name: 'decompose_task',
      title: 'Decompose Task',
      description: `Split tasks into sequenced subtasks. Same sequenceOrder → parallel execution.

@example Sequential
{"taskID":"NON-101","subtasks":[{"title":"Research","effort":2,"sequenceOrder":1},{"title":"Build","effort":3,"sequenceOrder":2}]}

@example Parallel
{"taskID":"NON-101","subtasks":[{"title":"Implement API","effort":3,"sequenceOrder":2},{"title":"Write docs","effort":2,"sequenceOrder":2}]}`,
      inputSchema: zodToJson(DecomposeTaskInputSchema),
    },
    {
      name: 'update_task',
      title: 'Update Task',
      description: `Update tasks (set/add/remove/resolve). Call before/after work.

@example Mark in progress
{"tasks":[{"taskID":"NON-200","set":{"status":"in-progress"}}]}

@example Resolve + add lesson
{"tasks":[{"taskID":"NON-200","resolve":{"uncertainties":[{"title":"Risk","resolution":"Handled"}]},"add":{"lessonsLearned":[{"content":"Automate rollbacks"}]}}]}`,
      inputSchema: zodToJson(UpdateTaskInputSchema),
    },
    {
      name: 'extract_lesson',
      title: 'Extract Lesson',
      description: `Publish lesson to Notion. Categories: pattern, decision, gotcha, solution, performance, balance.

@example Project lesson
{"taskID":"NON-456","lesson":{"content":"Index slow paths","category":"performance","tags":["db"]},"scope":"project"}

@example Global
{"taskID":"NON-456","lesson":{"content":"Document escalations"},"scope":"global"}`,
      inputSchema: zodToJson(ExtractLessonInputSchema),
    },
    {
      name: 'get_task',
      title: 'Get Task',
      description: `Fetch full task details with optional tree visualization and output formatting.

Returns: Linear key, status, metadata, uncertainties, lessons, subtasks

@example Single task
{taskID: 'NON-123'}

@example Multiple tasks
{taskID: ['NON-123', 'NON-124']}

@example With subtask tree
{taskID: 'NON-123', includeTree: true}

@example Compact output
{taskID: 'NON-123', output: 'compact'}

Output modes: compact (ID/title only), standard (default), detailed (full metadata)`,
      inputSchema: zodToJson(TaskLookupSchema),
    },
    {
      name: 'search_lessons',
      title: 'Search Lessons',
      description: `Search lessons in Notion. Optional: project filter`,
      inputSchema: zodToJson(LessonSearchSchema),
    },
    {
      name: 'get_ready_tasks',
      title: 'Get Ready Tasks',
      description: `Find tasks ready to start (status=todo/backlog, no blockers, uncertainties resolved for effort >3).

Output modes: compact (IDs only), standard (default), detailed (full info)

@example Get next 5 tasks
{limit: 5}

@example Compact view
{limit: 10, output: 'compact'}`,
      inputSchema: zodToJson(GetReadyTasksInputSchema),
    },
    {
      name: 'list_tasks',
      title: 'List Tasks',
      description: `Discover tasks with filters. Use filter.ready for actionable work.

Filters: project, status_in, labels_has_every, has_unresolved_uncertainties, ready
Pagination: limit/after
Output modes: compact, standard (default), detailed

@example With compact output
{filter: {status_in: ['todo']}, limit: 10, output: 'compact'}`,
      inputSchema: zodToJson(ListTasksInputSchema),
    },
    {
      name: 'query_task',
      title: 'Query Task',
      description: `Filter + bulk update tasks (always provide limit).

Same filters as list_tasks. Use for: bulk status/label changes, uncertainty resolution`,
      inputSchema: zodToJson(QueryTasksInputSchema),
    },
  ];

  /**
   * List available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(ListResourcesRequestSchema, () => {
    const { config } = tryGetConfig();
    return listResources(config);
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => listResourceTemplates());
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const { uri } = request.params;
    const { config, error } = tryGetConfig();

    if (uri === 'config://server' && !config) {
      const details = error?.message ?? 'Server configuration is missing required environment variables.';
      throw new McpError(ErrorCode.InternalError, details);
    }

    return readResource(uri, config);
  });

  /**
   * Handle tool calls
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    let orchestrator: WorkflowOrchestrator;
    try {
      orchestrator = await ensureOrchestrator();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize workflow orchestrator: ${message}`
      );
    }

    try {
      switch (name) {
        case 'create_task': {
          const input = CreateTaskInputSchema.parse(args);
          const task = await orchestrator.createTask(input);
          const linearKey = task.linearIssueKey ?? task.taskID;
          const needsDecomposition = task.effort > 3;
          const uncertaintyCount = task.uncertainties?.length ?? 0;
          const hasHighUncertainties = uncertaintyCount >= 4;

          const content: Array<TextContent | ResourceLink> = [
            makeText(`✅ Created ${linearKey}: ${task.title}`),
            makeTaskLink(linearKey, task.title),
          ];

          const warnings: string[] = [];

          // High uncertainty warning with teaching
          if (hasHighUncertainties) {
            const uncertaintyWarning = `⚠️ Task has ${uncertaintyCount} uncertainties.

Consider:
• **Spike tasks**: Create separate research tasks (effort 1-2) to resolve each uncertainty
• **Group uncertainties**: Cluster related unknowns into single investigation tasks
• **Document assumptions**: If uncertainties are acceptable risks, document in task description

High uncertainty tasks benefit from upfront research.`;
            content.push(makeText(uncertaintyWarning));
            warnings.push(`Task has ${uncertaintyCount} uncertainties - consider research spike tasks`);
          }

          // Decomposition warning with teaching
          if (needsDecomposition) {
            const decompWarning = `⚠️ Effort ${task.effort} requires decomposition before execution.

Consider:
• **Immediate decomposition**: Use decompose_task if subtasks are clear
• **Research first**: Create research spike tasks (effort 1-2) to resolve uncertainties
• **Refine uncertainties**: Add more details via update_task before decomposing

Decompose high-effort tasks before marking them in-progress.`;
            content.push(makeText(decompWarning));
            warnings.push('Task requires decomposition before execution');
          }

          const structuredContent = {
            taskCreated: task,
            warnings: warnings.length > 0 ? warnings : undefined,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'batch_create_tasks': {
          const input = BatchCreateTasksInputSchema.parse(args);
          const tasks = await orchestrator.batchCreateTasks(input);

          const needsDecomp = tasks.filter(t => t.effort > 3);
          const lowEffortTasks = tasks.filter(t => t.effort <= 3);

          const content: Array<TextContent | ResourceLink> = [
            makeText(`✅ Batch created ${tasks.length} task(s)`),
          ];

          const warnings: string[] = [];

          // Teaching for mixed complexity batches
          if (needsDecomp.length > 0 && lowEffortTasks.length > 0) {
            const mixedComplexityWarning = `⚠️ ${needsDecomp.length} of ${tasks.length} task(s) require decomposition.

Consider:
• **Prioritize low-effort tasks**: Start with effort ≤3 tasks while planning high-effort decomposition
• **Sequential decomposition**: Decompose tasks in dependency order
• **Batch by complexity**: Group similar decomposition patterns

Decompose high-effort tasks before marking them in-progress.`;
            content.push(makeText(mixedComplexityWarning));
            warnings.push(`${needsDecomp.length} task(s) require decomposition before execution`);
          } else if (needsDecomp.length > 0) {
            // All tasks need decomposition
            const allNeedDecompWarning = `⚠️ All ${needsDecomp.length} task(s) require decomposition.

Consider:
• **Sequential decomposition**: Decompose in dependency order to maintain clarity
• **Parallel planning**: If tasks are independent, decompose in parallel
• **Common patterns**: Look for shared subtask structures across tasks

Plan decomposition strategy before execution.`;
            content.push(makeText(allNeedDecompWarning));
            warnings.push('All tasks require decomposition before execution');
          }

          // Add resource links for first 5 tasks
          tasks.slice(0, 5).forEach((task) => {
            const key = task.linearIssueKey ?? task.taskID;
            content.push(makeTaskLink(key, task.title));
          });

          if (tasks.length > 5) {
            content.push(makeText(`... and ${tasks.length - 5} more task(s)`));
          }

          const structuredContent = {
            tasksCreated: tasks,
            totalCreated: tasks.length,
            warnings: warnings.length > 0 ? warnings : undefined,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'decompose_task': {
          const input = DecomposeTaskInputSchema.parse(args);
          const subtasks = await orchestrator.decomposeTask(input);
          const content: Array<TextContent | ResourceLink> = [
            makeText(`✅ Created ${subtasks.length} subtasks for ${input.taskID}.`),
          ];

          subtasks.slice(0, 3).forEach((subtask) => {
            const subKey = subtask.linearIssueKey ?? subtask.taskID;
            content.push(makeTaskLink(subKey, subtask.title));
          });

          const structuredContent = {
            parentTaskID: input.taskID,
            tasksCreated: subtasks,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'update_task': {
          const input = UpdateTaskInputSchema.parse(args);
          const tasks = await orchestrator.updateTask(input);

          const content: Array<TextContent | ResourceLink> = [];
          const warnings: string[] = [];

          // Build success message
          if (tasks.length === 1) {
            const task = tasks[0];
            const key = task.linearIssueKey ?? task.taskID;
            content.push(makeText(`✅ Updated ${key}: status ${task.status}.`));
            content.push(makeTaskLink(key, task.title));

            // Teaching for specific status transitions
            const updateOp = input.tasks[0];
            const newStatus = updateOp.set?.status;

            // Starting work
            if (newStatus === 'in-progress') {
              const uncertaintyCount = task.uncertainties?.length ?? 0;
              if (uncertaintyCount > 0) {
                const startingWorkWarning = `ℹ️ Starting work with ${uncertaintyCount} uncertainties.

Consider:
• **Document discoveries**: Use add: {lessonsLearned: [...]} as you resolve unknowns
• **Update uncertainties**: Resolve them with resolve: {uncertainties: [...]} when answered
• **Track assumptions**: Note any assumptions made during implementation

Resolving uncertainties improves future effort estimation.`;
                content.push(makeText(startingWorkWarning));
              }
            }

            // Completing work
            if (newStatus === 'done') {
              const unresolvedUncertainties = task.uncertainties?.filter(u => !u.resolvedAt) ?? [];
              const hasLessons = (task.lessonsLearned?.length ?? 0) > 0;

              if (unresolvedUncertainties.length > 0) {
                warnings.push(`Task marked done with ${unresolvedUncertainties.length} unresolved uncertainties`);
              }

              if (!hasLessons && task.effort > 2) {
                const completionReminder = `ℹ️ Task completed. Consider capturing lessons learned.

Consider:
• **What worked well**: Patterns or approaches that were effective
• **What was unexpected**: Surprises that changed the approach
• **What to remember**: Key insights for similar future tasks

Use add: {lessonsLearned: [{content: "...", category: "..."}]} to capture insights.`;
                content.push(makeText(completionReminder));
              }
            }
          } else {
            content.push(makeText(`✅ Updated ${tasks.length} tasks.`));
          }

          const structuredContent = {
            tasks,
            warnings: warnings.length > 0 ? warnings : undefined,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'extract_lesson': {
          const input = ExtractLessonInputSchema.parse(args);
          await orchestrator.extractLesson(input);
          const content: Array<TextContent> = [
            makeText(`✅ Lesson captured for ${input.taskID}.`),
          ];
          const structuredContent = {
            taskID: input.taskID,
            lesson: input.lesson,
            scope: input.scope ?? 'project',
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'get_task': {
          const input = TaskLookupSchema.parse(args);
          const { tasks, tree } = await orchestrator.getTaskDetails(input.taskID, input.includeTree);

          if (tasks.length === 0) {
            throw new McpError(ErrorCode.InvalidRequest, `No tasks found`);
          }

          const content: Array<TextContent | ResourceLink> = [];

          if (input.includeTree && tree && tree.size > 0) {
            // Format with tree visualization
            for (const task of tasks) {
              const treeText = formatTaskTree(task, tree);
              content.push(makeText(treeText));
            }
          } else {
            // Format with specified output mode
            const outputMode = input.output ?? 'detailed';
            const formattedText = formatTaskOutput(tasks, outputMode);
            content.push(makeText(formattedText));
          }

          // Add resource links
          tasks.forEach((task) => {
            const key = task.linearIssueKey ?? task.taskID;
            content.push(makeTaskLink(key, task.title));
          });

          const structuredContent = {
            tasks,
            includeTree: input.includeTree,
            treeSize: tree ? Array.from(tree.values()).flat().length : 0,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'search_lessons': {
          const { query, project } = LessonSearchSchema.parse(args);
          const results = await orchestrator.searchLessons(query, project);
          const content: Array<TextContent> = [
            makeText(`🔎 Found ${results.length} lesson(s) for "${query}"${project ? ` in ${project}` : ''}.`),
          ];
          const structuredContent = {
            query,
            project,
            results,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'get_ready_tasks': {
          const input = GetReadyTasksInputSchema.parse(args);
          const tasks = await orchestrator.getReadyTasks(input.limit);
          const outputMode = input.output ?? 'standard';

          const formattedText = formatTaskOutput(tasks, outputMode);

          const content: Array<TextContent | ResourceLink> = [
            makeText(`✅ Found ${tasks.length} ready task(s)${input.limit && tasks.length === input.limit ? ' (limit reached)' : ''}:\n\n${formattedText}`),
          ];

          // Add resource links for compact/standard modes
          if (outputMode !== 'detailed') {
            tasks.slice(0, 5).forEach((task) => {
              const key = task.linearIssueKey ?? task.taskID;
              content.push(makeTaskLink(key, task.title));
            });
          }

          const structuredContent = {
            tasks,
            count: tasks.length,
            outputMode,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'list_tasks': {
          const input = ListTasksInputSchema.parse(args);
          const { tasks, pageInfo } = await orchestrator.listTasks(input);
          const outputMode = input.output ?? 'standard';
          const summaryEmoji = input.filter?.ready ? '✅' : '📋';
          const summaryLabel = input.filter?.ready ? 'ready task(s) returned' : 'task(s) returned';

          const formattedText = formatTaskOutput(tasks, outputMode);

          const content: Array<TextContent | ResourceLink> = [
            makeText(
              `${summaryEmoji} ${tasks.length} ${summaryLabel}.${pageInfo.hasNextPage ? ' More available.' : ''}\n\n${formattedText}`
            ),
          ];

          // Add resource links for compact/standard modes
          if (outputMode !== 'detailed') {
            tasks.slice(0, 5).forEach((task) => {
              const key = task.linearIssueKey ?? task.taskID;
              content.push(makeTaskLink(key, task.title));
            });
          }

          const structuredContent = {
            tasks,
            pageInfo,
            outputMode,
          };

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        case 'query_task': {
          const input = QueryTasksInputSchema.parse(args);
          const result = await orchestrator.queryTasks(input);

          const content: Array<TextContent | ResourceLink> = [
            makeText(`🛠️ Matched ${result.matched} task(s); updated ${result.updated}.`),
          ];
          result.tasks.slice(0, 5).forEach((task) => {
            const key = task.linearIssueKey ?? task.taskID;
            content.push(makeTaskLink(key, task.title));
          });

          const structuredContent = result;

          return {
            content,
            structuredContent,
          } satisfies CallToolResult;
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  /**
   * Start server
   */
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Agent Task Manager MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
const makeText = (text: string): TextContent => ({ type: 'text', text });

const makeTaskLink = (taskID: string, title: string): ResourceLink => ({
  type: 'resource_link',
  uri: `task://${taskID}`,
  name: taskID,
  title,
  annotations: {
    audience: ['assistant'],
    priority: 1,
  },
});
