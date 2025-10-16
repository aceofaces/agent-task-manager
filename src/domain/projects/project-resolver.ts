import type { Config, ProjectsConfig } from '../../types.js';

export class ProjectResolver {
  private projects: ProjectsConfig;
  private defaultProject?: string;
  private log: (message: unknown) => void;
  private warn: (message: unknown) => void;

  constructor(config: Pick<Config, 'projects' | 'defaultProject'>, logger: Pick<typeof console, 'log' | 'warn'>) {
    this.projects = config.projects;
    this.defaultProject = config.defaultProject;
    this.log = logger.log.bind(logger);
    this.warn = logger.warn.bind(logger);
  }

  resolve(requested?: string): string | undefined {
    if (requested) {
      if (!this.projects[requested]) {
        const available = Object.keys(this.projects);
        const availableLabel = available.length > 0 ? available.join(', ') : 'none configured';
        throw new Error(
          `Project "${requested}" is not configured. Available projects: ${availableLabel}`
        );
      }
      return requested;
    }

    if (this.defaultProject && this.projects[this.defaultProject]) {
      return this.defaultProject;
    }

    const projectKeys = Object.keys(this.projects);

    if (projectKeys.length === 1) {
      const [soleProject] = projectKeys;
      this.log(`ℹ️ No project specified; defaulting to "${soleProject}" from PROJECT_MAPPINGS.`);
      return soleProject;
    }

    if (projectKeys.length > 1) {
      this.warn(
        `⚠️ No project specified and multiple projects configured (${projectKeys.join(
          ', '
        )}). Provide "project" when creating tasks or set DEFAULT_PROJECT.`
      );
    }

    return undefined;
  }

  /**
   * Reverse lookup: Resolve Linear project UUID to project key
   * Used when task.project contains Linear UUID but we need the project key
   */
  resolveFromLinearProjectId(linearProjectId?: string): string | undefined {
    if (!linearProjectId) {
      return undefined;
    }

    // Search through all projects for matching linearProjectId
    for (const [projectKey, projectConfig] of Object.entries(this.projects)) {
      if (projectConfig.linearProjectId === linearProjectId) {
        return projectKey;
      }
    }

    return undefined;
  }
}
