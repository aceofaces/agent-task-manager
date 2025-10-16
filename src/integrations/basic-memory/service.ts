/**
 * Basic Memory service for storing lessons and decisions as markdown files
 *
 * This service writes markdown files following basic-memory conventions:
 * - Frontmatter with metadata
 * - Observations: [category] content #tag
 * - Relations: relation_type [[WikiLink]]
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  LessonLearned,
  Uncertainty,
} from '../../types.js';
import type { KnowledgeStorageService, SearchResult } from '../storage-service.js';

export interface BasicMemoryConfig {
  rootPath: string; // Root directory for all basic-memory projects
  projects: Record<string, BasicMemoryProjectConfig>;
  globalPath?: string; // Optional global knowledge path
}

export interface BasicMemoryProjectConfig {
  path: string; // Project-specific path
  lessonsFolder?: string; // Folder for lessons (default: 'lessons')
  decisionsFolder?: string; // Folder for decisions (default: 'decisions')
}

export class BasicMemoryService implements KnowledgeStorageService {
  private config: BasicMemoryConfig;

  constructor(config: BasicMemoryConfig) {
    this.config = config;
  }

  /**
   * Create a lesson as a markdown note
   */
  async createLesson(
    taskID: string,
    taskTitle: string,
    lesson: LessonLearned,
    project?: string,
    scope: 'project' | 'global' = 'project',
    relatedConcepts?: string[],
    effortDetails?: { effort?: number; effortReason?: string; complexityBias?: string }
  ): Promise<string> {
    // Determine target path
    const targetPath = this.resolveTargetPath(scope, project);
    const lessonsFolder = scope === 'global'
      ? 'lessons'
      : (project && this.config.projects[project]?.lessonsFolder) || 'lessons';

    const folderPath = path.join(targetPath, lessonsFolder);
    await fs.mkdir(folderPath, { recursive: true });

    // Generate filename from content
    const filename = this.generateFilename(lesson.content);
    const filePath = path.join(folderPath, `${filename}.md`);

    // Build markdown content
    const markdown = this.buildLessonMarkdown(
      taskID,
      taskTitle,
      lesson,
      project,
      scope,
      relatedConcepts,
      effortDetails
    );

    // Write file
    await fs.writeFile(filePath, markdown, 'utf-8');

    return filePath;
  }

  /**
   * Create a decision/uncertainty resolution as a markdown note
   */
  async createDecision(
    taskID: string,
    taskTitle: string,
    uncertainty: Uncertainty,
    project?: string,
    scope: 'project' | 'global' = 'project',
    tags?: string[]
  ): Promise<string> {
    // Determine target path
    const targetPath = this.resolveTargetPath(scope, project);
    const decisionsFolder = scope === 'global'
      ? 'decisions'
      : (project && this.config.projects[project]?.decisionsFolder) || 'decisions';

    const folderPath = path.join(targetPath, decisionsFolder);
    await fs.mkdir(folderPath, { recursive: true });

    // Generate filename from title
    const filename = this.generateFilename(uncertainty.title);
    const filePath = path.join(folderPath, `${filename}.md`);

    // Build markdown content
    const markdown = this.buildDecisionMarkdown(
      taskID,
      taskTitle,
      uncertainty,
      project,
      scope,
      tags
    );

    // Write file
    await fs.writeFile(filePath, markdown, 'utf-8');

    return filePath;
  }

  /**
   * Search lessons by scanning markdown files
   * Note: This is a simple implementation. For production, consider using
   * basic-memory's built-in search via MCP or SQLite directly.
   */
  async searchLessons(query: string, project?: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchPaths: string[] = [];

    // Determine which paths to search
    if (project && this.config.projects[project]) {
      const projectConfig = this.config.projects[project];
      const lessonsFolder = projectConfig.lessonsFolder || 'lessons';
      searchPaths.push(path.join(projectConfig.path, lessonsFolder));
    }

    if (this.config.globalPath) {
      searchPaths.push(path.join(this.config.globalPath, 'lessons'));
    }

    // Search through files
    for (const searchPath of searchPaths) {
      try {
        const files = await this.findMarkdownFiles(searchPath);

        for (const file of files) {
          const content = await fs.readFile(file, 'utf-8');

          // Simple text search (case-insensitive)
          if (content.toLowerCase().includes(query.toLowerCase())) {
            const metadata = this.extractFrontmatter(content);
            const title = (typeof metadata.title === 'string' && metadata.title) || path.basename(file, '.md');
            results.push({
              path: file,
              title,
              content,
              metadata,
            });
          }
        }
      } catch {
        // Path doesn't exist or not accessible, skip
        continue;
      }
    }

    return results;
  }

  /**
   * Resolve target path based on scope and project
   */
  private resolveTargetPath(scope: 'project' | 'global', project?: string): string {
    if (scope === 'global') {
      if (!this.config.globalPath) {
        throw new Error('Global path not configured for basic-memory');
      }
      return this.config.globalPath;
    }

    if (!project) {
      throw new Error('Project is required for project-scoped operations');
    }

    const projectConfig = this.config.projects[project];
    if (!projectConfig) {
      throw new Error(`Project not configured: ${project}`);
    }

    return projectConfig.path;
  }

  /**
   * Generate a URL-safe filename from text
   */
  private generateFilename(text: string): string {
    return text
      .substring(0, 60) // Limit length
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dash
      .replace(/^-+|-+$/g, ''); // Trim dashes
  }

  /**
   * Build markdown content for a lesson
   */
  private buildLessonMarkdown(
    taskID: string,
    taskTitle: string,
    lesson: LessonLearned,
    project?: string,
    scope?: 'project' | 'global',
    relatedConcepts?: string[],
    effortDetails?: { effort?: number; effortReason?: string; complexityBias?: string }
  ): string {
    const permalink = this.generateFilename(lesson.content);
    const tags = [
      ...(lesson.tags || []),
      lesson.category || 'general',
      ...(scope === 'project' && project ? [project] : []),
    ];

    let markdown = '---\n';
    markdown += `title: ${this.escapeYaml(lesson.content.substring(0, 100))}\n`;
    markdown += `permalink: ${permalink}\n`;
    markdown += `tags:\n${tags.map(t => `  - ${t}`).join('\n')}\n`;
    markdown += `category: ${lesson.category || 'general'}\n`;
    markdown += `source_task: ${taskID}\n`;
    markdown += `task_title: ${this.escapeYaml(taskTitle)}\n`;
    if (scope) {
      markdown += `scope: ${scope}\n`;
    }
    if (project) {
      markdown += `project: ${project}\n`;
    }
    markdown += '---\n\n';

    // Title
    markdown += `# ${lesson.content}\n\n`;

    // Context section
    markdown += '## Context\n\n';
    markdown += `Captured from task: [${taskTitle}](linear://issue/${taskID})\n\n`;

    if (effortDetails) {
      if (effortDetails.effort) {
        markdown += `**Effort:** ${effortDetails.effort}\n\n`;
      }
      if (effortDetails.complexityBias) {
        markdown += `**Complexity:** ${effortDetails.complexityBias}\n\n`;
      }
      if (effortDetails.effortReason) {
        markdown += `**Reason:** ${effortDetails.effortReason}\n\n`;
      }
    }

    // Observations section
    markdown += '## Observations\n\n';
    const category = lesson.category || 'general';
    const categoryTag = lesson.tags && lesson.tags.length > 0 ? ` #${lesson.tags.join(' #')}` : '';
    markdown += `- [${category}] ${lesson.content}${categoryTag}\n`;
    markdown += `- [context] Discovered during ${taskID}\n\n`;

    // Relations section
    if (relatedConcepts && relatedConcepts.length > 0) {
      markdown += '## Relations\n\n';
      for (const concept of relatedConcepts) {
        markdown += `- relates_to [[${concept}]]\n`;
      }
      markdown += '\n';
    }

    return markdown;
  }

  /**
   * Build markdown content for a decision
   */
  private buildDecisionMarkdown(
    taskID: string,
    taskTitle: string,
    uncertainty: Uncertainty,
    project?: string,
    scope?: 'project' | 'global',
    tags?: string[]
  ): string {
    const permalink = this.generateFilename(uncertainty.title);
    const allTags = [
      ...(tags || []),
      'decision',
      ...(scope === 'project' && project ? [project] : []),
    ];

    let markdown = '---\n';
    markdown += `title: ${this.escapeYaml(uncertainty.title)}\n`;
    markdown += `permalink: ${permalink}\n`;
    markdown += `tags:\n${allTags.map(t => `  - ${t}`).join('\n')}\n`;
    markdown += `source_task: ${taskID}\n`;
    markdown += `task_title: ${this.escapeYaml(taskTitle)}\n`;
    if (scope) {
      markdown += `scope: ${scope}\n`;
    }
    if (project) {
      markdown += `project: ${project}\n`;
    }
    if (uncertainty.resolvedAt) {
      markdown += `resolved_at: ${uncertainty.resolvedAt}\n`;
    }
    if (uncertainty.resolvedBy) {
      markdown += `resolved_by: ${uncertainty.resolvedBy}\n`;
    }
    markdown += '---\n\n';

    // Title
    markdown += `# ${uncertainty.title}\n\n`;

    // Context section
    markdown += '## Context\n\n';
    markdown += `Resolved during task: [${taskTitle}](linear://issue/${taskID})\n\n`;

    // Question section
    markdown += '## Question\n\n';
    markdown += `- [question] ${uncertainty.title}\n`;
    if (uncertainty.description) {
      markdown += `- [context] ${uncertainty.description}\n`;
    }
    markdown += '\n';

    // Decision section
    markdown += '## Decision\n\n';
    if (uncertainty.resolution) {
      markdown += `- [decision] ${uncertainty.resolution}\n\n`;
    } else {
      markdown += '- [pending] Not yet resolved\n\n';
    }

    if (uncertainty.resolvedAt || uncertainty.resolvedBy) {
      markdown += '## Resolution Details\n\n';
      if (uncertainty.resolvedAt) {
        markdown += `**When:** ${uncertainty.resolvedAt}\n\n`;
      }
      if (uncertainty.resolvedBy) {
        markdown += `**By:** ${uncertainty.resolvedBy}\n\n`;
      }
    }

    // Relations
    markdown += '## Relations\n\n';
    markdown += `- resolves_uncertainty_in [[${taskTitle}]]\n`;
    markdown += `- part_of [[Project Decisions]]\n\n`;

    return markdown;
  }

  /**
   * Escape YAML special characters in strings
   */
  private escapeYaml(str: string): string {
    if (str.includes(':') || str.includes('#') || str.includes('[') || str.includes(']')) {
      return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
  }

  /**
   * Recursively find all markdown files in a directory
   */
  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.findMarkdownFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or not accessible
    }

    return files;
  }

  /**
   * Extract frontmatter from markdown content
   */
  private extractFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return {};
    }

    const frontmatter = match[1];
    const metadata: Record<string, string | string[]> = {};

    // Simple YAML parser (handles basic key: value pairs)
    const lines = frontmatter.split('\n');
    let currentKey = '';

    for (const line of lines) {
      if (line.startsWith('  - ')) {
        // Array item
        if (currentKey) {
          const existing = metadata[currentKey];
          if (!Array.isArray(existing)) {
            metadata[currentKey] = [];
          }
          const arr = metadata[currentKey];
          if (Array.isArray(arr)) {
            arr.push(line.substring(4).trim());
          }
        }
      } else if (line.includes(':')) {
        // Key-value pair
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        currentKey = key.trim();

        if (value) {
          // Remove quotes if present
          metadata[currentKey] = value.replace(/^["']|["']$/g, '');
        }
      }
    }

    return metadata;
  }
}
