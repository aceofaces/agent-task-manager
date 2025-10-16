/**
 * Notion service for storing lessons and decisions
 */

import { Client } from '@notionhq/client';
import type { BlockObjectRequest, PageObjectResponse, SearchResponse } from '@notionhq/client/build/src/api-endpoints.js';
import type {
  LessonLearned,
  Uncertainty,
  NotionProjectMapping,
} from '../../types.js';
import type { KnowledgeStorageService, SearchResult } from '../storage-service.js';

export type NotionSearchResult = PageObjectResponse;

export class NotionService implements KnowledgeStorageService {
  private client: Client;
  private projects: Record<string, NotionProjectMapping>;
  private globalLessonsDbId?: string;
  private globalLessonsDataSourceId?: string;
  private globalDecisionsDbId?: string;
  private globalDecisionsDataSourceId?: string;

  constructor(
    apiKey: string,
    projects: Record<string, NotionProjectMapping>,
    globalLessonsDbId?: string,
    globalDecisionsDbId?: string,
    globalLessonsDataSourceId?: string,
    globalDecisionsDataSourceId?: string
  ) {
    this.client = new Client({ auth: apiKey });
    this.projects = projects;
    this.globalLessonsDbId = globalLessonsDbId;
    this.globalLessonsDataSourceId = globalLessonsDataSourceId;
    this.globalDecisionsDbId = globalDecisionsDbId;
    this.globalDecisionsDataSourceId = globalDecisionsDataSourceId;
  }

  /**
   * Create a lesson page in Notion
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
    // Determine target data source (Notion API 2025-09-03)
    let dataSourceId: string | undefined;

    if (scope === 'global' && this.globalLessonsDataSourceId) {
      dataSourceId = this.globalLessonsDataSourceId;
    } else if (project && this.projects[project]) {
      dataSourceId = this.projects[project].notionLessonsDataSourceId;
    }

    if (!dataSourceId) {
      throw new Error(
        `No Notion lessons data source configured for ${scope === 'global' ? 'global' : `project: ${project}`}`
      );
    }

    // Build page title
    const pageTitle = `Lesson: ${lesson.content.substring(0, 100)}${lesson.content.length > 100 ? '...' : ''}`;

    // Build page content
    const content = this.buildLessonContent(
      taskID,
      taskTitle,
      lesson,
      relatedConcepts,
      effortDetails
    );

    // Build tags
    const tags = [
      ...(lesson.tags || []),
      lesson.category || 'general',
      ...(scope === 'project' && project ? [project] : []),
    ];

    // Create page (Notion API 2025-09-03: use data_source_id)
    const response = await this.client.pages.create({
      parent: { data_source_id: dataSourceId },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: pageTitle,
              },
            },
          ],
        },
        Tags: {
          multi_select: tags.map((tag) => ({ name: tag })),
        },
        Category: {
          select: {
            name: lesson.category || 'general',
          },
        },
        'Source Task': {
          rich_text: [
            {
              text: {
                content: taskID,
              },
            },
          ],
        },
        ...(scope === 'project' && project
          ? {
              Project: {
                select: {
                  name: project,
                },
              },
            }
          : {}),
      },
      children: content,
    });

    return response.id;
  }

  /**
   * Create a decision page in Notion (for uncertainty resolutions)
   */
  async createDecision(
    taskID: string,
    taskTitle: string,
    uncertainty: Uncertainty,
    project?: string,
    scope: 'project' | 'global' = 'project',
    tags?: string[]
  ): Promise<string> {
    // Determine target data source (Notion API 2025-09-03)
    let dataSourceId: string | undefined;

    if (scope === 'global' && this.globalDecisionsDataSourceId) {
      dataSourceId = this.globalDecisionsDataSourceId;
    } else if (project && this.projects[project]) {
      dataSourceId = this.projects[project].notionDecisionsDataSourceId;
    }

    if (!dataSourceId) {
      throw new Error(
        `No Notion decisions data source configured for ${scope === 'global' ? 'global' : `project: ${project}`}`
      );
    }

    // Build page title
    const pageTitle = `Decision: ${uncertainty.title}`;

    // Build page content
    const content = this.buildDecisionContent(taskID, taskTitle, uncertainty);

    // Build tags
    const allTags = [...(tags || []), ...(scope === 'project' && project ? [project] : [])];

    // Create page (Notion API 2025-09-03: use data_source_id)
    const response = await this.client.pages.create({
      parent: { data_source_id: dataSourceId },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: pageTitle,
              },
            },
          ],
        },
        Tags: {
          multi_select: allTags.map((tag) => ({ name: tag })),
        },
        'Source Task': {
          rich_text: [
            {
              text: {
                content: taskID,
              },
            },
          ],
        },
        ...(scope === 'project' && project
          ? {
              Project: {
                select: {
                  name: project,
                },
              },
            }
          : {}),
      },
      children: content,
    });

    return response.id;
  }

  /**
   * Search lessons in Notion (project-specific or global)
   */
  async searchLessons(query: string, project?: string): Promise<SearchResult[]> {
    const dataSourceIds: string[] = [];
    const databaseIds: string[] = [];

    if (project) {
      const mapping = this.projects[project];
      if (mapping?.notionLessonsDataSourceId) {
        dataSourceIds.push(mapping.notionLessonsDataSourceId);
      }
      if (mapping?.notionLessonsDbId) {
        databaseIds.push(mapping.notionLessonsDbId);
      }
    }

    if (this.globalLessonsDataSourceId) {
      dataSourceIds.push(this.globalLessonsDataSourceId);
    }

    if (this.globalLessonsDbId) {
      databaseIds.push(this.globalLessonsDbId);
    }

    if (dataSourceIds.length === 0 && databaseIds.length === 0) {
      throw new Error(
        `No Notion lessons data source configured${project ? ` for project: ${project}` : ''}`
      );
    }

    const response: SearchResponse = await this.client.search({
      query,
      filter: { value: 'page', property: 'object' },
    });

    const filtered = response.results.filter((result): result is NotionSearchResult => {
      if (!('parent' in result)) {
        return false;
      }

      const parent = (result as NotionSearchResult).parent;

      if (parent.type === 'database_id') {
        return databaseIds.includes(parent.database_id);
      }

      if ('data_source_id' in parent && typeof parent.data_source_id === 'string') {
        return dataSourceIds.includes(parent.data_source_id);
      }

      return false;
    });

    // Convert Notion results to SearchResult format
    return filtered.map(page => {
      const title = 'properties' in page && 'Name' in page.properties &&
        page.properties.Name.type === 'title' && page.properties.Name.title.length > 0
        ? page.properties.Name.title[0].plain_text
        : 'Untitled';

      return {
        id: page.id,
        title,
        metadata: { notionPage: page },
      };
    });
  }

  private buildLessonContent(
    taskID: string,
    taskTitle: string,
    lesson: LessonLearned,
    relatedConcepts?: string[],
    effortDetails?: { effort?: number; effortReason?: string; complexityBias?: string }
  ): BlockObjectRequest[] {
    const blocks: BlockObjectRequest[] = [];

    // Context section
    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Context' } }],
      },
    });

    blocks.push({
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `Captured from task: ${taskTitle} (${taskID})` },
          },
        ],
      },
    });

    // Effort details
    if (effortDetails?.effort || effortDetails?.effortReason || effortDetails?.complexityBias) {
      let contextText = '';

      if (effortDetails.effort) {
        contextText += `Effort: ${effortDetails.effort}`;
      }
      if (effortDetails?.complexityBias) {
        contextText += `\nComplexity Bias: ${effortDetails.complexityBias}`;
      }
      if (effortDetails?.effortReason) {
        contextText += `\nEffort Reason: ${effortDetails.effortReason}`;
      }

      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: contextText },
            },
          ],
        },
      });
    }

    // Observation section
    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Observation' } }],
      },
    });

    blocks.push({
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `[${lesson.category || 'general'}] ${lesson.content}` },
          },
        ],
      },
    });

    // Related concepts section
    if (relatedConcepts && relatedConcepts.length > 0) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: 'Related Concepts' } }],
        },
      });

      for (const concept of relatedConcepts) {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: concept } }],
          },
        });
      }
    }

    return blocks;
  }

  /**
   * Build decision page content (Notion blocks)
   */
  private buildDecisionContent(
    taskID: string,
    taskTitle: string,
    uncertainty: Uncertainty
  ): BlockObjectRequest[] {
    const blocks: BlockObjectRequest[] = [];

    // Context section
    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Context' } }],
      },
    });

    blocks.push({
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `Resolved during task: ${taskTitle} (${taskID})` },
          },
        ],
      },
    });

    // Question section
    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Question' } }],
      },
    });

    blocks.push({
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: uncertainty.title } }],
      },
    });

    if (uncertainty.description) {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: uncertainty.description } }],
        },
      });
    }

    // Decision section
    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Decision' } }],
      },
    });

    blocks.push({
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: uncertainty.resolution || 'Not resolved' } }],
      },
    });

    if (uncertainty.resolvedAt) {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `Resolved at: ${uncertainty.resolvedAt}` } }],
        },
      });
    }

    if (uncertainty.resolvedBy) {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `Resolved by: ${uncertainty.resolvedBy}` } }],
        },
      });
    }

    return blocks;
  }
}
