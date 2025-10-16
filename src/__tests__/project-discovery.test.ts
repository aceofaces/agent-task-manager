import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectDiscovery } from '../config/project-discovery.js';
import type { LinearClient } from '@linear/sdk';

// Mock filesystem
vi.mock('fs/promises');

describe('ProjectDiscovery', () => {
  const mockLinearClient = {
    projects: vi.fn(),
  } as unknown as LinearClient;

  const rootPath = '/test/.memory';
  const cacheFile = path.join(rootPath, '.agent-task-manager.json');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers project from Linear API when not cached', async () => {
    const mockProjects = {
      nodes: [
        { id: 'proj-123', name: 'Agent Task Manager' },
        { id: 'proj-456', name: 'Basic Memory' },
      ],
    };

    (mockLinearClient.projects as ReturnType<typeof vi.fn>).mockResolvedValue(mockProjects);
    (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 'ENOENT' });
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);
    const project = await discovery.getProject('Agent Task Manager');

    expect(project).toEqual({
      linearProjectId: 'proj-123',
      linearProjectName: 'Agent Task Manager',
      path: path.join(rootPath, 'projects', 'agent-task-manager'),
      discoveredAt: expect.any(String),
    });

    expect(mockLinearClient.projects).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      cacheFile,
      expect.stringContaining('Agent Task Manager'),
      'utf-8'
    );
  });

  it('uses cached project when available', async () => {
    const cachedData = {
      version: '1.0',
      lastSync: '2025-01-01T00:00:00Z',
      projects: {
        'Agent Task Manager': {
          linearProjectId: 'proj-123',
          linearProjectName: 'Agent Task Manager',
          path: '/test/.memory/projects/agent-task-manager',
          discoveredAt: '2025-01-01T00:00:00Z',
        },
      },
    };

    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(cachedData));

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);
    const project = await discovery.getProject('Agent Task Manager');

    expect(project).toEqual(cachedData.projects['Agent Task Manager']);
    expect(mockLinearClient.projects).not.toHaveBeenCalled();
  });

  it('throws error when project not found in Linear', async () => {
    const mockProjects = {
      nodes: [
        { id: 'proj-123', name: 'Agent Task Manager' },
      ],
    };

    (mockLinearClient.projects as ReturnType<typeof vi.fn>).mockResolvedValue(mockProjects);
    (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 'ENOENT' });

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);

    await expect(discovery.getProject('Unknown Project')).rejects.toThrow(
      /Project "Unknown Project" not found in Linear/
    );
  });

  it('performs case-insensitive project name matching', async () => {
    const mockProjects = {
      nodes: [
        { id: 'proj-123', name: 'Agent Task Manager' },
      ],
    };

    (mockLinearClient.projects as ReturnType<typeof vi.fn>).mockResolvedValue(mockProjects);
    (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 'ENOENT' });
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);
    const project = await discovery.getProject('agent task manager');

    expect(project.linearProjectId).toBe('proj-123');
    expect(project.linearProjectName).toBe('Agent Task Manager');
  });

  it('sanitizes project names for filesystem paths', async () => {
    const mockProjects = {
      nodes: [
        { id: 'proj-123', name: 'My Project (2024)' },
      ],
    };

    (mockLinearClient.projects as ReturnType<typeof vi.fn>).mockResolvedValue(mockProjects);
    (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 'ENOENT' });
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);
    const project = await discovery.getProject('My Project (2024)');

    expect(project.path).toBe(path.join(rootPath, 'projects', 'my-project-2024'));
  });

  it('loads cache on first use', async () => {
    const cachedData = {
      version: '1.0',
      lastSync: '2025-01-01T00:00:00Z',
      projects: {
        'Project A': {
          linearProjectId: 'proj-a',
          linearProjectName: 'Project A',
          path: '/test/.memory/projects/project-a',
          discoveredAt: '2025-01-01T00:00:00Z',
        },
        'Project B': {
          linearProjectId: 'proj-b',
          linearProjectName: 'Project B',
          path: '/test/.memory/projects/project-b',
          discoveredAt: '2025-01-01T00:00:00Z',
        },
      },
    };

    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(cachedData));

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);

    // First access should load cache
    await discovery.getProject('Project A');

    // Second access should use loaded cache (not read file again)
    await discovery.getProject('Project B');

    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('handles cache read errors gracefully', async () => {
    const mockProjects = {
      nodes: [
        { id: 'proj-123', name: 'Test Project' },
      ],
    };

    (mockLinearClient.projects as ReturnType<typeof vi.fn>).mockResolvedValue(mockProjects);
    (fs.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient, { logger });
    const project = await discovery.getProject('Test Project');

    expect(project.linearProjectId).toBe('proj-123');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load project cache'));
  });

  it('clears specific project from cache', async () => {
    const cachedData = {
      version: '1.0',
      lastSync: '2025-01-01T00:00:00Z',
      projects: {
        'Project A': {
          linearProjectId: 'proj-a',
          linearProjectName: 'Project A',
          path: '/test/.memory/projects/project-a',
          discoveredAt: '2025-01-01T00:00:00Z',
        },
      },
    };

    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(cachedData));

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);

    // Load cache
    await discovery.getProject('Project A');
    expect(discovery.hasProject('Project A')).toBe(true);

    // Clear project
    discovery.clearProject('Project A');
    expect(discovery.hasProject('Project A')).toBe(false);
  });

  it('returns all cached projects', async () => {
    const cachedData = {
      version: '1.0',
      lastSync: '2025-01-01T00:00:00Z',
      projects: {
        'Project A': {
          linearProjectId: 'proj-a',
          linearProjectName: 'Project A',
          path: '/test/.memory/projects/project-a',
          discoveredAt: '2025-01-01T00:00:00Z',
        },
        'Project B': {
          linearProjectId: 'proj-b',
          linearProjectName: 'Project B',
          path: '/test/.memory/projects/project-b',
          discoveredAt: '2025-01-01T00:00:00Z',
        },
      },
    };

    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(cachedData));

    const discovery = new ProjectDiscovery(rootPath, mockLinearClient);

    // Trigger cache load
    await discovery.getProject('Project A');

    const cached = discovery.getCachedProjects();
    expect(cached.size).toBe(2);
    expect(cached.has('Project A')).toBe(true);
    expect(cached.has('Project B')).toBe(true);
  });
});
