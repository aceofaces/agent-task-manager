import { describe, expect, it, vi } from 'vitest';
import { UncertaintyPolicy } from '../../domain/uncertainty/uncertainty-policy.js';
import type { Task } from '../../types.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  taskID: overrides.taskID ?? 'task-1',
  title: overrides.title ?? 'Sample Task',
  effort: overrides.effort ?? 5,
  status: overrides.status ?? 'todo',
  uncertainties: overrides.uncertainties ?? [
    { title: 'Risk', description: 'unknown' },
  ],
  lessonsLearned: overrides.lessonsLearned ?? [],
  labels: overrides.labels ?? [],
  ...overrides,
});

describe('UncertaintyPolicy', () => {
  it('enforces high-effort tasks to declare uncertainties when creating', () => {
    const policy = new UncertaintyPolicy('warn', console);
    expect(() =>
      policy.validateForCreation('Big task', 8, [{ title: 'Risk A' }])
    ).not.toThrow();

    expect(() => policy.validateForCreation('Big task', 8, [])).toThrow(
      /has effort 8 \(>3\) but no uncertainties/
    );
  });

  it('allows low-effort tasks without uncertainties', () => {
    const policy = new UncertaintyPolicy('warn', console);
    expect(() => policy.validateForCreation('Small task', 2, [])).not.toThrow();
  });

  it('throws in block mode when unresolved uncertainties exist', () => {
    const warn = vi.fn();
    const policy = new UncertaintyPolicy('block', { warn } as unknown as Pick<typeof console, 'warn'>);
    const task = makeTask({
      uncertainties: [{ title: 'Open', description: 'unknown', resolution: undefined }],
    });
    expect(() => policy.handleDecompositionGuard(task)).toThrow(/unresolved uncertainties/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs warning in warn mode and allows decomposition', () => {
    const warn = vi.fn();
    const policy = new UncertaintyPolicy('warn', { warn } as unknown as Pick<typeof console, 'warn'>);
    const task = makeTask({
      uncertainties: [{ title: 'Open', description: 'unknown', resolution: undefined }],
    });
    expect(() => policy.handleDecompositionGuard(task)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Proceeding anyway (warn mode)'));
  });

  it('skips checks when mode is off', () => {
    const warn = vi.fn();
    const policy = new UncertaintyPolicy('off', { warn } as unknown as Pick<typeof console, 'warn'>);
    const task = makeTask({
      uncertainties: [{ title: 'Open', description: 'unknown', resolution: undefined }],
    });
    expect(() => policy.handleDecompositionGuard(task)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
