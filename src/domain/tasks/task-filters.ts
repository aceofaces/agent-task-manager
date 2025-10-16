import type { Task } from '../../types.js';
import type { ListTasksInput } from '../../types.js';

export type TaskFilterContext = {
  readyStatuses?: Task['status'][];
};

export function filterTasks(tasks: Task[], filter: ListTasksInput['filter'], context: TaskFilterContext = {}): Task[] {
  if (!filter) {
    return tasks;
  }

  let filtered = tasks;

  if (filter.status_in && filter.status_in.length > 0) {
    const desired = new Set(filter.status_in);
    filtered = filtered.filter((task) => desired.has(task.status));
  } else if (filter.ready && context.readyStatuses) {
    const desired = new Set(context.readyStatuses);
    filtered = filtered.filter((task) => desired.has(task.status));
  }

  if (filter.labels_has_every && filter.labels_has_every.length > 0) {
    filtered = filtered.filter((task) => {
      const taskLabels = task.labels ?? [];
      return filter.labels_has_every!.every((label) => taskLabels.includes(label));
    });
  }

  if (typeof filter.has_unresolved_uncertainties === 'boolean') {
    filtered = filtered.filter((task) => {
      const hasUnresolved = (task.uncertainties ?? []).some((uncertainty) => !uncertainty.resolution);
      return filter.has_unresolved_uncertainties ? hasUnresolved : !hasUnresolved;
    });
  }

  if (filter.ready) {
    filtered = filtered.filter((task) => {
      const hasUnresolved = (task.uncertainties ?? []).some((uncertainty) => !uncertainty.resolution);
      const hasNeedsDecomposition = (task.labels ?? []).includes('needs-decomposition');
      return !hasUnresolved && !hasNeedsDecomposition;
    });
  }

  if (filter.search && filter.search.length > 0) {
    const searchTerm = filter.search.toLowerCase();
    filtered = filtered.filter((task) => {
      const titleMatch = task.title.toLowerCase().includes(searchTerm);
      const descriptionMatch = task.description?.toLowerCase().includes(searchTerm) ?? false;
      return titleMatch || descriptionMatch;
    });
  }

  return filtered;
}
