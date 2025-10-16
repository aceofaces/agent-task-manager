/**
 * Linear service with project-based isolation
 * Stores metadata in issue description using parseable format
 */

import { LinearClient, Issue } from '@linear/sdk';
import type { IssueLabel } from '@linear/sdk';
import type {
  Task,
  CreateTaskInput,
  DecomposeTaskInput,
  IssueMetadata,
  Uncertainty,
  UncertaintyDraft,
  LessonLearned,
  ProjectMapping,
  TaskPatch,
  ComplexityBias,
  BatchTaskInput,
} from '../../types.js';
import { FIBONACCI_EFFORT_VALUES, isFibonacciEffort } from '../../types.js';
import {
  buildDescriptionWithMetadata,
  parseMetadata,
  extractPlainDescription,
} from '../../linear-metadata.js';

const isIssueLabel = (value: unknown): value is IssueLabel => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === 'string';
};

export const normalizeUncertainties = (
  input?: Array<Uncertainty | UncertaintyDraft | string>
): Uncertainty[] => {
  if (!input) {
    return [];
  }

  return input
    .map((candidate) => {
      if (typeof candidate === 'string') {
        const title = candidate.trim();
        return title ? { title } : null;
      }

      const title = candidate.title.trim();
      if (!title) {
        return null;
      }

      const normalized: Uncertainty = { title };

      if ('description' in candidate && typeof candidate.description === 'string') {
        const description = candidate.description.trim();
        if (description.length > 0) {
          normalized.description = description;
        }
      }

      if ('resolution' in candidate && typeof candidate.resolution === 'string') {
        const resolution = candidate.resolution.trim();
        if (resolution.length > 0) {
          normalized.resolution = resolution;
        }
      }

      if ('resolvedAt' in candidate && typeof candidate.resolvedAt === 'string') {
        const resolvedAt = candidate.resolvedAt.trim();
        if (resolvedAt.length > 0) {
          normalized.resolvedAt = resolvedAt;
        }
      }

      if ('resolvedBy' in candidate && typeof candidate.resolvedBy === 'string') {
        const resolvedBy = candidate.resolvedBy.trim();
        if (resolvedBy.length > 0) {
          normalized.resolvedBy = resolvedBy;
        }
      }

      return normalized;
    })
    .filter((value): value is Uncertainty => value !== null);
};

export class LinearService {
  private client: LinearClient;
  private teamId: string;
  private projects: Record<string, ProjectMapping>;

  constructor(apiKey: string, teamId: string, projects: Record<string, ProjectMapping>) {
    this.client = new LinearClient({ apiKey });
    this.teamId = teamId;
    this.projects = projects;
  }

  /**
   * Get the underlying Linear client (for advanced use cases like project discovery)
   */
  getLinearClient(): LinearClient {
    return this.client;
  }

  needsDecomposition(effort: number | undefined): boolean {
    return typeof effort === 'number' && effort > 3;
  }

  /**
   * Create a new task (Linear issue)
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const {
      title,
      description,
      goal,
      effort,
      effortReason,
      complexityBias,
      project,
      uncertainties,
      dueDate,
      labels,
    } = input;
    const normalizedUncertainties = normalizeUncertainties(uncertainties);

    // Validate effort value
    if (!isFibonacciEffort(effort)) {
      throw new Error(
        `Task "${title}" effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}, got ${String(
          effort
        )}`
      );
    }

    const metadata: IssueMetadata = {
      goal,
      effort,
      effortReason,
      complexityBias,
      uncertainties: normalizedUncertainties,
      lessonsLearned: [],
    };

    const fullDescription = buildDescriptionWithMetadata(description || '', metadata);

    // Build labels including effort
    const allLabels = [
      ...(labels || []),
      `effort:${effort}`,
    ];

    // Check if needs decomposition
    if (this.needsDecomposition(effort)) {
      allLabels.push('needs-decomposition');
    }

    // Build create input (inline type for SDK v34 compatibility)
    const createInput: {
      teamId: string;
      title: string;
      description: string;
      labelIds?: string[];
      projectId?: string;
      dueDate?: string;
      estimate?: number;
    } = {
      teamId: this.teamId,
      title,
      description: fullDescription,
      labelIds: [], // We'll create labels by name if they don't exist
      estimate: effort,
    };

    // Add project if specified
    if (project && this.projects[project]) {
      createInput.projectId = this.projects[project].linearProjectId;
    }

    // Add due date if specified
    if (dueDate) {
      createInput.dueDate = dueDate;
    }

    // Create the issue
    const issuePayload = await this.client.createIssue(createInput);
    const issue = await issuePayload.issue;

    if (!issue) {
      throw new Error('Failed to create Linear issue');
    }

    // Add labels (Linear SDK will create them if they don't exist)
    if (allLabels.length > 0) {
      await this.addLabelsToIssue(issue.id, allLabels);
    }

    return await this.issueToTask(issue);
  }

  /**
   * Batch create multiple tasks with support for internal dependencies
   */
  async batchCreateTasks(tasks: BatchTaskInput[]): Promise<Task[]> {
    if (tasks.length === 0) {
      return [];
    }

    if (tasks.length > 50) {
      throw new Error('Batch size cannot exceed 50 tasks');
    }

    // Step 1: Validate all tasks and batch indexes
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Validate effort
      if (!isFibonacciEffort(task.effort)) {
        throw new Error(
          `Task ${i} ("${task.title}") effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}, got ${String(
            task.effort
          )}`
        );
      }

      // Validate effort >3 requires uncertainties
      const normalizedUncertainties = normalizeUncertainties(task.uncertainties);
      if (task.effort > 3 && normalizedUncertainties.length === 0) {
        throw new Error(
          `Task ${i} ("${task.title}") with effort >3 must include at least one uncertainty`
        );
      }

      // Validate batch indexes
      const batchIndexes = task.dependsOnBatchIndex || [];
      for (const idx of batchIndexes) {
        if (idx >= tasks.length) {
          throw new Error(
            `Task ${i}: dependsOnBatchIndex[${idx}] out of range (batch size: ${tasks.length})`
          );
        }
        if (idx === i) {
          throw new Error(`Task ${i}: cannot depend on itself`);
        }
        if (idx > i) {
          throw new Error(
            `Task ${i}: dependsOnBatchIndex[${idx}] references a later task. Dependencies must reference earlier tasks in the batch.`
          );
        }
      }
    }

    // Step 2: Create all tasks and track their IDs
    const createdTasks: Task[] = [];
    const taskIDMap = new Map<number, string>();

    for (let i = 0; i < tasks.length; i++) {
      const taskInput = tasks[i];
      const normalizedUncertainties = normalizeUncertainties(taskInput.uncertainties);

      const metadata: IssueMetadata = {
        goal: taskInput.goal,
        effort: taskInput.effort,
        effortReason: taskInput.effortReason,
        complexityBias: taskInput.complexityBias,
        uncertainties: normalizedUncertainties,
        lessonsLearned: [],
      };

      const fullDescription = buildDescriptionWithMetadata(
        taskInput.description || '',
        metadata
      );

      // Build labels
      const allLabels = [...(taskInput.labels || []), `effort:${taskInput.effort}`];
      if (this.needsDecomposition(taskInput.effort)) {
        allLabels.push('needs-decomposition');
      }

      // Create the issue
      const createInput: {
        teamId: string;
        title: string;
        description: string;
        projectId?: string;
        dueDate?: string;
        estimate?: number;
      } = {
        teamId: this.teamId,
        title: taskInput.title,
        description: fullDescription,
        estimate: taskInput.effort,
      };

      // Add project if specified
      if (taskInput.project && this.projects[taskInput.project]) {
        createInput.projectId = this.projects[taskInput.project].linearProjectId;
      }

      // Add due date if specified
      if (taskInput.dueDate) {
        createInput.dueDate = taskInput.dueDate;
      }

      const issuePayload = await this.client.createIssue(createInput);
      const issue = await issuePayload.issue;

      if (!issue) {
        throw new Error(`Failed to create task ${i} ("${taskInput.title}")`);
      }

      // Track task ID
      taskIDMap.set(i, issue.id);

      // Add labels
      if (allLabels.length > 0) {
        await this.addLabelsToIssue(issue.id, allLabels);
      }

      createdTasks.push(await this.issueToTask(issue));
    }

    // Step 3: Add dependencies (both external and batch-based)
    for (let i = 0; i < tasks.length; i++) {
      const taskInput = tasks[i];
      const taskID = taskIDMap.get(i)!;

      const batchDeps = (taskInput.dependsOnBatchIndex || []).map(idx => taskIDMap.get(idx)!);
      const externalDeps = (taskInput.dependencies || [])
        .filter(dep => dep.type === 'blocked_by')
        .map(dep => dep.taskID);

      const allDeps = [...batchDeps, ...externalDeps];

      if (allDeps.length > 0) {
        // Linear doesn't have a native dependency API, so we'll add a comment
        // and store in metadata if needed. For now, just add a comment.
        await this.client.createComment({
          issueId: taskID,
          body: `**Dependencies:** Blocked by ${allDeps.join(', ')}`,
        });
      }
    }

    return createdTasks;
  }

  async listTasks(options: { project?: string; limit?: number; after?: string }): Promise<{ tasks: Task[]; pageInfo: { hasNextPage: boolean; endCursor?: string } }> {
    const { project, limit = 20, after } = options;

    if (limit < 1 || limit > 100) {
      throw new Error('limit must be between 1 and 100');
    }

    const variables: Record<string, unknown> = {
      first: limit,
      filter: {
        team: { id: { eq: this.teamId } },
      },
    };

    if (after) {
      variables.after = after;
    }

    if (project) {
      const mapping = this.projects[project];
      if (!mapping) {
        throw new Error(`Project "${project}" is not configured`);
      }
      (variables.filter as Record<string, unknown>).project = {
        id: { eq: mapping.linearProjectId },
      };
    }

    const connection = await this.client.issues(variables);
    const issueTasks = await Promise.all(connection.nodes.map((issue) => this.issueToTask(issue)));

    const pageInfo = {
      hasNextPage: connection.pageInfo?.hasNextPage ?? false,
      endCursor: connection.pageInfo?.endCursor ?? undefined,
    };

    return { tasks: issueTasks, pageInfo };
  }

  /**
   * Decompose task into subtasks
   */
  async decomposeTask(input: DecomposeTaskInput): Promise<Task[]> {
    const { taskID, subtasks, decompositionReason } = input;

    // Get parent issue
    const parent = await this.client.issue(taskID);

    if (!parent) {
      throw new Error(`Task ${taskID} not found`);
    }

    // Verify parent needs decomposition
    const metadata = parseMetadata(parent.description || '');
    if (!this.needsDecomposition(metadata.effort)) {
      throw new Error(`Task ${taskID} (effort: ${metadata.effort}) does not require decomposition`);
    }

    // Add decomposition comment
    if (decompositionReason) {
      await this.client.createComment({
        issueId: parent.id,
        body: `**Decomposition Reason:** ${decompositionReason}`,
      });
    }

    // Create subtasks
    const createdSubtasks: Task[] = [];

    for (const subtask of subtasks) {
      const effortValue = subtask.effort;

      if (!isFibonacciEffort(effortValue)) {
        throw new Error(
          `Subtask "${subtask.title}" effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}, got ${String(
            effortValue
          )}`
        );
      }

      const normalizedSubtaskUncertainties = normalizeUncertainties(subtask.uncertainties);

      const subtaskMetadata: IssueMetadata = {
        goal: subtask.goal,
        effort: effortValue,
        effortReason: subtask.effortReason,
        complexityBias: subtask.complexityBias,
        uncertainties: normalizedSubtaskUncertainties,
        lessonsLearned: [],
      };

      const subtaskDescription = buildDescriptionWithMetadata(
        subtask.description || '',
        subtaskMetadata
      );

      // Get parent project ID if it exists
      const parentProject = await parent.project;
      const projectId = parentProject?.id;

      const createInput: {
        teamId: string;
        title: string;
        description: string;
        parentId: string;
        projectId?: string;
      } = {
        teamId: this.teamId,
        title: subtask.title,
        description: subtaskDescription,
        parentId: parent.id,
        projectId,
      };

      const issuePayload = await this.client.createIssue(createInput);
      const issue = await issuePayload.issue;

      if (issue) {
        // Add effort label and needs-decomposition if applicable
        const subtaskLabels = [`effort:${subtask.effort}`];
        if (this.needsDecomposition(subtask.effort)) {
          subtaskLabels.push('needs-decomposition');
        }
        await this.addLabelsToIssue(issue.id, subtaskLabels);
        createdSubtasks.push(await this.issueToTask(issue));
      }
    }

    // Remove needs-decomposition label from parent
    await this.removeLabelFromIssue(parent.id, 'needs-decomposition');

    return createdSubtasks;
  }

  /**
   * Update task (internal helper - accepts simple update structure)
   */
  async updateTask(input: TaskPatch): Promise<Task> {
    const { taskID, status, description, dueDate, labels } = input;

    const updateInput: {
      stateId?: string;
      description?: string;
      dueDate?: string;
    } = {};

    // Map status to Linear state
    if (status) {
      const stateId = await this.getStateIdForStatus(status);
      if (!stateId) {
        throw new Error(
          `No Linear workflow state mapped for status "${status}". Check your team's workflow configuration.`
        );
      }
      updateInput.stateId = stateId;
    }

    // Update description (preserving metadata if not explicitly changed)
    if (description !== undefined) {
      const issue = await this.client.issue(taskID);
      const metadata = parseMetadata(issue?.description || '');
      updateInput.description = buildDescriptionWithMetadata(description, metadata);
    }

    // Update due date
    if (dueDate !== undefined) {
      updateInput.dueDate = dueDate;
    }

    // Update issue
    const issuePayload = await this.client.updateIssue(taskID, updateInput);
    const issue = await issuePayload.issue;

    if (!issue) {
      throw new Error(`Failed to update task ${taskID}`);
    }

    // Update labels if provided
    if (labels) {
      await this.setLabelsOnIssue(taskID, labels);
    }

    return await this.issueToTask(issue);
  }

  /**
   * Update task effort metadata and corresponding labels
   */
  async updateTaskEffort(
    taskID: string,
    payload: { effort?: number; effortReason?: string; complexityBias?: ComplexityBias }
  ): Promise<void> {
    const { effort, effortReason, complexityBias } = payload;

    if (effort === undefined && effortReason === undefined && typeof complexityBias === 'undefined') {
      return;
    }

    if (effort !== undefined && !isFibonacciEffort(effort)) {
      throw new Error(
        `Task effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}, got ${String(
          effort
        )}`
      );
    }

    const issue = await this.client.issue(taskID);

    if (!issue) {
      throw new Error(`Task ${taskID} not found`);
    }

    const metadata = parseMetadata(issue.description || '');
    if (effort !== undefined) {
      metadata.effort = effort;
    }
    if (effortReason !== undefined) {
      metadata.effortReason = effortReason;
    }
    if (typeof complexityBias !== 'undefined') {
      metadata.complexityBias = complexityBias;
    }

    const plainDescription = extractPlainDescription(issue.description || '');

    const updatePayload: { description: string; estimate?: number } = {
      description: buildDescriptionWithMetadata(plainDescription, metadata),
    };

    if (effort !== undefined) {
      updatePayload.estimate = effort;
    }

    const refreshedIssuePayload = await this.client.updateIssue(taskID, updatePayload);

    const refreshedIssue = await refreshedIssuePayload.issue;
    const labelsConnection = await refreshedIssue?.labels();
    const existingLabelNames =
      labelsConnection?.nodes.filter(isIssueLabel).map((label) => label.name) ?? [];

    if (effort !== undefined) {
      const retainedLabels = existingLabelNames.filter(
        (label) => !label.startsWith('effort:') && label !== 'needs-decomposition'
      );

      const nextLabels = [...retainedLabels, `effort:${effort}`];

      if (this.needsDecomposition(effort)) {
        nextLabels.push('needs-decomposition');
      }

      await this.setLabelsOnIssue(taskID, nextLabels);
    }
  }

  /**
   * Add uncertainties to existing metadata (without overwriting)
   */
  async addUncertainties(taskID: string, uncertainties: Uncertainty[]): Promise<void> {
    const normalizedInputs = normalizeUncertainties(uncertainties);

    if (normalizedInputs.length === 0) {
      return;
    }

    const issue = await this.client.issue(taskID);

    if (!issue) {
      throw new Error(`Task ${taskID} not found`);
    }

    const metadata = parseMetadata(issue.description || '');
    const normalizedExistingTitles = new Set(
      metadata.uncertainties.map((item) => item.title.trim().toLowerCase())
    );

    for (const uncertainty of normalizedInputs) {
      const normalizedTitle = uncertainty.title.trim();
      if (!normalizedTitle || normalizedExistingTitles.has(normalizedTitle.toLowerCase())) {
        continue;
      }

      metadata.uncertainties.push({
        title: normalizedTitle,
        description: uncertainty.description,
      });
      normalizedExistingTitles.add(normalizedTitle.toLowerCase());
    }

    const plainDescription = extractPlainDescription(issue.description || '');

    await this.client.updateIssue(taskID, {
      description: buildDescriptionWithMetadata(plainDescription, metadata),
    });
  }

  /**
   * Add uncertainty resolution
   */
  async resolveUncertainty(taskID: string, uncertaintyTitle: string, resolution: string): Promise<void> {
    const issue = await this.client.issue(taskID);

    if (!issue) {
      throw new Error(`Task ${taskID} not found`);
    }

    const metadata = parseMetadata(issue.description || '');

    // Find and update uncertainty
    const uncertainty = metadata.uncertainties.find((u) => u.title === uncertaintyTitle);
    if (uncertainty) {
      uncertainty.resolution = resolution;
      uncertainty.resolvedAt = new Date().toISOString();
    } else {
      throw new Error(`Uncertainty "${uncertaintyTitle}" not found in task ${taskID}`);
    }

    // Extract plain description
    const plainDescription = extractPlainDescription(issue.description || '');

    // Update issue with new metadata
    await this.client.updateIssue(taskID, {
      description: buildDescriptionWithMetadata(plainDescription, metadata),
    });

    // Add a comment about the resolution
    await this.client.createComment({
      issueId: taskID,
      body: `**Uncertainty Resolved:** ${uncertaintyTitle}\n\n${resolution}`,
    });
  }

  /**
   * Add lesson learned to metadata
   */
  async addLessonLearned(taskID: string, lesson: LessonLearned): Promise<void> {
    const issue = await this.client.issue(taskID);

    if (!issue) {
      throw new Error(`Task ${taskID} not found`);
    }

    const metadata = parseMetadata(issue.description || '');
    metadata.lessonsLearned.push(lesson);

    const plainDescription = extractPlainDescription(issue.description || '');

    await this.client.updateIssue(taskID, {
      description: buildDescriptionWithMetadata(plainDescription, metadata),
    });
  }

  /**
   * Fetch a task by ID
   */
  async getTask(taskID: string): Promise<Task | null> {
    const issue = await this.client.issue(taskID);
    return issue ? await this.issueToTask(issue) : null;
  }

  private async issueToTask(issue: Issue): Promise<Task> {
    const metadata = parseMetadata(issue.description || '');
    const state = await issue.state;
    const project = await issue.project;
    const parent = await issue.parent;
    const assignee = await issue.assignee;
    const dueDateValue = typeof issue.dueDate === 'string' ? issue.dueDate : undefined;
    const labelsConnection = await issue.labels();
    const labelNodes: IssueLabel[] =
      labelsConnection?.nodes?.filter((node): node is IssueLabel => isIssueLabel(node)) ?? [];
    const labels = labelNodes.map((label) => label.name);

    return {
      taskID: issue.id,
      title: issue.title,
      linearIssueKey: issue.identifier ?? undefined,
      description: extractPlainDescription(issue.description || ''),
      goal: metadata.goal,
      effort: metadata.effort as Task['effort'],
      effortReason: metadata.effortReason,
      complexityBias: metadata.complexityBias,
      status: this.mapLinearStateToStatus(state?.name || 'Backlog'),
      project: project?.id,
      parentTaskID: parent?.id,
      uncertainties: metadata.uncertainties,
      lessonsLearned: metadata.lessonsLearned,
      assignee: assignee?.id,
      dueDate: dueDateValue,
      labels,
    };
  }

  /**
   * Helper: Map Linear state to our status
   */
  private mapLinearStateToStatus(stateName: string): Task['status'] {
    const lowerName = stateName.toLowerCase();
    if (lowerName.includes('backlog')) return 'backlog';
    if (lowerName.includes('todo') || lowerName.includes('planned')) return 'todo';
    if (lowerName.includes('progress') || lowerName.includes('started')) return 'in-progress';
    if (lowerName.includes('review')) return 'in-review';
    if (lowerName.includes('done') || lowerName.includes('completed')) return 'done';
    if (lowerName.includes('cancel')) return 'canceled';
    return 'todo';
  }

  /**
   * Helper: Get Linear state ID for our status
   */
  private async getStateIdForStatus(status: Task['status']): Promise<string | null> {
    const team = await this.client.team(this.teamId);
    const states = await team?.states();

    if (!states) return null;

    // Map our status to Linear workflow state types
    const stateTypeMap: Record<Task['status'], string[]> = {
      backlog: ['backlog'],
      todo: ['unstarted', 'planned'],
      'in-progress': ['started'],
      'in-review': ['review'],
      done: ['completed'],
      canceled: ['canceled'],
    };

    const targetTypes = stateTypeMap[status] || [];

    for (const state of states.nodes) {
      if (targetTypes.includes(state.type)) {
        return state.id;
      }
    }

    return null;
  }

  /**
   * Helper: Add labels to issue
   */
  private async addLabelsToIssue(issueId: string, labelNames: string[]): Promise<void> {
    const team = await this.client.team(this.teamId);
    const teamLabels = await team?.labels();
    const issue = await this.client.issue(issueId);
    const issueLabels = await issue?.labels();

    const labelIds: string[] = [...(issueLabels?.nodes.map((label) => label.id) || [])];

    for (const name of labelNames) {
      const label = teamLabels?.nodes.find((teamLabel) => teamLabel.name === name);

      if (!label) {
        // Create label - Linear SDK v34 doesn't expose createLabel directly
        // Just skip creating labels that don't exist, or use a workaround
        // For now, we'll skip and only add existing labels
        continue;
      }

      if (label && !labelIds.includes(label.id)) {
        labelIds.push(label.id);
      }
    }

    // Update issue with new label IDs
    await this.client.updateIssue(issueId, { labelIds });
  }

  /**
   * Helper: Remove label from issue
   */
  private async removeLabelFromIssue(issueId: string, labelName: string): Promise<void> {
    const issue = await this.client.issue(issueId);
    const labelsConnection = await issue?.labels();

    const label = labelsConnection?.nodes.find((issueLabel) => issueLabel.name === labelName);
    if (label) {
      // Remove the label ID from the issue's label IDs
      const labelIds = labelsConnection.nodes
        .filter((issueLabel) => issueLabel.id !== label.id)
        .map((issueLabel) => issueLabel.id);

      await this.client.updateIssue(issueId, { labelIds });
    }
  }

  /**
   * Helper: Set labels on issue (replace all)
   */
  private async setLabelsOnIssue(issueId: string, labelNames: string[]): Promise<void> {
    // Remove all existing labels
    const issue = await this.client.issue(issueId);
    const existingLabels = await issue?.labels();

    if (existingLabels) {
      for (const label of existingLabels.nodes) {
        await this.removeLabelFromIssue(issueId, label.name);
      }
    }

    // Add new labels
    await this.addLabelsToIssue(issueId, labelNames);
  }
}
