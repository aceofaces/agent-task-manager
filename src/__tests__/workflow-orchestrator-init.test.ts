import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../integrations/linear/service.js', () => {
  return {
    LinearService: vi.fn().mockImplementation(() => ({
      listTasks: vi.fn(async () => ({ tasks: [], pageInfo: { hasNextPage: false } })),
      getTask: vi.fn(async () => null),
      getLinearClient: vi.fn(() => ({
        projects: vi.fn(async () => ({ nodes: [] })),
      })),
    })),
  };
});

vi.mock('../integrations/notion/service.js', () => {
  return {
    NotionService: vi.fn().mockImplementation(() => ({
      searchLessons: vi.fn(async () => []),
    })),
    NotionSearchResult: {} as unknown,
  };
});

vi.mock('../integrations/basic-memory/service.js', () => {
  return {
    BasicMemoryService: vi.fn().mockImplementation(() => ({
      searchLessons: vi.fn(async () => []),
    })),
  };
});

afterEach(() => {
  vi.resetModules();
});

describe('WorkflowOrchestrator (constructor wiring)', () => {
  it('instantiates default linear and notion services when not provided', async () => {
    const { WorkflowOrchestrator } = await import('../orchestrator/workflow-orchestrator.js');
    const linearModule = await import('../integrations/linear/service.js');
    const notionModule = await import('../integrations/notion/service.js');

    const orchestrator = new WorkflowOrchestrator({
      linear: { apiKey: 'linear-key', teamId: 'team-id' },
      storageBackend: 'notion',
      notion: { apiKey: 'notion-key' },
      projects: {},
    });

    expect(orchestrator).toBeTruthy();
    expect(linearModule.LinearService as unknown as Mock).toHaveBeenCalled();
    expect(notionModule.NotionService as unknown as Mock).toHaveBeenCalled();
  });

  it('instantiates basic-memory service with auto-discovery when projects is empty', async () => {
    const { WorkflowOrchestrator } = await import('../orchestrator/workflow-orchestrator.js');
    const linearModule = await import('../integrations/linear/service.js');
    const basicMemoryModule = await import('../integrations/basic-memory/service.js');

    const orchestrator = new WorkflowOrchestrator({
      linear: { apiKey: 'linear-key', teamId: 'team-id' },
      storageBackend: 'basic-memory',
      basicMemory: {
        rootPath: '/test/.memory',
        globalPath: '/test/.memory/global',
      },
      projects: {}, // Empty projects config - auto-discovery enabled
    });

    expect(orchestrator).toBeTruthy();
    expect(linearModule.LinearService as unknown as Mock).toHaveBeenCalled();
    expect(basicMemoryModule.BasicMemoryService as unknown as Mock).toHaveBeenCalled();
  });

  it('instantiates basic-memory service with explicit project mappings', async () => {
    const { WorkflowOrchestrator } = await import('../orchestrator/workflow-orchestrator.js');
    const basicMemoryModule = await import('../integrations/basic-memory/service.js');

    const orchestrator = new WorkflowOrchestrator({
      linear: { apiKey: 'linear-key', teamId: 'team-id' },
      storageBackend: 'basic-memory',
      basicMemory: {
        rootPath: '/test/.memory',
        globalPath: '/test/.memory/global',
      },
      projects: {
        'test-project': {
          linearProjectId: 'proj-123',
          path: '/test/.memory/projects/test-project',
        },
      },
    });

    expect(orchestrator).toBeTruthy();
    expect(basicMemoryModule.BasicMemoryService as unknown as Mock).toHaveBeenCalled();
  });

  it('throws when basic-memory backend is selected without basicMemory config', async () => {
    const { WorkflowOrchestrator } = await import('../orchestrator/workflow-orchestrator.js');

    expect(() => {
      new WorkflowOrchestrator({
        linear: { apiKey: 'linear-key', teamId: 'team-id' },
        storageBackend: 'basic-memory',
        projects: {},
      });
    }).toThrow(/basicMemory configuration required/);
  });
});
