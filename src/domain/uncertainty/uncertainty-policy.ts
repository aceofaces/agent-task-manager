import type { Task, Uncertainty } from '../../types.js';
import { needsDecomposition } from '../effort/effort-policy.js';

export type UncertaintyResolutionMode = 'off' | 'warn' | 'block';

export class UncertaintyPolicy {
  private mode: UncertaintyResolutionMode;
  private warn: (message: unknown) => void;

  constructor(mode: UncertaintyResolutionMode, logger: Pick<typeof console, 'warn'>) {
    this.mode = mode;
    this.warn = logger.warn.bind(logger);
  }

  get resolutionMode(): UncertaintyResolutionMode {
    return this.mode;
  }

  validateForCreation(taskTitle: string, effort: number, uncertainties?: Array<Uncertainty | string>): void {
    if (!needsDecomposition(effort as Task['effort'])) {
      return;
    }

    const count = Array.isArray(uncertainties) ? uncertainties.length : 0;
    if (count === 0) {
      throw new Error(
        `Task "${taskTitle}" has effort ${effort} (>3) but no uncertainties. Add at least one uncertainty before decomposition.`
      );
    }
  }

  handleDecompositionGuard(task: Task): void {
    if (this.mode === 'off') {
      return;
    }

    const unresolvedCount =
      task.uncertainties?.filter((uncertainty) => !uncertainty.resolution && !uncertainty.resolvedAt)
        .length ?? 0;

    if (unresolvedCount === 0) {
      return;
    }

    const taskKey = task.linearIssueKey ?? task.taskID;
    const message = `Task ${taskKey} has ${unresolvedCount} unresolved uncertainties`;

    if (this.mode === 'block') {
      throw new Error(`${message}. Resolve them before decomposing using update_task with resolve operation.`);
    }

    this.warn(`⚠️  ${message}. Proceeding anyway (warn mode).`);
  }
}
