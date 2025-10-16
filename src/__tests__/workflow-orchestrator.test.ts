import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { WorkflowOrchestrator } from '../orchestrator/workflow-orchestrator.js';
import {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
} from '../types.js';
import type {
  Config,
  Task,
  CreateTaskInput,
  BatchTaskInput,
  LessonLearned,
  DecomposeTaskInput,
  Uncertainty,
  TaskPatch,
} from '../types.js';
import type { LinearService } from '../integrations/linear/service.js';
import type { NotionService } from '../integrations/notion/service.js';

type LoggerMock = {
  log: Mock<(message: unknown) => void>;
  warn: Mock<(message: unknown) => void>;
  error: Mock<(message: unknown) => void>;
};

const baseConfig: Config = {
  linear: {
    apiKey: 'linear-token',
    teamId: 'team-1',
  },
  storageBackend: 'notion',
  notion: {
    apiKey: 'notion-token',
  },
  projects: {},
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  taskID: overrides.taskID ?? 'task-1',
  title: overrides.title ?? 'Test Task',
  description: overrides.description,
  goal: overrides.goal,
  effort: overrides.effort ?? 3,
  effortReason: overrides.effortReason,
  complexityBias: overrides.complexityBias,
  status: overrides.status ?? 'todo',
  project: overrides.project,
  parentTaskID: overrides.parentTaskID,
  subtasks: overrides.subtasks ?? [],
  uncertainties: overrides.uncertainties ?? [],
  lessonsLearned: overrides.lessonsLearned ?? [],
  dependencies: overrides.dependencies,
  assignee: overrides.assignee,
  dueDate: overrides.dueDate,
  labels: overrides.labels ?? [],
  metadata: overrides.metadata,
});

class LinearStub {
  public tasks = new Map<string, Task>();
  public createTask = vi.fn<(input: CreateTaskInput) => Promise<Task>>((input) => {
    const task = makeTask({
      taskID: 'task-' + Math.random().toString(16).slice(2),
      title: input.title,
      effort: input.effort as Task['effort'],
      effortReason: input.effortReason,
      complexityBias: input.complexityBias,
      status: 'todo',
      uncertainties: input.uncertainties?.map((uncertainty) => ({
        ...uncertainty,
      })),
      labels: [`effort:${input.effort}`],
    });
    this.tasks.set(task.taskID, task);
    return Promise.resolve(task);
  });

  public batchCreateTasks = vi.fn<(tasks: BatchTaskInput[]) => Promise<Task[]>>((tasks) => {
    // Validate batch size
    if (tasks.length > 50) {
      throw new Error('Batch size cannot exceed 50 tasks');
    }

    // Validate batch indexes and effort
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Validate effort >3 requires uncertainties
      const uncertainties = task.uncertainties || [];
      if (task.effort > 3 && uncertainties.length === 0) {
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

    const createdTasks: Task[] = [];
    for (const taskInput of tasks) {
      const task = makeTask({
        taskID: 'task-' + Math.random().toString(16).slice(2),
        title: taskInput.title,
        effort: taskInput.effort as Task['effort'],
        effortReason: taskInput.effortReason,
        complexityBias: taskInput.complexityBias,
        status: 'todo',
        uncertainties: taskInput.uncertainties?.map((uncertainty) => ({
          ...uncertainty,
        })),
        labels: [`effort:${taskInput.effort}`],
      });
      this.tasks.set(task.taskID, task);
      createdTasks.push(task);
    }
    return Promise.resolve(createdTasks);
  });

  public getTask = vi.fn<(taskID: string) => Promise<Task | null>>((taskID) => {
    return Promise.resolve(this.tasks.get(taskID) ?? null);
  });

  public decomposeTask = vi.fn<(input: DecomposeTaskInput) => Promise<Task[]>>(
    ({ taskID, subtasks }) => {
      const created = subtasks.map((subtask, index) => {
        const task = makeTask({
          taskID: `${taskID}-${index + 1}`,
          parentTaskID: taskID,
          title: subtask.title,
          effort: subtask.effort as Task['effort'],
          effortReason: subtask.effortReason,
          complexityBias: subtask.complexityBias,
          status: 'backlog',
        });
        this.tasks.set(task.taskID, task);
        return task;
      });

      const parent = this.tasks.get(taskID);
      if (parent) {
        parent.subtasks = created;
      }

      return Promise.resolve(created);
    }
  );

  public updateTask = vi.fn<(update: TaskPatch) => Promise<Task>>((update) => {
    const current = this.tasks.get(update.taskID);
    if (!current) {
      throw new Error(`Task ${update.taskID} not found`);
    }

    const next: Task = {
      ...current,
      ...(update.status ? { status: update.status } : {}),
      ...(update.description !== undefined ? { description: update.description } : {}),
      ...(update.assignee !== undefined ? { assignee: update.assignee } : {}),
      ...(update.dueDate !== undefined ? { dueDate: update.dueDate } : {}),
      ...(update.labels ? { labels: update.labels } : {}),
    };

    this.tasks.set(update.taskID, next);
    return Promise.resolve(next);
  });

  public updateTaskEffort = vi.fn<
    (
      taskID: string,
      payload: { effort?: Task['effort']; effortReason?: string; complexityBias?: string }
    ) => Promise<void>
  >((taskID, payload) => {
    const task = this.tasks.get(taskID);
    if (task && payload) {
      if (typeof payload.effort !== 'undefined') {
        task.effort = payload.effort;
      }
      if (typeof payload.effortReason !== 'undefined') {
        task.effortReason = payload.effortReason;
      }
      if (typeof payload.complexityBias !== 'undefined') {
        task.complexityBias = payload.complexityBias as Task['complexityBias'];
      }
      const baseLabels = (task.labels ?? []).filter(
        (label) => !label.startsWith('effort:') && label !== 'needs-decomposition'
      );
      const labels = [...baseLabels, `effort:${task.effort}`];
      if (task.effort > 3) {
        labels.push('needs-decomposition');
      }
      task.labels = labels;
    }
    return Promise.resolve();
  });

  public addUncertainties = vi.fn<
    (taskID: string, uncertainties: Uncertainty[]) => Promise<void>
  >((taskID, uncertainties) => {
    const task = this.tasks.get(taskID);
    if (!task) {
      return Promise.resolve();
    }

    const existing = new Set(
      (task.uncertainties ?? []).map((uncertainty) => uncertainty.title.trim().toLowerCase())
    );

    const additions = uncertainties
      .map((uncertainty) => ({
        ...uncertainty,
        title: uncertainty.title.trim(),
        description: uncertainty.description?.trim(),
      }))
      .filter((uncertainty) => uncertainty.title.length > 0)
      .filter((uncertainty) => {
        const normalized = uncertainty.title.toLowerCase();
        if (existing.has(normalized)) {
          return false;
        }
        existing.add(normalized);
        return true;
      });

    task.uncertainties = [...(task.uncertainties ?? []), ...additions];
    return Promise.resolve();
  });

  public addLessonLearned = vi.fn<
    (taskID: string, lesson: LessonLearned) => Promise<void>
  >((taskID, lesson) => {
    const task = this.tasks.get(taskID);
    if (task) {
      task.lessonsLearned = [...(task.lessonsLearned ?? []), lesson];
    }
    return Promise.resolve();
  });

  public listTasks = vi.fn<
    (options: { project?: string; limit?: number; after?: string }) => Promise<{ tasks: Task[]; pageInfo: { hasNextPage: boolean; endCursor?: string } }>
  >(() =>
    Promise.resolve({
      tasks: Array.from(this.tasks.values()),
      pageInfo: { hasNextPage: false },
    })
  );

  public resolveUncertainty = vi.fn<
    (taskID: string, title: string, resolution: string) => Promise<void>
  >((taskID, title, resolution) => {
    const task = this.tasks.get(taskID);
    if (!task || !task.uncertainties) {
      return Promise.resolve();
    }
    const match = task.uncertainties.find(
      (uncertainty: Uncertainty) => uncertainty.title === title
    );
    if (match) {
      match.resolution = resolution;
      match.resolvedAt = new Date().toISOString();
    }
    return Promise.resolve();
  });
}

class NotionStub {
  public createDecision = vi.fn<NotionService['createDecision']>(
    async (_taskID, _taskTitle, _uncertainty) => 'decision-123'
  );
  public createLesson = vi.fn<NotionService['createLesson']>(
    async (_taskID, _taskTitle, lesson) => {
      return lesson.content ? 'lesson-789' : 'lesson-000';
    }
  );
  public searchLessons = vi.fn<NotionService['searchLessons']>(
    async (_query, _project) => [{ id: 'lesson', title: 'Lesson', content: 'Content' }]
  );
}

const createLogger = (): LoggerMock => ({
  log: vi.fn<(message: unknown) => void>(),
  warn: vi.fn<(message: unknown) => void>(),
  error: vi.fn<(message: unknown) => void>(),
});

const isTextLogEntry = (value: unknown): value is { text: string } => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.text === 'string';
};

const extractLogArgs = (mock: Mock<(message: unknown) => void>): unknown[] =>
  mock.mock.calls.map(([firstArg]) => firstArg);

const expectMockContains = (mock: Mock<(message: unknown) => void>, substring: string): void => {
  const matches = extractLogArgs(mock).some(
    (arg): arg is string => typeof arg === 'string' && arg.includes(substring)
  );
  expect(matches).toBe(true);
};

const expectMockObjectTextContains = (
  mock: Mock<(message: unknown) => void>,
  substring: string
): void => {
  const matches = extractLogArgs(mock)
    .filter(isTextLogEntry)
    .some((entry) => entry.text.includes(substring));
  expect(matches).toBe(true);
};

const instantiate = (overrides?: {
  linear?: LinearStub;
  notion?: NotionStub;
  logger?: LoggerMock;
  uncertaintyMode?: 'off' | 'warn' | 'block';
  config?: Config;
}) => {
  const linear = overrides?.linear ?? new LinearStub();
  const notion = overrides?.notion ?? new NotionStub();
  const logger = overrides?.logger ?? createLogger();
  const orchestrator = new WorkflowOrchestrator(overrides?.config ?? baseConfig, {
    linearService: linear as unknown as LinearService,
    knowledgeService: notion as unknown as NotionService,
    uncertaintyMode: overrides?.uncertaintyMode,
    logger,
  });

  return { orchestrator, linear, notion, logger };
};

describe('WorkflowOrchestrator', () => {
  it('throws when creating a task with invalid effort', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.createTask({
        title: 'Invalid effort',
        effort: 0 as unknown as Task['effort'],
      })
    ).rejects.toThrow(/must be one of 1, 2, 3, 5, 8, 13, 21/);
  });

  it('coerces string uncertainties when creating tasks', async () => {
    const { orchestrator, linear } = instantiate();

    const parsedInput = CreateTaskInputSchema.parse({
      title: 'Flattened uncertainties',
      effort: 5,
      uncertainties: ['Integration risk', { title: 'Data contract', description: 'needs clarity' }],
    });

    await orchestrator.createTask(parsedInput);

    const createCall = linear.createTask.mock.calls.at(-1)?.[0];
    expect(createCall?.uncertainties).toEqual([
      { title: 'Integration risk' },
      { title: 'Data contract', description: 'needs clarity' },
    ]);
  });

  it('coerces string uncertainties when updating tasks and supports resolution', async () => {
    const { orchestrator, linear } = instantiate();

    const createdTask = await orchestrator.createTask(
      CreateTaskInputSchema.parse({
        title: 'Track data pipeline',
        effort: 5,
        uncertainties: ['Initial risk'],
      })
    );

    const updateInput = UpdateTaskInputSchema.parse({
      tasks: [
        {
          taskID: createdTask.taskID,
          add: { uncertainties: ['Discover data contract'] },
        },
      ],
    });

    await orchestrator.updateTask(updateInput);

    expect(linear.addUncertainties).toHaveBeenCalledWith(createdTask.taskID, [
      { title: 'Discover data contract' },
    ]);

    await orchestrator.resolveUncertainty({
      taskID: createdTask.taskID,
      uncertaintyTitle: 'Discover data contract',
      resolution: 'Documented in ADR',
    });

    expect(linear.resolveUncertainty).toHaveBeenCalledWith(
      createdTask.taskID,
      'Discover data contract',
      'Documented in ADR'
    );
  });

  it('defaults to configured project when none is provided', async () => {
    const linear = new LinearStub();
    const configWithProject: Config = {
      ...baseConfig,
      projects: {
        'agent-task-manager': {
          linearProjectId: 'proj-uuid',
          notionLessonsDbId: 'notion-lessons',
          notionLessonsDataSourceId: 'notion-lessons-ds',
          notionDecisionsDbId: 'notion-decisions',
          notionDecisionsDataSourceId: 'notion-decisions-ds',
        },
      },
      defaultProject: 'agent-task-manager',
    };

    const { orchestrator } = instantiate({ linear, config: configWithProject });

    await orchestrator.createTask({
      title: 'Auto project association',
      effort: 3,
    });

    expect(linear.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'agent-task-manager' })
    );
  });

  it('throws when an unknown project is provided', async () => {
    const linear = new LinearStub();
    const configWithProject: Config = {
      ...baseConfig,
      projects: {
        known: {
          linearProjectId: 'proj-uuid',
          notionLessonsDbId: 'notion-lessons',
          notionLessonsDataSourceId: 'notion-lessons-ds',
          notionDecisionsDbId: 'notion-decisions',
          notionDecisionsDataSourceId: 'notion-decisions-ds',
        },
      },
    };

    const { orchestrator } = instantiate({ linear, config: configWithProject });

    await expect(
      orchestrator.createTask({
        title: 'Unknown project',
        effort: 3,
        project: 'unknown',
      })
    ).rejects.toThrow(/Project "unknown" is not configured/);
  });

  it('logs decomposition guidance for high-effort tasks with many uncertainties', async () => {
    const { orchestrator, linear, logger } = instantiate();

    const task = makeTask({ taskID: 'task-123', effort: 8, status: 'todo' });
    linear.createTask.mockResolvedValueOnce(task);

    const result = await orchestrator.createTask({
      title: 'High effort task',
      effort: 8,
      uncertainties: [
        { title: 'Risk 1', description: 'desc' },
        { title: 'Risk 2', description: 'desc' },
        { title: 'Risk 3', description: 'desc' },
      ],
    });

    expect(result).toEqual(task);
    expectMockContains(logger.log, 'requires decomposition');
    expectMockObjectTextContains(logger.log, 'High uncertainty count (3)');
  });

  it('blocks decomposition when uncertainties exist in block mode', async () => {
    const linear = new LinearStub();
    const parent = makeTask({
      taskID: 'parent',
      effort: 5,
      uncertainties: [{ title: 'Risk', description: 'desc' }],
    });
    linear.tasks.set(parent.taskID, parent);
    linear.getTask.mockResolvedValue(parent);

    const { orchestrator } = instantiate({ linear, uncertaintyMode: 'block' });

    await expect(
      orchestrator.decomposeTask({
        taskID: 'parent',
        subtasks: [{ title: 'Subtask', effort: 2 }],
      })
    ).rejects.toThrow(/unresolved uncertainties/);
  });

  it('warns but proceeds with decomposition when uncertainties exist in warn mode', async () => {
    const linear = new LinearStub();
    const logger = createLogger();
    const parent = makeTask({
      taskID: 'parent',
      effort: 8,
      uncertainties: [{ title: 'Risk', description: 'desc' }],
    });
    linear.tasks.set(parent.taskID, parent);
    linear.getTask.mockResolvedValue(parent);

    const { orchestrator } = instantiate({ linear, logger });

    const subtasks = await orchestrator.decomposeTask({
      taskID: 'parent',
      subtasks: [
        { title: 'Subtask A', effort: 2 },
        { title: 'Subtask B', effort: 3 },
      ],
    });

    expectMockContains(logger.warn, 'unresolved uncertainties');
    expect(subtasks).toHaveLength(2);
    expectMockContains(logger.log, 'decomposed into 2 subtasks');
  });

  it('validates subtask effort during decomposition', async () => {
    const linear = new LinearStub();
    const parent = makeTask({
      taskID: 'parent',
      effort: 5,
      uncertainties: [],
    });
    linear.tasks.set(parent.taskID, parent);
    linear.getTask.mockResolvedValue(parent);

    const { orchestrator } = instantiate({ linear });

    await expect(
      orchestrator.decomposeTask({
        taskID: 'parent',
        subtasks: [{ title: 'Invalid', effort: 0 as unknown as Task['effort'] }],
      })
    ).rejects.toThrow(/must be one of 1, 2, 3, 5, 8, 13, 21/);
  });

  it('applies task updates and reports tree completion', async () => {
    const linear = new LinearStub();
    const logger = createLogger();
    const child = makeTask({
      taskID: 'task-1-1',
      parentTaskID: 'task-1',
      status: 'done',
      effort: 2,
    });
    const baseTask = makeTask({
      taskID: 'task-1',
      status: 'in-progress',
      subtasks: [child],
      uncertainties: [{ title: 'Open risk', description: 'desc' }],
      labels: ['legacy'],
    });
    linear.tasks.set(baseTask.taskID, baseTask);
    linear.tasks.set(child.taskID, child);
    linear.getTask
      .mockResolvedValueOnce(baseTask)
      .mockResolvedValueOnce({
        ...baseTask,
        status: 'done',
        subtasks: [child],
        labels: ['legacy'],
      });

    const { orchestrator } = instantiate({ linear, logger });

    const updates = await orchestrator.updateTask({
      tasks: [
        {
          taskID: 'task-1',
          set: { status: 'done', description: 'updated description' },
          add: {
            lessonsLearned: [{ content: 'lesson' }],
            labels: ['new'],
          },
          remove: { labels: ['legacy'] },
          resolve: {
            uncertainties: [{ title: 'Open risk', resolution: 'handled' }],
          },
        },
      ],
    });

    expect(updates).toHaveLength(1);

    const updateCalls = linear.updateTask.mock.calls.map(([patch]) => patch);
    const statusUpdatePresent = updateCalls.some(
      (patch) => patch.status === 'done' && patch.description === 'updated description'
    );
    expect(statusUpdatePresent).toBe(true);

    expect(linear.addLessonLearned).toHaveBeenCalledWith('task-1', { content: 'lesson' });

    const labelsUpdate = updateCalls.find((patch) => patch.labels?.includes('new'));
    expect(labelsUpdate?.labels?.includes('new')).toBe(true);

    const labelsAfterRemoval = updateCalls.find(
      (patch) => Array.isArray(patch.labels) && patch.labels.length === 1 && patch.labels.includes('new')
    );
    expect(labelsAfterRemoval?.labels).toEqual(['new']);
    expect(linear.resolveUncertainty).toHaveBeenCalledWith(
      'task-1',
      'Open risk',
      'handled'
    );
    expectMockObjectTextContains(logger.log, 'Entire task tree completed');
  });

  it('updates effort fields via set.effort*', async () => {
    const linear = new LinearStub();
    const task = makeTask({
      taskID: 'task-2',
      effort: 3,
      labels: ['effort:3'],
    });
    linear.tasks.set(task.taskID, task);

    const { orchestrator } = instantiate({ linear });

    await orchestrator.updateTask({
      tasks: [
        {
          taskID: task.taskID,
          set: { effort: 8, complexityBias: 'high', effortReason: 'Spike validated scope' },
        },
      ],
    });

    expect(linear.updateTaskEffort).toHaveBeenCalledWith('task-2', {
      effort: 8,
      complexityBias: 'high',
      effortReason: 'Spike validated scope',
    });
    const updated = linear.tasks.get('task-2');
    expect(updated?.effort).toBe(8);
    expect(updated?.complexityBias).toBe('high');
    expect(updated?.effortReason).toBe('Spike validated scope');
    expect(updated?.labels).toContain('effort:8');
    expect(updated?.labels).toContain('needs-decomposition');
  });

  it('adds uncertainties via add.uncertainties', async () => {
    const linear = new LinearStub();
    const task = makeTask({
      taskID: 'task-3',
      uncertainties: [{ title: 'Existing risk', description: 'known' }],
    });
    linear.tasks.set(task.taskID, task);

    const { orchestrator } = instantiate({ linear });

    await orchestrator.updateTask({
      tasks: [
        {
          taskID: task.taskID,
          add: {
            uncertainties: [
              { title: 'New risk', description: 'fresh unknown' },
              { title: 'existing risk', description: 'duplicate should be ignored' },
            ],
          },
        },
      ],
    });

    expect(linear.addUncertainties).toHaveBeenCalledWith('task-3', [
      { title: 'New risk', description: 'fresh unknown' },
      { title: 'existing risk', description: 'duplicate should be ignored' },
    ]);

    const updated = linear.tasks.get('task-3');
    const titles = updated?.uncertainties?.map((uncertainty) => uncertainty.title);
    expect(titles).toContain('New risk');
    expect(titles?.filter((title) => title.toLowerCase() === 'existing risk')).toHaveLength(1);
  });

  it('lists tasks with status filter', async () => {
    const linear = new LinearStub();
    const todo = makeTask({ taskID: 'todo-1', status: 'todo', labels: ['alpha'] });
    const done = makeTask({ taskID: 'done-1', status: 'done' });
    linear.tasks.set(todo.taskID, todo);
    linear.tasks.set(done.taskID, done);

    const { orchestrator } = instantiate({ linear });

    const { tasks } = await orchestrator.listTasks({ filter: { status_in: ['todo'] } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskID).toBe('todo-1');
  });

  it('lists ready tasks via filter.ready, excluding blockers and enforcing status defaults', async () => {
    const linear = new LinearStub();
    const ready = makeTask({ taskID: 'ready-1', status: 'todo', uncertainties: [] });
    const blocked = makeTask({
      taskID: 'blocked-1',
      status: 'todo',
      uncertainties: [{ title: 'Risk', description: 'desc' }],
    });
    const needsDecomp = makeTask({
      taskID: 'needs-decomp-1',
      status: 'backlog',
      labels: ['needs-decomposition'],
      uncertainties: [],
    });
    const inProgress = makeTask({ taskID: 'in-progress-1', status: 'in-progress', uncertainties: [] });
    linear.tasks.set(ready.taskID, ready);
    linear.tasks.set(blocked.taskID, blocked);
    linear.tasks.set(needsDecomp.taskID, needsDecomp);
    linear.tasks.set(inProgress.taskID, inProgress);

    const { orchestrator } = instantiate({ linear });

    const { tasks } = await orchestrator.listTasks({ filter: { ready: true } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskID).toBe('ready-1');
  });

  it('queryTasks applies bulk operation', async () => {
    const linear = new LinearStub();
    const task = makeTask({ taskID: 'bulk-1', status: 'todo' });
    linear.tasks.set(task.taskID, task);

    const { orchestrator } = instantiate({ linear });

    const result = await orchestrator.queryTasks({
      filter: {},
      limit: 10,
      operation: { set: { status: 'in-progress' } },
    });

    expect(result.updated).toBe(1);
    expect(linear.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskID: 'bulk-1', status: 'in-progress' })
    );
  });

  it('throws when queryTasks lacks operations', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.queryTasks({ filter: {}, limit: 1, operation: {} })
    ).rejects.toThrow(/must include at least one of set\/add\/remove\/resolve/);
  });

  it('returns zero updates when queryTasks selects no tasks', async () => {
    const { orchestrator } = instantiate();

    const result = await orchestrator.queryTasks({
      filter: { status_in: ['todo'] },
      limit: 5,
      operation: { set: { status: 'done' } },
    });

    expect(result.matched).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.tasks).toEqual([]);
  });

  it('resolves uncertainties and optionally extracts to Notion', async () => {
    const linear = new LinearStub();
    const notion = new NotionStub();
    const logger = createLogger();
    const task = makeTask({
      taskID: 'task-1',
      uncertainties: [{ title: 'Risk', description: 'desc' }],
      title: 'Important task',
      project: 'alpha-uuid',
    });
    linear.tasks.set(task.taskID, task);
    linear.getTask.mockResolvedValue(task);

    const configWithAlpha: Config = {
      ...baseConfig,
      projects: {
        alpha: {
          linearProjectId: 'alpha-uuid',
          notionLessonsDbId: 'notion-lessons',
          notionLessonsDataSourceId: 'notion-lessons-ds',
          notionDecisionsDbId: 'notion-decisions',
          notionDecisionsDataSourceId: 'notion-decisions-ds',
        },
      },
    };

    const { orchestrator } = instantiate({ linear, notion, logger, config: configWithAlpha });

    await orchestrator.resolveUncertainty({
      taskID: 'task-1',
      uncertaintyTitle: 'Risk',
      resolution: 'Solved',
      extractToNotion: true,
      scope: 'project',
      tags: ['quality'],
    });

    expect(linear.resolveUncertainty).toHaveBeenCalledWith('task-1', 'Risk', 'Solved');
    expect(notion.createDecision).toHaveBeenCalled();
    expectMockContains(logger.log, 'Decision extracted');
  });

  it('extracts lessons to Notion and updates Linear', async () => {
    const linear = new LinearStub();
    const notion = new NotionStub();
    const logger = createLogger();
    const task = makeTask({
      taskID: 'task-1',
      title: 'Important task',
      project: 'alpha-uuid',
      effort: 5,
    });
    linear.tasks.set(task.taskID, task);
    linear.getTask.mockResolvedValue(task);

    const configWithAlpha: Config = {
      ...baseConfig,
      projects: {
        alpha: {
          linearProjectId: 'alpha-uuid',
          notionLessonsDbId: 'notion-lessons',
          notionLessonsDataSourceId: 'notion-lessons-ds',
          notionDecisionsDbId: 'notion-decisions',
          notionDecisionsDataSourceId: 'notion-decisions-ds',
        },
      },
    };

    const { orchestrator } = instantiate({ linear, notion, logger, config: configWithAlpha });

    const lesson = { content: 'Documented insight' };
    await orchestrator.extractLesson({
      taskID: 'task-1',
      lesson,
      scope: 'global',
      relatedConcepts: ['quality'],
    });

    expect(linear.addLessonLearned).toHaveBeenCalledWith('task-1', lesson);
    expect(notion.createLesson).toHaveBeenCalled();
    const effortArgs = notion.createLesson.mock.calls[0]?.[6];
    expect(effortArgs).toMatchObject({ effort: 5 });
    expectMockContains(logger.log, 'Lesson extracted');
  });

  it('proxies getTask and searchLessons to adapters', async () => {
    const linear = new LinearStub();
    const notion = new NotionStub();
    const logger = createLogger();
    const task = makeTask({ taskID: 'task-42' });
    linear.tasks.set(task.taskID, task);
    linear.getTask.mockResolvedValue(task);

    const { orchestrator } = instantiate({ linear, notion, logger });

    await expect(orchestrator.getTask('task-42')).resolves.toEqual(task);
    await orchestrator.searchLessons('retrospective', 'alpha');

    expect(notion.searchLessons).toHaveBeenCalledWith('retrospective', 'alpha');
  });

  it('throws when decomposeTask parent is missing', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.decomposeTask({ taskID: 'missing', subtasks: [{ title: 'Sub', effort: 3 }] })
    ).rejects.toThrow(/Task missing not found/);
  });

  it('throws when resolveUncertainty task is missing', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.resolveUncertainty({
        taskID: 'missing',
        uncertaintyTitle: 'Risk',
        resolution: 'done',
        extractToNotion: true,
      })
    ).rejects.toThrow(/Task missing not found/);
  });

  it('throws when resolveUncertainty cannot find uncertainty', async () => {
    const linear = new LinearStub();
    const task = makeTask({ taskID: 'task-missing', uncertainties: [{ title: 'Other' }] });
    linear.tasks.set(task.taskID, task);

    const { orchestrator } = instantiate({ linear });

    await expect(
      orchestrator.resolveUncertainty({
        taskID: task.taskID,
        uncertaintyTitle: 'Risk',
        resolution: 'done',
        extractToNotion: true,
      })
    ).rejects.toThrow(/Uncertainty "Risk" not found/);
  });

  it('throws when extractLesson task is missing', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.extractLesson({ taskID: 'missing', lesson: { content: 'lesson' } })
    ).rejects.toThrow(/Task missing not found/);
  });

  it('skips tree completion when root lookup fails', async () => {
    const linear = new LinearStub();
    const logger = createLogger();
    const task = makeTask({ taskID: 'child', status: 'done' });
    linear.tasks.set(task.taskID, task);

    const { orchestrator } = instantiate({ linear, logger });
    const orchestratorWithInternals = orchestrator as unknown as {
      checkTreeCompletion(task: Task): Promise<void>;
      findRootTask(task: Task): Promise<Task | null>;
    };

    const findRootSpy = vi
      .spyOn(orchestratorWithInternals, 'findRootTask')
      .mockResolvedValueOnce(null);

    await orchestratorWithInternals.checkTreeCompletion(task);

    expect(findRootSpy).toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('finds root task by traversing parent chain', async () => {
    const linear = new LinearStub();
    const parent = makeTask({ taskID: 'parent-task', status: 'done' });
    const child = makeTask({ taskID: 'child-task', status: 'done', parentTaskID: 'parent-task' });
    linear.tasks.set(parent.taskID, parent);
    linear.tasks.set(child.taskID, child);

    const { orchestrator } = instantiate({ linear });

    const resolved = await (orchestrator as unknown as { findRootTask(task: Task): Promise<Task | null> }).findRootTask(
      child
    );
    expect(resolved?.taskID).toBe('parent-task');
  });

  it('batch creates multiple independent tasks', async () => {
    const { orchestrator, linear } = instantiate();

    const tasks = await orchestrator.batchCreateTasks({
      tasks: [
        { title: 'Task A', effort: 2 },
        { title: 'Task B', effort: 3 },
        { title: 'Task C', effort: 1 },
      ],
    });

    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe('Task A');
    expect(tasks[1].title).toBe('Task B');
    expect(tasks[2].title).toBe('Task C');
    expect(linear.batchCreateTasks).toHaveBeenCalledTimes(1);
  });

  it('batch creates tasks with internal dependencies', async () => {
    const { orchestrator } = instantiate();

    const tasks = await orchestrator.batchCreateTasks({
      tasks: [
        { title: 'Design API', effort: 3 },
        { title: 'Implement API', effort: 5, dependsOnBatchIndex: [0], uncertainties: [{ title: 'Latency requirements' }] },
        { title: 'Write docs', effort: 2, dependsOnBatchIndex: [1] },
      ],
    });

    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe('Design API');
    expect(tasks[1].title).toBe('Implement API');
    expect(tasks[2].title).toBe('Write docs');
  });

  it('validates batch index is in range', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.batchCreateTasks({
        tasks: [
          { title: 'Task A', effort: 2 },
          { title: 'Task B', effort: 3, dependsOnBatchIndex: [5] }, // Out of range
        ],
      })
    ).rejects.toThrow(/out of range/);
  });

  it('validates batch index is not self-referential', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.batchCreateTasks({
        tasks: [
          { title: 'Task A', effort: 2, dependsOnBatchIndex: [0] }, // Self-reference
        ],
      })
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it('validates batch index only references earlier tasks', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.batchCreateTasks({
        tasks: [
          { title: 'Task A', effort: 2, dependsOnBatchIndex: [1] }, // Forward reference
          { title: 'Task B', effort: 3 },
        ],
      })
    ).rejects.toThrow(/must reference earlier tasks/);
  });

  it('validates effort >3 requires uncertainties in batch', async () => {
    const { orchestrator } = instantiate();

    await expect(
      orchestrator.batchCreateTasks({
        tasks: [
          { title: 'Complex task', effort: 5 }, // Missing uncertainties
        ],
      })
    ).rejects.toThrow(/no uncertainties/);
  });

  it('batch create enforces max batch size', async () => {
    const { orchestrator } = instantiate();

    const tasks = Array.from({ length: 51 }, (_, i) => ({
      title: `Task ${i}`,
      effort: 2 as Task['effort'],
    }));

    await expect(
      orchestrator.batchCreateTasks({ tasks })
    ).rejects.toThrow(/cannot exceed 50 tasks/);
  });
});
