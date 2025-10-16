import { describe, expect, it, vi } from 'vitest';
import { applyTaskUpdates } from '../../domain/tasks/task-updates.js';
import type { Task, UpdateTaskInput, LessonLearned, Uncertainty } from '../../types.js';
import type { LinearService } from '../../integrations/linear/service.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  taskID: overrides.taskID ?? 'task-1',
  title: overrides.title ?? 'Root task',
  effort: overrides.effort ?? 3,
  status: overrides.status ?? 'todo',
  uncertainties: overrides.uncertainties ?? [],
  lessonsLearned: overrides.lessonsLearned ?? [],
  labels: overrides.labels ?? [],
  ...overrides,
});

class LinearMock {
  public tasks = new Map<string, Task>();

  public getTask = vi.fn(async (taskID: string): Promise<Task | null> => {
    return this.tasks.get(taskID) ?? null;
  });

  public updateTask = vi.fn(
    async ({ taskID, status, description, labels }: { taskID: string; status?: Task['status']; description?: string; labels?: string[] }): Promise<Task> => {
      const current = this.tasks.get(taskID);
      if (!current) {
        throw new Error(`Task ${taskID} not found`);
      }
      const next: Task = {
        ...current,
        ...(status ? { status } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(labels ? { labels } : {}),
      };
      this.tasks.set(taskID, next);
      return next;
    }
  );

  public updateTaskEffort = vi.fn(
    async (taskID: string, payload: { effort?: number; effortReason?: string; complexityBias?: string }) => {
      const current = this.tasks.get(taskID);
      if (!current) {
        throw new Error(`Task ${taskID} not found`);
      }
      const next: Task = {
        ...current,
        ...(payload.effort ? { effort: payload.effort as Task['effort'] } : {}),
        ...(payload.effortReason ? { effortReason: payload.effortReason } : {}),
        ...(payload.complexityBias ? { complexityBias: payload.complexityBias as Task['complexityBias'] } : {}),
      };
      this.tasks.set(taskID, next);
    }
  );

  public addLessonLearned = vi.fn(async (taskID: string, lesson: LessonLearned) => {
    const current = this.tasks.get(taskID);
    if (!current) return;
    current.lessonsLearned = [...(current.lessonsLearned ?? []), lesson];
  });

  public addUncertainties = vi.fn(async (taskID: string, uncertainties: Uncertainty[]) => {
    const current = this.tasks.get(taskID);
    if (!current) return;
    current.uncertainties = [...(current.uncertainties ?? []), ...uncertainties];
  });

  public resolveUncertainty = vi.fn(async (taskID: string, title: string, resolution?: string) => {
    const current = this.tasks.get(taskID);
    if (!current) return;
    const target = current.uncertainties?.find((item) => item.title === title);
    if (target) {
      target.resolution = resolution;
    }
  });
}

describe('applyTaskUpdates', () => {
  it('applies set/add/remove/resolve operations', async () => {
    const linear = new LinearMock();
    const baseTask = makeTask({
      uncertainties: [{ title: 'Open risk' }],
      labels: ['legacy'],
    });
    linear.tasks.set(baseTask.taskID, baseTask);

    const input: UpdateTaskInput = {
      tasks: [
        {
          taskID: baseTask.taskID,
          set: {
            status: 'done',
            description: 'Updated',
            effort: 5,
            effortReason: 'Re-estimated',
            complexityBias: 'high',
          },
          add: {
            lessonsLearned: [{ content: 'Captured lesson' }],
            uncertainties: [{ title: 'New risk', description: 'fresh' }],
            labels: ['new'],
          },
          remove: { labels: ['legacy'] },
          resolve: { uncertainties: [{ title: 'Open risk', resolution: 'handled' }] },
        },
      ],
    };

    const [updated] = await applyTaskUpdates(input, {
      linear: linear as unknown as LinearService,
    });

    expect(updated.status).toBe('done');
    expect(updated.description).toBe('Updated');
    expect(updated.effort).toBe(5);
    expect(updated.effortReason).toBe('Re-estimated');
    expect(updated.complexityBias).toBe('high');
    expect(updated.labels).toContain('new');
    expect(updated.labels).not.toContain('legacy');

    expect(linear.updateTaskEffort).toHaveBeenCalledWith(baseTask.taskID, {
      effort: 5,
      effortReason: 'Re-estimated',
      complexityBias: 'high',
    });

    expect(updated.lessonsLearned?.at(-1)?.content).toBe('Captured lesson');
    const newRisk = updated.uncertainties?.find((item) => item.title === 'New risk');
    expect(newRisk?.description).toBe('fresh');
    const openRisk = updated.uncertainties?.find((item) => item.title === 'Open risk');
    expect(openRisk?.resolution).toBe('handled');
  });

  it('throws when task does not exist', async () => {
    const linear = new LinearMock();
    const input: UpdateTaskInput = {
      tasks: [{ taskID: 'missing', set: { status: 'done' } }],
    };

    await expect(
      applyTaskUpdates(input, { linear: linear as unknown as LinearService })
    ).rejects.toThrow(
      /Task missing not found/
    );
  });
});
