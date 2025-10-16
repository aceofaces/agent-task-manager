/**
 * Abstract interface for knowledge storage backends
 * Supports both Notion and Basic Memory implementations
 */

import type { LessonLearned, Uncertainty } from '../types.js';

export interface KnowledgeStorageService {
  /**
   * Create a lesson/observation in the knowledge base
   */
  createLesson(
    taskID: string,
    taskTitle: string,
    lesson: LessonLearned,
    project?: string,
    scope?: 'project' | 'global',
    relatedConcepts?: string[],
    effortDetails?: { effort?: number; effortReason?: string; complexityBias?: string }
  ): Promise<string>;

  /**
   * Create a decision/uncertainty resolution in the knowledge base
   */
  createDecision(
    taskID: string,
    taskTitle: string,
    uncertainty: Uncertainty,
    project?: string,
    scope?: 'project' | 'global',
    tags?: string[]
  ): Promise<string>;

  /**
   * Search for lessons in the knowledge base
   */
  searchLessons(query: string, project?: string): Promise<SearchResult[]>;
}

export interface SearchResult {
  id?: string;
  path?: string;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
}
