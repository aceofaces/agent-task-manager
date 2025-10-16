/**
 * Shared types for setup scripts
 */

export interface SetupConfig {
  linear: {
    apiKey: string;
    teamId: string;
    teamName?: string;
  };
  notion: {
    apiKey: string;
    globalLessonsDbId?: string;
    globalDecisionsDbId?: string;
    globalLessonsDataSourceId?: string;
    globalDecisionsDataSourceId?: string;
  };
  projects: ProjectConfig[];
  uncertaintyMode?: 'off' | 'warn' | 'block';
}

export interface ProjectConfig {
  name: string;
  linearProjectId: string;
  notionLessonsDbId: string;
  notionDecisionsDbId: string;
  notionLessonsDataSourceId: string;
  notionDecisionsDataSourceId: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  key: string;
  teamId: string;
}

export interface NotionDatabase {
  id: string;
  dataSourceId: string; // Notion API 2025-09-03: data source ID for page creation
  title: string;
  url: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SetupStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
}

export type NotionPropertySchema =
  | { type: 'title' }
  | { type: 'rich_text' }
  | { type: 'multi_select' }
  | { type: 'select'; options?: readonly string[] };

export type NotionSchemaDefinition = Record<string, NotionPropertySchema>;

/**
 * Notion database schema definitions
 */
export const LESSONS_SCHEMA = {
  Name: { type: 'title' },
  Tags: { type: 'multi_select' },
  Category: {
    type: 'select',
    options: ['pattern', 'decision', 'gotcha', 'solution', 'performance', 'balance'],
  },
  'Source Task': { type: 'rich_text' },
  Project: { type: 'select' },
} as const satisfies NotionSchemaDefinition;

export const DECISIONS_SCHEMA = {
  Name: { type: 'title' },
  Tags: { type: 'multi_select' },
  'Source Task': { type: 'rich_text' },
  Project: { type: 'select' },
} as const satisfies NotionSchemaDefinition;
