import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../integrations/linear/service.js', () => {
  return {
    LinearService: vi.fn().mockImplementation(() => ({
      listTasks: vi.fn(async () => ({ tasks: [], pageInfo: { hasNextPage: false } })),
      getTask: vi.fn(async () => null),
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
});
