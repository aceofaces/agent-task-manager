import { describe, expect, it } from 'vitest';
import { isEntireTreeDone } from '../../domain/tasks/task-tree.js';
import type { Task } from '../../types.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  taskID: overrides.taskID ?? 'task-1',
  title: overrides.title ?? 'Root',
  status: overrides.status ?? 'todo',
  effort: overrides.effort ?? 3,
  subtasks: overrides.subtasks,
  uncertainties: overrides.uncertainties ?? [],
  lessonsLearned: overrides.lessonsLearned ?? [],
  labels: overrides.labels ?? [],
  ...overrides,
});

describe('isEntireTreeDone', () => {
  it('returns false when root is not done', async () => {
    const task = makeTask({ status: 'todo' });
    const result = await isEntireTreeDone(task, async () => task);
    expect(result).toBe(false);
  });

  it('returns false when any subtask is incomplete', async () => {
    const child = makeTask({ taskID: 'child', status: 'todo' });
    const task = makeTask({ status: 'done', subtasks: [child] });
    const result = await isEntireTreeDone(task, async () => child);
    expect(result).toBe(false);
  });

  it('loads nested children via loader when subtasks lack nested data', async () => {
    const child = makeTask({ taskID: 'child', status: 'done' });
    const task = makeTask({
      status: 'done',
      subtasks: [{ ...child, subtasks: undefined }],
    });

    const loader = async (taskID: string): Promise<Task | null> => {
      if (taskID === 'child') {
        return child;
      }
      return null;
    };

    const result = await isEntireTreeDone(task, loader);
    expect(result).toBe(true);
  });
});
