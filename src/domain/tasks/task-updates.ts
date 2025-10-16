import type { Task, TaskPatch, UpdateTaskInput } from '../../types.js';
import type { LinearService } from '../../integrations/linear/service.js';

type UpdateContext = {
  linear: LinearService;
};

export async function applyTaskUpdates(input: UpdateTaskInput, context: UpdateContext): Promise<Task[]> {
  const updatedTasks: Task[] = [];

  for (const taskUpdate of input.tasks) {
    const { taskID, set, add, remove, resolve } = taskUpdate;

    let task = await context.linear.getTask(taskID);
    if (!task) {
      throw new Error(`Task ${taskID} not found`);
    }

    if (set) {
      const linearPatch: TaskPatch = { taskID };

      if (set.status !== undefined) linearPatch.status = set.status;
      if (set.description !== undefined) linearPatch.description = set.description;
      if (set.assignee !== undefined) linearPatch.assignee = set.assignee;
      if (set.dueDate !== undefined) linearPatch.dueDate = set.dueDate;

      const hasStandardUpdates =
        linearPatch.status !== undefined ||
        linearPatch.description !== undefined ||
        linearPatch.assignee !== undefined ||
        linearPatch.dueDate !== undefined;

      if (hasStandardUpdates) {
        task = await context.linear.updateTask(linearPatch);
      }

      if (
        set.effort !== undefined ||
        set.effortReason !== undefined ||
        set.complexityBias !== undefined
      ) {
        await context.linear.updateTaskEffort(taskID, {
          ...(set.effort !== undefined ? { effort: set.effort } : {}),
          ...(set.effortReason !== undefined ? { effortReason: set.effortReason } : {}),
          ...(set.complexityBias !== undefined ? { complexityBias: set.complexityBias } : {}),
        });
      }
    }

    if (add) {
      if (add.lessonsLearned) {
        for (const lesson of add.lessonsLearned) {
          await context.linear.addLessonLearned(taskID, lesson);
        }
      }

      if (add.uncertainties && add.uncertainties.length > 0) {
        await context.linear.addUncertainties(taskID, add.uncertainties);
      }

      if (add.labels && add.labels.length > 0) {
        const currentLabels = task.labels ?? [];
        const newLabels = [...new Set([...currentLabels, ...add.labels])];
        task = await context.linear.updateTask({ taskID, labels: newLabels });
      }
    }

    if (remove?.labels) {
      const currentLabels = task.labels ?? [];
      const nextLabels = currentLabels.filter((label) => !remove.labels!.includes(label));
      task = await context.linear.updateTask({ taskID, labels: nextLabels });
    }

    if (resolve?.uncertainties) {
      for (const uncertainty of resolve.uncertainties) {
        await context.linear.resolveUncertainty(taskID, uncertainty.title, uncertainty.resolution);
      }
    }

    task = await context.linear.getTask(taskID);
    if (!task) {
      throw new Error(`Task ${taskID} not found after update`);
    }

    updatedTasks.push(task);
  }

  return updatedTasks;
}
