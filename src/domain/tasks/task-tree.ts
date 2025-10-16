import type { Task } from '../../types.js';

export async function isEntireTreeDone(task: Task, loader: (taskID: string) => Promise<Task | null>): Promise<boolean> {
  if (task.status !== 'done') {
    return false;
  }

  if (!task.subtasks || task.subtasks.length === 0) {
    return true;
  }

  for (const subtask of task.subtasks) {
    const enriched =
      subtask.subtasks && subtask.subtasks.length > 0
        ? subtask
        : await loader(subtask.taskID).then((loaded) => loaded ?? subtask);
    const subtreeDone = await isEntireTreeDone(enriched, loader);
    if (!subtreeDone) {
      return false;
    }
  }

  return true;
}
