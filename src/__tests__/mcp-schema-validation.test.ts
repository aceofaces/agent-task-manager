import { describe, expect, it } from 'vitest';
import {
  CreateTaskInputSchema,
  BatchCreateTasksInputSchema,
  DecomposeTaskInputSchema,
  UpdateTaskInputSchema,
  ExtractLessonInputSchema,
  TaskLookupSchema,
  LessonSearchSchema,
  GetReadyTasksInputSchema,
  ListTasksInputSchema,
  QueryTasksInputSchema,
} from '../types.js';
import { zodToJson } from '../utils/zod-to-json.js';

interface JSONSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

describe('MCP Schema Validation', () => {
  describe('Tool Schema Registration', () => {
    it('create_task schema is valid and parseable', () => {
      const jsonSchema = zodToJson(CreateTaskInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('title');
      expect(jsonSchema.properties).toHaveProperty('effort');
      expect(jsonSchema.required).toContain('title');
      expect(jsonSchema.required).toContain('effort');
    });

    it('batch_create_tasks schema is valid and parseable', () => {
      const jsonSchema = zodToJson(BatchCreateTasksInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('tasks');
      expect(jsonSchema.required).toContain('tasks');
    });

    it('decompose_task schema is valid and parseable', () => {
      const jsonSchema = zodToJson(DecomposeTaskInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('taskID');
      expect(jsonSchema.properties).toHaveProperty('subtasks');
      expect(jsonSchema.required).toContain('taskID');
      expect(jsonSchema.required).toContain('subtasks');
    });

    it('update_task schema is valid and parseable', () => {
      const jsonSchema = zodToJson(UpdateTaskInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('tasks');
      expect(jsonSchema.required).toContain('tasks');
    });

    it('extract_lesson schema is valid and parseable', () => {
      const jsonSchema = zodToJson(ExtractLessonInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('taskID');
      expect(jsonSchema.properties).toHaveProperty('lesson');
      expect(jsonSchema.required).toContain('taskID');
      expect(jsonSchema.required).toContain('lesson');
    });

    it('get_task schema is valid and parseable', () => {
      const jsonSchema = zodToJson(TaskLookupSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('taskID');
      expect(jsonSchema.required).toContain('taskID');
    });

    it('search_lessons schema is valid and parseable', () => {
      const jsonSchema = zodToJson(LessonSearchSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('query');
      expect(jsonSchema.required).toContain('query');
    });

    it('get_ready_tasks schema is valid and parseable', () => {
      const jsonSchema = zodToJson(GetReadyTasksInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('limit');
      expect(jsonSchema.properties).toHaveProperty('output');
    });

    it('list_tasks schema is valid and parseable', () => {
      const jsonSchema = zodToJson(ListTasksInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('filter');
      expect(jsonSchema.properties).toHaveProperty('limit');
      expect(jsonSchema.properties).toHaveProperty('output');
    });

    it('query_task schema is valid and parseable', () => {
      const jsonSchema = zodToJson(QueryTasksInputSchema) as JSONSchema;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('filter');
      expect(jsonSchema.properties).toHaveProperty('limit');
      expect(jsonSchema.properties).toHaveProperty('operation');
      expect(jsonSchema.required).toContain('filter');
      expect(jsonSchema.required).toContain('limit');
      expect(jsonSchema.required).toContain('operation');
    });
  });

  describe('Schema Input Validation', () => {
    it('create_task accepts valid input', () => {
      const validInput = {
        title: 'Test task',
        effort: 3,
      };
      expect(() => CreateTaskInputSchema.parse(validInput)).not.toThrow();
    });

    it('create_task rejects invalid effort', () => {
      const invalidInput = {
        title: 'Test task',
        effort: 4, // Not Fibonacci
      };
      expect(() => CreateTaskInputSchema.parse(invalidInput)).toThrow();
    });

    it('create_task accepts uncertainties array', () => {
      const validInput = {
        title: 'Complex task',
        effort: 5,
        uncertainties: ['Risk 1', { title: 'Risk 2', description: 'Details' }],
      };
      expect(() => CreateTaskInputSchema.parse(validInput)).not.toThrow();
      const parsed = CreateTaskInputSchema.parse(validInput);
      expect(parsed.uncertainties).toHaveLength(2);
      expect(parsed.uncertainties?.[0]).toEqual({ title: 'Risk 1' });
      expect(parsed.uncertainties?.[1]).toEqual({
        title: 'Risk 2',
        description: 'Details',
      });
    });

    it('batch_create_tasks accepts dependsOnBatchIndex', () => {
      const validInput = {
        tasks: [
          { title: 'Task 1', effort: 2 },
          { title: 'Task 2', effort: 3, dependsOnBatchIndex: [0] },
        ],
      };
      expect(() => BatchCreateTasksInputSchema.parse(validInput)).not.toThrow();
    });

    it('batch_create_tasks enforces max batch size of 50', () => {
      const invalidInput = {
        tasks: Array.from({ length: 51 }, (_, i) => ({
          title: `Task ${i}`,
          effort: 2 as const,
        })),
      };
      expect(() => BatchCreateTasksInputSchema.parse(invalidInput)).toThrow(/too.*big/i);
    });

    it('decompose_task requires subtasks array', () => {
      const validInput = {
        taskID: 'NON-123',
        subtasks: [
          { title: 'Subtask 1', effort: 2 },
          { title: 'Subtask 2', effort: 3 },
        ],
      };
      expect(() => DecomposeTaskInputSchema.parse(validInput)).not.toThrow();
    });

    it('update_task accepts all operation types', () => {
      const validInput = {
        tasks: [
          {
            taskID: 'NON-123',
            set: { status: 'in-progress' as const },
            add: { lessonsLearned: [{ content: 'Lesson' }] },
            remove: { labels: ['old-label'] },
            resolve: {
              uncertainties: [{ title: 'Risk', resolution: 'Resolved' }],
            },
          },
        ],
      };
      expect(() => UpdateTaskInputSchema.parse(validInput)).not.toThrow();
    });

    it('extract_lesson accepts all lesson categories', () => {
      const categories = ['pattern', 'decision', 'gotcha', 'solution', 'performance', 'balance'];

      for (const category of categories) {
        const validInput = {
          taskID: 'NON-123',
          lesson: {
            content: 'Test lesson',
            category,
          },
        };
        expect(() => ExtractLessonInputSchema.parse(validInput)).not.toThrow();
      }
    });

    it('get_task accepts single or multiple taskIDs', () => {
      const singleInput = { taskID: 'NON-123' };
      const multiInput = { taskID: ['NON-123', 'NON-124'] };

      expect(() => TaskLookupSchema.parse(singleInput)).not.toThrow();
      expect(() => TaskLookupSchema.parse(multiInput)).not.toThrow();
    });

    it('get_task enforces max 10 taskIDs', () => {
      const invalidInput = {
        taskID: Array.from({ length: 11 }, (_, i) => `NON-${i}`),
      };
      expect(() => TaskLookupSchema.parse(invalidInput)).toThrow(/too.*big/i);
    });

    it('list_tasks accepts all output modes', () => {
      const modes = ['compact', 'standard', 'detailed'];

      for (const mode of modes) {
        const validInput = {
          filter: { status_in: ['todo' as const] },
          output: mode as 'compact' | 'standard' | 'detailed',
        };
        expect(() => ListTasksInputSchema.parse(validInput)).not.toThrow();
      }
    });

    it('query_task requires operation with at least one field', () => {
      const validInput = {
        filter: { status_in: ['todo' as const] },
        limit: 10,
        operation: { set: { status: 'in-progress' as const } },
      };
      expect(() => QueryTasksInputSchema.parse(validInput)).not.toThrow();
    });
  });

  describe('Schema Consistency', () => {
    it('all task status values are consistent', () => {
      const statuses = ['backlog', 'todo', 'in-progress', 'in-review', 'done', 'canceled'] as const;

      for (const status of statuses) {
        const updateInput = {
          tasks: [{ taskID: 'NON-123', set: { status } }],
        };
        expect(() => UpdateTaskInputSchema.parse(updateInput)).not.toThrow();
      }
    });

    it('all lesson categories are consistent', () => {
      const categories = ['pattern', 'decision', 'gotcha', 'solution', 'performance', 'balance'] as const;

      for (const category of categories) {
        const lessonInput = {
          taskID: 'NON-123',
          lesson: { content: 'Test', category },
        };
        expect(() => ExtractLessonInputSchema.parse(lessonInput)).not.toThrow();
      }
    });

    it('Fibonacci effort values are enforced across all schemas', () => {
      const validEfforts = [1, 2, 3, 5, 8, 13, 21];
      const invalidEfforts = [0, 4, 6, 7, 9, 10, 11, 12, 14, 22];

      for (const effort of validEfforts) {
        expect(() => CreateTaskInputSchema.parse({ title: 'Test', effort })).not.toThrow();
      }

      for (const effort of invalidEfforts) {
        expect(() => CreateTaskInputSchema.parse({ title: 'Test', effort })).toThrow();
      }
    });
  });

  describe('Schema Error Messages', () => {
    it('provides helpful error for missing required fields', () => {
      try {
        CreateTaskInputSchema.parse({});
      } catch (error) {
        expect(error).toBeDefined();
        expect(String(error)).toContain('title');
      }
    });

    it('provides helpful error for invalid effort value', () => {
      try {
        CreateTaskInputSchema.parse({ title: 'Test', effort: 4 });
      } catch (error) {
        expect(error).toBeDefined();
        expect(String(error)).toMatch(/effort.*1, 2, 3, 5, 8, 13, 21/i);
      }
    });

    it('provides helpful error for invalid dependency type', () => {
      try {
        CreateTaskInputSchema.parse({
          title: 'Test',
          effort: 3,
          dependencies: [{ taskID: 'NON-123', type: 'invalid' }],
        });
      } catch (error) {
        expect(error).toBeDefined();
        expect(String(error)).toContain('type');
      }
    });
  });
});
