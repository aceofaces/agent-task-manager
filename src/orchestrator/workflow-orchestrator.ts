import { ProjectResolver } from '../domain/projects/project-resolver.js';
import {
  assertSubtaskEffort,
  assertValidEffort,
  needsDecomposition,
  validateEffortReason,
} from '../domain/effort/effort-policy.js';
import {
  UncertaintyPolicy,
  type UncertaintyResolutionMode,
} from '../domain/uncertainty/uncertainty-policy.js';
import { filterTasks } from '../domain/tasks/task-filters.js';
import { applyTaskUpdates } from '../domain/tasks/task-updates.js';
import { isEntireTreeDone } from '../domain/tasks/task-tree.js';
import { LinearService } from '../integrations/linear/service.js';
import { NotionService } from '../integrations/notion/service.js';
import { BasicMemoryService } from '../integrations/basic-memory/service.js';
import type { KnowledgeStorageService, SearchResult } from '../integrations/storage-service.js';
import type {
  Config,
  CreateTaskInput,
  BatchCreateTasksInput,
  DecomposeTaskInput,
  ExtractLessonInput,
  ListTasksInput,
  QueryTasksInput,
  ResolveUncertaintyInput,
  Task,
  Uncertainty,
  UpdateTaskInput,
  NotionProjectMapping,
  BasicMemoryProjectMapping,
} from '../types.js';

type OrchestratorLogger = Pick<typeof console, 'log' | 'warn' | 'error'>;

export class WorkflowOrchestrator {
  private linear: LinearService;
  private knowledge: KnowledgeStorageService;
  private projectResolver: ProjectResolver;
  private uncertaintyPolicy: UncertaintyPolicy;
  private logger: OrchestratorLogger;

  readonly uncertaintyMode: UncertaintyResolutionMode;

  constructor(
    config: Config,
    options: {
      uncertaintyMode?: UncertaintyResolutionMode;
      linearService?: LinearService;
      knowledgeService?: KnowledgeStorageService;
      logger?: OrchestratorLogger;
    } = {}
  ) {
    this.logger = options.logger ?? console;
    this.linear =
      options.linearService ??
      new LinearService(config.linear.apiKey, config.linear.teamId, config.projects);

    // Initialize knowledge storage service based on backend configuration
    if (options.knowledgeService) {
      this.knowledge = options.knowledgeService;
    } else {
      const storageBackend = config.storageBackend || 'notion';

      if (storageBackend === 'basic-memory') {
        if (!config.basicMemory) {
          throw new Error('basicMemory configuration required when storageBackend is "basic-memory"');
        }

        // Extract basic-memory project mappings
        const bmProjects: Record<string, BasicMemoryProjectMapping> = {};
        for (const [key, mapping] of Object.entries(config.projects)) {
          if ('path' in mapping) {
            bmProjects[key] = mapping;
          }
        }

        this.knowledge = new BasicMemoryService({
          rootPath: config.basicMemory.rootPath,
          globalPath: config.basicMemory.globalPath,
          projects: bmProjects,
        });
        this.logger.log('📝 Using basic-memory for knowledge storage');
      } else {
        // Default to Notion
        if (!config.notion) {
          throw new Error('notion configuration required when storageBackend is "notion"');
        }

        // Extract notion project mappings
        const notionProjects: Record<string, NotionProjectMapping> = {};
        for (const [key, mapping] of Object.entries(config.projects)) {
          if ('notionLessonsDbId' in mapping) {
            notionProjects[key] = mapping;
          }
        }

        this.knowledge = new NotionService(
          config.notion.apiKey,
          notionProjects,
          config.notion.globalLessonsDbId,
          config.notion.globalDecisionsDbId,
          config.notion.globalLessonsDataSourceId,
          config.notion.globalDecisionsDataSourceId
        );
        this.logger.log('📝 Using Notion for knowledge storage');
      }
    }

    this.projectResolver = new ProjectResolver(config, this.logger);

    const mode = options.uncertaintyMode ?? 'warn';
    this.uncertaintyPolicy = new UncertaintyPolicy(mode, this.logger);
    this.uncertaintyMode = mode;
  }

  /**
   * Create a new task with effort validation and uncertainty policy enforcement
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const projectKey = this.projectResolver.resolve(input.project);
    const createInput =
      projectKey && projectKey !== input.project ? { ...input, project: projectKey } : input;

    assertValidEffort(createInput.effort);
    this.uncertaintyPolicy.validateForCreation(
      createInput.title,
      createInput.effort,
      createInput.uncertainties ?? []
    );

    // Validate effort reason for high-effort tasks
    const effortReasonWarning = validateEffortReason(createInput.effort, createInput.effortReason);
    if (effortReasonWarning) {
      this.logger.log(effortReasonWarning);
    }

    // Warn for low-effort tasks (scope guidance)
    if (createInput.effort < 3) {
      this.logger.log(`⚠️ Effort ${createInput.effort} task created. Consider TodoWrite for session-local work.`);
    }

    const task = await this.linear.createTask(createInput);

    if (needsDecomposition(createInput.effort)) {
      const issueKey = task.linearIssueKey ?? task.taskID;
      this.logger.log(
        `⚠️  Task ${issueKey} requires decomposition before work can begin (effort: ${String(
          createInput.effort
        )})`
      );

      if (createInput.uncertainties && createInput.uncertainties.length >= 3) {
        this.logger.log({
          type: 'text',
          text: `⚠️ High uncertainty count (${createInput.uncertainties.length})

Suggested approach:
• Create research spike tasks to resolve uncertainties
• Decompose after research completes
• Document assumptions if uncertainties can't be resolved upfront`,
          audience: ['assistant'],
        });
      }
    }

    return task;
  }

  /**
   * Batch create multiple tasks with internal dependencies
   */
  async batchCreateTasks(input: BatchCreateTasksInput): Promise<Task[]> {
    const { tasks } = input;

    if (tasks.length === 0) {
      return [];
    }

    // Resolve project for tasks that have a project specified
    const tasksWithResolvedProjects = tasks.map(task => {
      if (!task.project) {
        const defaultProject = this.projectResolver.resolve(undefined);
        return defaultProject ? { ...task, project: defaultProject } : task;
      }
      const resolvedProject = this.projectResolver.resolve(task.project);
      return resolvedProject !== task.project ? { ...task, project: resolvedProject } : task;
    });

    // Validate effort and uncertainties for all tasks before creating any
    for (let i = 0; i < tasksWithResolvedProjects.length; i++) {
      const task = tasksWithResolvedProjects[i];
      assertValidEffort(task.effort);
      this.uncertaintyPolicy.validateForCreation(
        task.title,
        task.effort,
        task.uncertainties ?? []
      );

      // Validate effort reason for high-effort tasks
      const effortReasonWarning = validateEffortReason(task.effort, task.effortReason);
      if (effortReasonWarning) {
        this.logger.log(`Task ${i} ("${task.title}"): ${effortReasonWarning}`);
      }
    }

    // Create all tasks via Linear service
    const createdTasks = await this.linear.batchCreateTasks(tasksWithResolvedProjects);

    // Log warnings for tasks requiring decomposition
    const needsDecomp = createdTasks.filter(task => needsDecomposition(task.effort));
    if (needsDecomp.length > 0) {
      this.logger.log(
        `⚠️  ${needsDecomp.length} task(s) require decomposition before execution (use decompose_task tool)`
      );
    }

    this.logger.log(`✅ Batch created ${createdTasks.length} task(s)`);

    return createdTasks;
  }

  async listTasks(
    input: ListTasksInput = {}
  ): Promise<{ tasks: Task[]; pageInfo: { hasNextPage: boolean; endCursor?: string } }> {
    const { filter, limit, after } = input;
    const projectKey = filter?.project ? this.projectResolver.resolve(filter.project) : undefined;

    const { tasks, pageInfo } = await this.linear.listTasks({
      project: projectKey,
      limit,
      after,
    });

    const readyStatuses = filter?.ready ? ['todo', 'backlog'] as Task['status'][] : undefined;
    const filtered = filterTasks(tasks, filter, { readyStatuses });

    return { tasks: filtered, pageInfo };
  }

  async queryTasks(input: QueryTasksInput): Promise<{
    matched: number;
    updated: number;
    tasks: Task[];
  }> {
    const { filter, limit = 20, after, operation } = input;

    if (!operation.set && !operation.add && !operation.remove && !operation.resolve) {
      throw new Error('operation must include at least one of set/add/remove/resolve');
    }

    const { tasks } = await this.listTasks({ filter, limit, after });
    const selected = tasks.slice(0, limit);

    if (selected.length === 0) {
      return { matched: tasks.length, updated: 0, tasks: [] };
    }

    const updates: UpdateTaskInput = {
      tasks: selected.map((task) => ({
        taskID: task.taskID,
        set: operation.set,
        add: operation.add,
        remove: operation.remove,
        resolve: operation.resolve,
      })),
    };

    const updatedTasks = await this.updateTask(updates);

    return {
      matched: tasks.length,
      updated: updatedTasks.length,
      tasks: updatedTasks,
    };
  }

  /**
   * Decompose a task into subtasks applying uncertainty policy
   */
  async decomposeTask(input: DecomposeTaskInput): Promise<Task[]> {
    const parent = await this.linear.getTask(input.taskID);
    if (!parent) {
      throw new Error(`Task ${input.taskID} not found`);
    }

    this.uncertaintyPolicy.handleDecompositionGuard(parent);

    for (const subtask of input.subtasks) {
      assertSubtaskEffort(subtask.effort);
      // Validate uncertainties for subtasks with effort >3
      this.uncertaintyPolicy.validateForCreation(
        subtask.title,
        subtask.effort,
        subtask.uncertainties ?? []
      );

      // Validate effort reason for high-effort subtasks
      const effortReasonWarning = validateEffortReason(subtask.effort, subtask.effortReason);
      if (effortReasonWarning) {
        this.logger.log(`Subtask "${subtask.title}": ${effortReasonWarning}`);
      }
    }

    const subtasks = await this.linear.decomposeTask(input);
    const parentKey = parent.linearIssueKey ?? parent.taskID;

    this.logger.log(`✅ Task ${parentKey} decomposed into ${subtasks.length} subtasks. Ready for work.`);

    return subtasks;
  }

  /**
   * Update tasks with enhanced semantics (set/add/remove/resolve operations)
   */
  async updateTask(input: UpdateTaskInput): Promise<Task[]> {
    const updatedTasks = await applyTaskUpdates(input, { linear: this.linear });

    for (const [index, taskUpdate] of input.tasks.entries()) {
      if (taskUpdate.set?.status === 'done') {
        await this.checkTreeCompletion(updatedTasks[index]);
      }
    }

    return updatedTasks;
  }

  /**
   * Resolve an uncertainty and optionally extract to Notion
   */
  async resolveUncertainty(input: ResolveUncertaintyInput): Promise<void> {
    const { taskID, uncertaintyTitle, resolution, extractToNotion, scope, tags } = input;

    await this.linear.resolveUncertainty(taskID, uncertaintyTitle, resolution);
    this.logger.log(`✅ Uncertainty "${uncertaintyTitle}" resolved in task ${taskID}`);

    if (!extractToNotion) {
      return;
    }

    const task = await this.linear.getTask(taskID);
    if (!task) {
      throw new Error(`Task ${taskID} not found`);
    }

    const uncertainty = task.uncertainties?.find(
      (candidate: Uncertainty) => candidate.title === uncertaintyTitle
    );
    if (!uncertainty) {
      throw new Error(`Uncertainty "${uncertaintyTitle}" not found`);
    }

    // Resolve Linear project UUID to project key for knowledge storage
    const projectKey = this.projectResolver.resolveFromLinearProjectId(task.project);

    const result = await this.knowledge.createDecision(
      taskID,
      task.title,
      uncertainty,
      projectKey,
      scope || 'project',
      tags
    );

    this.logger.log(`📝 Decision extracted (${scope || 'project'} scope): ${result}`);
  }

  /**
   * Extract a lesson from a task to the knowledge base
   */
  async extractLesson(input: ExtractLessonInput): Promise<void> {
    const { taskID, lesson, scope, relatedConcepts } = input;

    const task = await this.linear.getTask(taskID);
    if (!task) {
      throw new Error(`Task ${taskID} not found`);
    }

    await this.linear.addLessonLearned(taskID, lesson);

    // Resolve Linear project UUID to project key for knowledge storage
    const projectKey = this.projectResolver.resolveFromLinearProjectId(task.project);

    const result = await this.knowledge.createLesson(
      taskID,
      task.title,
      lesson,
      projectKey,
      scope || 'project',
      relatedConcepts,
      {
        effort: task.effort,
        effortReason: task.effortReason,
        complexityBias: task.complexityBias,
      }
    );

    this.logger.log(`📝 Lesson extracted (${scope || 'project'} scope): ${result}`);
  }

  /**
   * Get task by ID
   */
  async getTask(taskID: string): Promise<Task | null> {
    return this.linear.getTask(taskID);
  }

  /**
   * Search for lessons in the knowledge base
   */
  async searchLessons(query: string, project?: string): Promise<SearchResult[]> {
    return this.knowledge.searchLessons(query, project);
  }

  /**
   * Get ready tasks (no blockers, uncertainties resolved for effort >3)
   */
  async getReadyTasks(limit = 10): Promise<Task[]> {
    const { tasks } = await this.listTasks({
      filter: {
        ready: true,
        status_in: ['todo', 'backlog'],
      },
      limit,
    });
    return tasks;
  }

  /**
   * Get task details with optional subtree
   */
  async getTaskDetails(taskID: string | string[], includeTree = false): Promise<{
    tasks: Task[];
    tree?: Map<string, Task[]>;
  }> {
    const taskIDs = Array.isArray(taskID) ? taskID : [taskID];
    const tasks: Task[] = [];
    const tree = includeTree ? new Map<string, Task[]>() : undefined;

    for (const id of taskIDs) {
      const task = await this.linear.getTask(id);
      if (task) {
        tasks.push(task);

        if (includeTree && tree) {
          // Build the full tree starting from this task
          await this.buildTaskTree(id, tree);
        }
      }
    }

    return { tasks, tree };
  }

  /**
   * Build task tree recursively, populating the tree Map
   */
  private async buildTaskTree(parentID: string, tree: Map<string, Task[]>): Promise<void> {
    const { tasks: allTasks } = await this.listTasks({ limit: 100 });
    const directChildren = allTasks.filter(t => t.parentTaskID === parentID);

    if (directChildren.length > 0) {
      tree.set(parentID, directChildren);

      // Recursively build trees for each child
      for (const child of directChildren) {
        await this.buildTaskTree(child.taskID, tree);
      }
    }
  }

  private async checkTreeCompletion(task: Task): Promise<void> {
    const root = await this.findRootTask(task);
    if (!root) {
      return;
    }

    const treeDone = await isEntireTreeDone(root, (taskID) => this.linear.getTask(taskID));

    if (treeDone) {
      this.logger.log({
        type: 'text',
        text: `✅ Entire task tree completed: ${root.taskID} - ${root.title}

Consider extracting consolidated lessons with extract_lesson tool.`,
        audience: ['assistant'],
      });
    }
  }

  private async findRootTask(task: Task): Promise<Task | null> {
    let current: Task | null = task;

    while (current?.parentTaskID) {
      const parent = await this.linear.getTask(current.parentTaskID);
      if (!parent) {
        break;
      }
      current = parent;
    }

    return current;
  }
}

export type { UncertaintyResolutionMode } from '../domain/uncertainty/uncertainty-policy.js';
