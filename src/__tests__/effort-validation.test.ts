
import { describe, expect, it } from 'vitest';
import { FIBONACCI_EFFORT_VALUES, isFibonacciEffort } from '../types.js';

const isValidEffort = (effort: number): boolean => isFibonacciEffort(effort);

const needsDecomposition = (effort: number): boolean => effort > 3;

const validateTaskInput = (
  effort: number,
  uncertainties?: Array<{ title: string; description?: string }>
): { valid: boolean; error?: string } => {
  if (!isValidEffort(effort)) {
    return {
      valid: false,
      error: `Effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}, got ${effort}`,
    };
  }

  if (needsDecomposition(effort) && (!uncertainties || uncertainties.length === 0)) {
    return {
      valid: false,
      error: `Tasks with effort ${effort} (>3) require at least one uncertainty`,
    };
  }

  return { valid: true };
};

const isValidComplexityBias = (bias?: string): boolean =>
  typeof bias === 'undefined' || bias === 'low' || bias === 'medium' || bias === 'high';

const validateEffortFields = (
  payload: unknown
): payload is { effort: number; effortReason?: string; complexityBias?: string } => {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.effort !== 'number' || !isValidEffort(candidate.effort)) {
    return false;
  }

  if (typeof candidate.effortReason !== 'undefined') {
    if (typeof candidate.effortReason !== 'string' || candidate.effortReason.trim().length === 0) {
      return false;
    }
  }

  if (
    typeof candidate.complexityBias !== 'undefined' &&
    (typeof candidate.complexityBias !== 'string' || !isValidComplexityBias(candidate.complexityBias))
  ) {
    return false;
  }

  return true;
};

const buildMetadataSection = (
  effort: number,
  options: { complexityBias?: string; effortReason?: string } = {}
): string => {
  const lines = [`**Effort:** ${effort}`];
  if (options.effortReason) {
    lines.push(`**Effort Reason:** ${options.effortReason}`);
  }
  if (options.complexityBias) {
    lines.push(`**Complexity Bias:** ${options.complexityBias}`);
  }
  return lines.join('\n');
};

describe('Task effort validation helpers', () => {
  it('validates effort range boundaries', () => {
    for (const effort of FIBONACCI_EFFORT_VALUES) {
      expect(isValidEffort(effort)).toBe(true);
    }

    expect(isValidEffort(0)).toBe(false);
    expect(isValidEffort(4)).toBe(false);
    expect(isValidEffort(10)).toBe(false);
    expect(isValidEffort(11)).toBe(false);
    expect(isValidEffort(2.5)).toBe(false);
  });

  it('determines when decomposition is required', () => {
    expect(needsDecomposition(3)).toBe(false);
    expect(needsDecomposition(4)).toBe(true);
  });

  it('validates high-effort tasks require uncertainties', () => {
    expect(validateTaskInput(2)).toEqual({ valid: true });
    expect(
      validateTaskInput(
        5,
        [{ title: 'Integration risk' }]
      )
    ).toEqual({ valid: true });
    const highEffortResult = validateTaskInput(8);
    expect(highEffortResult.valid).toBe(false);
    expect(highEffortResult.error).toContain('require at least one uncertainty');
  });

  it('guards complexity bias values', () => {
    expect(isValidComplexityBias()).toBe(true);
    expect(isValidComplexityBias('medium')).toBe(true);
    expect(isValidComplexityBias('unknown')).toBe(false);
  });

  it('validates task effort structures', () => {
    expect(validateEffortFields({ effort: 5 })).toBe(true);
    expect(validateEffortFields({ effort: 12 })).toBe(false);
    expect(validateEffortFields(null)).toBe(false);
    expect(validateEffortFields({ effort: 5, complexityBias: 'high' })).toBe(true);
    expect(validateEffortFields({ effort: 5, effortReason: 'Sized after spike' })).toBe(true);
  });

  it('builds metadata snippets for effort summaries', () => {
    expect(buildMetadataSection(5)).toContain('**Effort:** 5');
    expect(
      buildMetadataSection(8, { complexityBias: 'high', effortReason: 'Spike validated scope' })
    ).toContain('**Complexity Bias:** high');
    expect(
      buildMetadataSection(8, { complexityBias: 'high', effortReason: 'Spike validated scope' })
    ).toContain('**Effort Reason:** Spike validated scope');
  });
});
