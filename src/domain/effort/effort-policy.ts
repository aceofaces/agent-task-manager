import { FIBONACCI_EFFORT_VALUES, isFibonacciEffort } from '../../types.js';
import type { FibonacciEffort } from '../../types.js';

export const needsDecomposition = (effort: FibonacciEffort): boolean => effort > 3;

export function assertValidEffort(effort: number): asserts effort is FibonacciEffort {
  if (!isFibonacciEffort(effort)) {
    throw new Error(
      `Task effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}, got ${String(effort)}`
    );
  }
}

export function assertSubtaskEffort(effort: number): asserts effort is FibonacciEffort {
  assertValidEffort(effort);
}

/**
 * Validate that effort reason is provided for high-effort tasks
 * Returns a warning message if effortReason is missing for effort >3
 */
export function validateEffortReason(
  effort: FibonacciEffort,
  effortReason: string | undefined
): string | null {
  if (effort > 3 && !effortReason) {
    return `⚠️ Effort ${effort} task should include effortReason to document complexity`;
  }
  return null;
}
