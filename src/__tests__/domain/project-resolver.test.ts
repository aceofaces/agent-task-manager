import { describe, expect, it, vi } from 'vitest';
import { ProjectResolver } from '../../domain/projects/project-resolver.js';
import type { Config } from '../../types.js';

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  linear: { apiKey: 'linear', teamId: 'team' },
  storageBackend: 'notion',
  notion: { apiKey: 'notion' },
  projects: {
    alpha: {
      linearProjectId: 'linear-alpha',
      notionLessonsDbId: 'lessons-alpha',
      notionLessonsDataSourceId: 'lessons-source-alpha',
      notionDecisionsDbId: 'decisions-alpha',
      notionDecisionsDataSourceId: 'decisions-source-alpha',
    },
    beta: {
      linearProjectId: 'linear-beta',
      notionLessonsDbId: 'lessons-beta',
      notionLessonsDataSourceId: 'lessons-source-beta',
      notionDecisionsDbId: 'decisions-beta',
      notionDecisionsDataSourceId: 'decisions-source-beta',
    },
  },
  defaultProject: undefined,
  ...overrides,
});

const makeResolver = (
  config: Config,
  loggerOverrides: Partial<Pick<typeof console, 'log' | 'warn' | 'error'>> = {}
) => {
  const baseLogger: Pick<typeof console, 'log' | 'warn' | 'error'> = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const logger = Object.assign(baseLogger, loggerOverrides);

  const resolver = new ProjectResolver(config, logger);
  return { resolver, logger };
};

describe('ProjectResolver', () => {
  it('returns requested project when configured', () => {
    const { resolver } = makeResolver(makeConfig());
    expect(resolver.resolve('alpha')).toBe('alpha');
  });

  it('throws when project is unknown', () => {
    const { resolver } = makeResolver(makeConfig());
    expect(() => resolver.resolve('ghost')).toThrow(/Project "ghost" is not configured/);
  });

  it('falls back to explicit default project', () => {
    const config = makeConfig({ defaultProject: 'beta' });
    const { resolver } = makeResolver(config);
    expect(resolver.resolve()).toBe('beta');
  });

  it('logs when auto-selecting sole project', () => {
    const config = makeConfig({
      projects: {
        solo: {
          linearProjectId: 'linear-solo',
          notionLessonsDbId: 'lessons-solo',
          notionLessonsDataSourceId: 'lessons-source-solo',
          notionDecisionsDbId: 'decisions-solo',
          notionDecisionsDataSourceId: 'decisions-source-solo',
        },
      },
    });
    const { resolver, logger } = makeResolver(config);
    expect(resolver.resolve()).toBe('solo');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('defaulting to "solo"'));
  });

  it('warns when multiple projects exist without default', () => {
    const { resolver, logger } = makeResolver(makeConfig());
    expect(resolver.resolve()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Provide "project" when creating tasks')
    );
  });
});
