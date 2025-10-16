import { describe, expect, it } from 'vitest';
import { filterTasks } from '../../domain/tasks/task-filters.js';
import type { Task } from '../../types.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  taskID: overrides.taskID ?? 'task-1',
  title: overrides.title ?? 'Task',
  status: overrides.status ?? 'todo',
  effort: overrides.effort ?? 3,
  uncertainties: overrides.uncertainties ?? [],
  labels: overrides.labels ?? [],
  lessonsLearned: overrides.lessonsLearned ?? [],
  ...overrides,
});

describe('filterTasks', () => {
  it('filters by explicit statuses', () => {
    const tasks = [
      makeTask({ taskID: 'todo', status: 'todo' }),
      makeTask({ taskID: 'done', status: 'done' }),
    ];
    const filtered = filterTasks(tasks, { status_in: ['done'] });
    expect(filtered.map((task) => task.taskID)).toEqual(['done']);
  });

  it('filters by labels and unresolved uncertainties', () => {
    const tasks = [
      makeTask({
        taskID: 'match',
        labels: ['feature'],
        uncertainties: [{ title: 'Closed', resolution: 'done' }],
      }),
      makeTask({
        taskID: 'mismatch',
        labels: ['bug'],
        uncertainties: [{ title: 'Open' }],
      }),
    ];

    const filtered = filterTasks(tasks, {
      labels_has_every: ['feature'],
      has_unresolved_uncertainties: false,
    });

    expect(filtered.map((task) => task.taskID)).toEqual(['match']);
  });

  it('filters ready tasks enforcing labels and statuses', () => {
    const tasks = [
      makeTask({
        taskID: 'ready',
        status: 'todo',
        uncertainties: [],
        labels: [],
      }),
      makeTask({
        taskID: 'needs-decomposition',
        status: 'todo',
        labels: ['needs-decomposition'],
      }),
      makeTask({
        taskID: 'blocked',
        status: 'todo',
        uncertainties: [{ title: 'Open' }],
      }),
    ];

    const filtered = filterTasks(tasks, { ready: true }, { readyStatuses: ['todo', 'backlog'] });
    expect(filtered.map((task) => task.taskID)).toEqual(['ready']);
  });

  it('searches by title with case-insensitive substring match', () => {
    const tasks = [
      makeTask({ taskID: 'task-1', title: 'Implement dark mode toggle' }),
      makeTask({ taskID: 'task-2', title: 'Fix authentication bug' }),
      makeTask({ taskID: 'task-3', title: 'Add user dashboard' }),
    ];

    const filtered = filterTasks(tasks, { search: 'dark' });
    expect(filtered.map((task) => task.taskID)).toEqual(['task-1']);

    const filteredUpper = filterTasks(tasks, { search: 'DARK' });
    expect(filteredUpper.map((task) => task.taskID)).toEqual(['task-1']);
  });

  it('searches by description with case-insensitive substring match', () => {
    const tasks = [
      makeTask({
        taskID: 'task-1',
        title: 'Feature A',
        description: 'Implement authentication with OAuth2',
      }),
      makeTask({
        taskID: 'task-2',
        title: 'Feature B',
        description: 'Add pagination to user list',
      }),
      makeTask({
        taskID: 'task-3',
        title: 'Feature C',
      }),
    ];

    const filtered = filterTasks(tasks, { search: 'oauth' });
    expect(filtered.map((task) => task.taskID)).toEqual(['task-1']);
  });

  it('searches across both title and description', () => {
    const tasks = [
      makeTask({ taskID: 'task-1', title: 'API endpoints' }),
      makeTask({ taskID: 'task-2', title: 'Dashboard', description: 'Add API integration' }),
      makeTask({ taskID: 'task-3', title: 'Settings page' }),
    ];

    const filtered = filterTasks(tasks, { search: 'API' });
    expect(filtered.map((task) => task.taskID)).toEqual(['task-1', 'task-2']);
  });

  it('returns empty array when search has no matches', () => {
    const tasks = [
      makeTask({ taskID: 'task-1', title: 'Implement feature' }),
      makeTask({ taskID: 'task-2', title: 'Fix bug' }),
    ];

    const filtered = filterTasks(tasks, { search: 'nonexistent' });
    expect(filtered).toEqual([]);
  });

  it('combines search with other filters', () => {
    const tasks = [
      makeTask({ taskID: 'task-1', title: 'Dark mode toggle', status: 'todo' }),
      makeTask({ taskID: 'task-2', title: 'Dark theme colors', status: 'done' }),
      makeTask({ taskID: 'task-3', title: 'Light theme', status: 'todo' }),
    ];

    const filtered = filterTasks(tasks, { search: 'dark', status_in: ['todo'] });
    expect(filtered.map((task) => task.taskID)).toEqual(['task-1']);
  });
});
