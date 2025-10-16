/**
 * Automatic project discovery for basic-memory backend
 *
 * Discovers Linear projects on-demand and caches configuration locally.
 * Eliminates need for PROJECT_MAPPINGS environment variable.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { LinearClient } from '@linear/sdk';

export interface DiscoveredProject {
  linearProjectId: string;
  linearProjectName: string;
  path: string;
  discoveredAt: string;
}

export interface ProjectCacheData {
  version: string;
  lastSync?: string;
  projects: Record<string, DiscoveredProject>;
}

type ProjectDiscoveryLogger = Pick<typeof console, 'log' | 'warn' | 'error'>;

export class ProjectDiscovery {
  private cache: Map<string, DiscoveredProject> = new Map();
  private cacheFile: string;
  private rootPath: string;
  private linearClient: LinearClient;
  private logger: ProjectDiscoveryLogger;
  private cacheLoaded = false;

  constructor(
    rootPath: string,
    linearClient: LinearClient,
    options: { logger?: ProjectDiscoveryLogger } = {}
  ) {
    this.rootPath = rootPath;
    this.linearClient = linearClient;
    this.logger = options.logger ?? console;
    this.cacheFile = path.join(rootPath, '.agent-task-manager.json');
  }

  /**
   * Get project configuration, discovering from Linear if not cached
   */
  async getProject(projectName: string): Promise<DiscoveredProject> {
    // Ensure cache is loaded
    if (!this.cacheLoaded) {
      await this.loadCache();
    }

    // Check cache first
    if (this.cache.has(projectName)) {
      return this.cache.get(projectName)!;
    }

    // Discover from Linear
    this.logger.log(`🔍 Discovering project "${projectName}" from Linear...`);
    const discovered = await this.discoverFromLinear(projectName);

    // Save to cache
    this.cache.set(projectName, discovered);
    await this.saveCache();

    this.logger.log(`✨ Project "${projectName}" discovered and cached`);
    this.logger.log(`   Path: ${discovered.path}`);

    return discovered;
  }

  /**
   * Check if project is already cached
   */
  hasProject(projectName: string): boolean {
    return this.cache.has(projectName);
  }

  /**
   * Get all cached projects
   */
  getCachedProjects(): Map<string, DiscoveredProject> {
    return new Map(this.cache);
  }

  /**
   * Clear cache for a specific project (forces re-discovery)
   */
  clearProject(projectName: string): void {
    this.cache.delete(projectName);
  }

  /**
   * Discover project from Linear API
   */
  private async discoverFromLinear(projectName: string): Promise<DiscoveredProject> {
    // Query Linear for projects
    const projects = await this.linearClient.projects();

    // Find by name (case-insensitive)
    const project = projects.nodes.find(
      (p) => p.name.toLowerCase() === projectName.toLowerCase()
    );

    if (!project) {
      throw new Error(
        `Project "${projectName}" not found in Linear. ` +
          `Available projects: ${projects.nodes.map((p) => p.name).join(', ')}`
      );
    }

    // Generate storage path
    const sanitizedName = this.sanitizeProjectName(project.name);
    const storagePath = path.join(this.rootPath, 'projects', sanitizedName);

    return {
      linearProjectId: project.id,
      linearProjectName: project.name,
      path: storagePath,
      discoveredAt: new Date().toISOString(),
    };
  }

  /**
   * Sanitize project name for filesystem use
   */
  private sanitizeProjectName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Load cache from disk
   */
  private async loadCache(): Promise<void> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(data) as ProjectCacheData;

      // Load projects into cache
      for (const [name, config] of Object.entries(parsed.projects)) {
        this.cache.set(name, config);
      }

      this.cacheLoaded = true;
      this.logger.log(`📂 Loaded ${this.cache.size} project(s) from cache`);
    } catch (error) {
      // Cache file doesn't exist yet - this is fine
      if ((error as { code?: string })?.code === 'ENOENT') {
        this.cacheLoaded = true;
        return;
      }

      this.logger.warn(`Failed to load project cache: ${(error as Error).message}`);
      this.cacheLoaded = true;
    }
  }

  /**
   * Save cache to disk
   */
  private async saveCache(): Promise<void> {
    const data: ProjectCacheData = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      projects: Object.fromEntries(this.cache.entries()),
    };

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });

      // Write cache file
      await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to save project cache: ${(error as Error).message}`);
    }
  }
}
