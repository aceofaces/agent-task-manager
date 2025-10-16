import { z } from 'zod';

export const FIBONACCI_EFFORT_VALUES = [1, 2, 3, 5, 8, 13, 21] as const;
export type FibonacciEffort = (typeof FIBONACCI_EFFORT_VALUES)[number];
export const isFibonacciEffort = (value: number): value is FibonacciEffort =>
  FIBONACCI_EFFORT_VALUES.includes(value as FibonacciEffort);

export const ComplexityBiasSchema = z.enum(['low', 'medium', 'high']);
export type ComplexityBias = z.infer<typeof ComplexityBiasSchema>;

export const TaskStatusSchema = z.enum(['backlog', 'todo', 'in-progress', 'in-review', 'done', 'canceled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const LessonCategorySchema = z.enum(['pattern', 'decision', 'gotcha', 'solution', 'performance', 'balance']);
export type LessonCategory = z.infer<typeof LessonCategorySchema>;

export const TaskDependencyTypeSchema = z.enum(['blocks', 'blocked_by', 'relates_to']);
export type TaskDependencyType = z.infer<typeof TaskDependencyTypeSchema>;

export const EffortValueSchema = z
  .number()
  .int()
  .refine((value) => isFibonacciEffort(value), {
    message: `Effort must be one of ${FIBONACCI_EFFORT_VALUES.join(', ')}`,
  })
  .describe(`Fibonacci effort value: ${FIBONACCI_EFFORT_VALUES.join(', ')}`);

export const EffortReasonSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Why this effort was chosen');


export const UncertaintySchema = z
  .object({
    title: z.string().min(1),
    description: z.string().trim().optional(),
    resolution: z.string().trim().optional(),
    resolvedAt: z.string().trim().optional(),
    resolvedBy: z.string().trim().optional(),
  })
  .strict();
export type Uncertainty = z.infer<typeof UncertaintySchema>;

const UncertaintyDraftSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().trim().optional(),
  })
  .strict();
export type UncertaintyDraft = z.infer<typeof UncertaintyDraftSchema>;

const UncertaintyInputCoercionSchema = z
  .union([z.string().min(1), UncertaintyDraftSchema])
  .transform((value): UncertaintyDraft =>
    typeof value === 'string' ? { title: value } : value
  );

export const LessonLearnedSchema = z
  .object({
    content: z.string().min(1),
    category: LessonCategorySchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type LessonLearned = z.infer<typeof LessonLearnedSchema>;

export const TaskDependencySchema = z
  .object({
    taskID: z.string().min(1),
    type: TaskDependencyTypeSchema,
  })
  .strict();
export type TaskDependency = z.infer<typeof TaskDependencySchema>;

export interface Task {
  taskID: string;
  title: string;
  description?: string;
  linearIssueKey?: string;
  goal?: string;
  effort: FibonacciEffort;
  effortReason?: string;
  complexityBias?: ComplexityBias;
  status: TaskStatus;
  project?: string;
  parentTaskID?: string;
  subtasks?: Task[];
  uncertainties?: Uncertainty[];
  lessonsLearned?: LessonLearned[];
  dependencies?: TaskDependency[];
  assignee?: string;
  dueDate?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export const TaskSchema = z
  .lazy(() =>
    z
      .object({
        taskID: z.string().min(1),
        title: z.string().min(1),
        description: z.string().trim().optional(),
        goal: z.string().trim().optional(),
        effort: EffortValueSchema,
        effortReason: EffortReasonSchema.optional(),
        complexityBias: ComplexityBiasSchema.optional(),
        status: TaskStatusSchema,
        project: z.string().trim().optional(),
        parentTaskID: z.string().trim().optional(),
        subtasks: z.array(TaskSchema).optional(),
        uncertainties: z.array(UncertaintySchema).optional(),
        lessonsLearned: z.array(LessonLearnedSchema).optional(),
        dependencies: z.array(TaskDependencySchema).optional(),
        assignee: z.string().trim().optional(),
        dueDate: z.string().trim().optional(),
        labels: z.array(z.string().min(1)).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
  ) as unknown as z.ZodType<Task>;

const CreateTaskInputBaseSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().trim().optional(),
    goal: z.string().trim().optional(),
    effort: EffortValueSchema,
    effortReason: EffortReasonSchema.optional(),
    complexityBias: ComplexityBiasSchema.optional(),
    project: z.string().trim().optional(),
    uncertainties: z.array(UncertaintyInputCoercionSchema).optional(),
    dependencies: z.array(TaskDependencySchema).optional(),
    assignee: z.string().trim().optional(),
    dueDate: z.string().trim().optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CreateTaskInputSchema = CreateTaskInputBaseSchema;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

const BatchTaskInputSchema = CreateTaskInputBaseSchema.extend({
  dependsOnBatchIndex: z
    .array(z.number().int().min(0))
    .optional()
    .describe('Array of 0-indexed positions in the batch this task depends on'),
});
export type BatchTaskInput = z.infer<typeof BatchTaskInputSchema>;

export const BatchCreateTasksInputSchema = z
  .object({
    tasks: z.array(BatchTaskInputSchema).min(1).max(50),
  })
  .strict();
export type BatchCreateTasksInput = z.infer<typeof BatchCreateTasksInputSchema>;

const SubtaskInputBaseSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().trim().optional(),
    goal: z.string().trim().optional(),
    effort: EffortValueSchema,
    effortReason: EffortReasonSchema.optional(),
    complexityBias: ComplexityBiasSchema.optional(),
    sequenceOrder: z
      .number()
      .int()
      .min(1)
      .describe('Execution order: 1 runs first; same numbers run in parallel')
      .optional(),
    assignee: z.string().trim().optional(),
    uncertainties: z.array(UncertaintyInputCoercionSchema).optional(),
  })
  .strict();

export const SubtaskInputSchema = SubtaskInputBaseSchema;
export type SubtaskInput = z.infer<typeof SubtaskInputSchema>;

export const DecomposeTaskInputSchema = z
  .object({
    taskID: z.string().min(1),
    decompositionReason: z.string().trim().describe('Why decomposition is happening').optional(),
    subtasks: z
      .array(SubtaskInputSchema)
      .min(1)
      .describe('Subtasks to create for the parent task'),
  })
  .strict();
export type DecomposeTaskInput = z.infer<typeof DecomposeTaskInputSchema>;

export const TaskUpdateSetSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    description: z.string().trim().optional(),
    assignee: z.string().trim().optional(),
    dueDate: z.string().trim().optional(),
    effort: EffortValueSchema.optional(),
    effortReason: EffortReasonSchema.optional(),
    complexityBias: ComplexityBiasSchema.optional(),
  })
  .strict();
export type TaskUpdateSet = z.infer<typeof TaskUpdateSetSchema>;

export const TaskUpdateAddSchema = z
  .object({
    lessonsLearned: z.array(LessonLearnedSchema).optional(),
    labels: z.array(z.string().min(1)).optional(),
    uncertainties: z.array(UncertaintyInputCoercionSchema).optional(),
  })
  .strict();
export type TaskUpdateAdd = z.infer<typeof TaskUpdateAddSchema>;

export const TaskUpdateRemoveSchema = z
  .object({
    labels: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type TaskUpdateRemove = z.infer<typeof TaskUpdateRemoveSchema>;

export const TaskUpdateResolveUncertaintySchema = z
  .object({
    title: z.string().min(1),
    resolution: z.string().min(1),
  })
  .strict();
export type TaskUpdateResolveUncertainty = z.infer<typeof TaskUpdateResolveUncertaintySchema>;

export const TaskUpdateResolveSchema = z
  .object({
    uncertainties: z.array(TaskUpdateResolveUncertaintySchema).min(1),
  })
  .strict();
export type TaskUpdateResolve = z.infer<typeof TaskUpdateResolveSchema>;

export const TaskUpdateOperationSchema = z
  .object({
    taskID: z.string().min(1),
    set: TaskUpdateSetSchema.optional(),
    add: TaskUpdateAddSchema.optional(),
    remove: TaskUpdateRemoveSchema.optional(),
    resolve: TaskUpdateResolveSchema.optional(),
  })
  .strict();
export type TaskUpdateOperation = z.infer<typeof TaskUpdateOperationSchema>;

export const UpdateTaskInputSchema = z
  .object({
    tasks: z.array(TaskUpdateOperationSchema).min(1),
  })
  .strict();
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const TaskPatchSchema = z
  .object({
    taskID: z.string().min(1),
    status: TaskStatusSchema.optional(),
    description: z.string().trim().optional(),
    assignee: z.string().trim().optional(),
    dueDate: z.string().trim().optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type TaskPatch = z.infer<typeof TaskPatchSchema>;

export const ResolveUncertaintyInputSchema = z
  .object({
    taskID: z.string().min(1),
    uncertaintyTitle: z.string().min(1),
    resolution: z.string().min(1),
    extractToNotion: z.boolean().optional(),
    scope: z.enum(['project', 'global']).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ResolveUncertaintyInput = z.infer<typeof ResolveUncertaintyInputSchema>;

export const ExtractLessonInputSchema = z
  .object({
    taskID: z.string().min(1),
    lesson: LessonLearnedSchema,
    scope: z.enum(['project', 'global']).optional(),
    relatedConcepts: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ExtractLessonInput = z.infer<typeof ExtractLessonInputSchema>;

// Output mode for task formatting
export const OutputModeSchema = z.enum(['compact', 'standard', 'detailed']);
export type OutputMode = z.infer<typeof OutputModeSchema>;

export const TaskLookupSchema = z
  .object({
    taskID: z.union([z.string().min(1), z.array(z.string().min(1)).max(10)]),
    includeTree: z.boolean().optional().default(false),
    output: OutputModeSchema.optional(),
  })
  .strict();

export const LessonSearchSchema = z
  .object({
    query: z.string().min(1),
    project: z.string().trim().optional(),
  })
  .strict();

// Get ready tasks input
export const GetReadyTasksInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    output: OutputModeSchema.optional(),
  })
  .strict();
export type GetReadyTasksInput = z.infer<typeof GetReadyTasksInputSchema>;

// DEPRECATED: Use TaskLookupSchema instead
// Kept for backwards compatibility during migration
export const GetTaskDetailsInputSchema = TaskLookupSchema;
export type GetTaskDetailsInput = z.infer<typeof GetTaskDetailsInputSchema>;

// Storage backend types
export const StorageBackendSchema = z.enum(['notion', 'basic-memory']);
export type StorageBackend = z.infer<typeof StorageBackendSchema>;

// Notion project mapping (legacy)
export const NotionProjectMappingSchema = z
  .object({
    linearProjectId: z.string().min(1),
    notionLessonsDbId: z.string().min(1),
    notionLessonsDataSourceId: z.string().min(1),
    notionDecisionsDbId: z.string().min(1),
    notionDecisionsDataSourceId: z.string().min(1),
  })
  .strict();
export type NotionProjectMapping = z.infer<typeof NotionProjectMappingSchema>;

// Basic Memory project mapping
export const BasicMemoryProjectMappingSchema = z
  .object({
    linearProjectId: z.string().min(1),
    path: z.string().min(1),
    lessonsFolder: z.string().min(1).optional(),
    decisionsFolder: z.string().min(1).optional(),
  })
  .strict();
export type BasicMemoryProjectMapping = z.infer<typeof BasicMemoryProjectMappingSchema>;

// Union type for project mapping (supports both backends)
export const ProjectMappingSchema = z.union([
  NotionProjectMappingSchema,
  BasicMemoryProjectMappingSchema,
]);
export type ProjectMapping = z.infer<typeof ProjectMappingSchema>;

export const ProjectsConfigSchema = z.record(z.string(), ProjectMappingSchema);
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

export const ConfigSchema = z
  .object({
    linear: z
      .object({
        apiKey: z.string().min(1),
        teamId: z.string().min(1),
      })
      .strict(),
    // Storage backend selection
    storageBackend: StorageBackendSchema.optional().default('basic-memory'),
    // Notion configuration (when storageBackend = 'notion')
    notion: z
      .object({
        apiKey: z.string().min(1),
        globalLessonsDbId: z.string().min(1).optional(),
        globalLessonsDataSourceId: z.string().min(1).optional(),
        globalDecisionsDbId: z.string().min(1).optional(),
        globalDecisionsDataSourceId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    // Basic Memory configuration (when storageBackend = 'basic-memory')
    basicMemory: z
      .object({
        rootPath: z.string().min(1),
        globalPath: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    // Project mappings (optional for basic-memory with auto-discovery)
    projects: ProjectsConfigSchema.optional().default({}),
    defaultProject: z.string().trim().optional(),
  })
  .strict();
export type Config = z.infer<typeof ConfigSchema>;

export const TaskFilterSchema = z
  .object({
    project: z.string().trim().optional(),
    status_in: z.array(TaskStatusSchema).optional(),
    labels_has_every: z.array(z.string().min(1)).optional(),
    has_unresolved_uncertainties: z.boolean().optional(),
    ready: z.boolean().optional(),
    search: z.string().trim().optional().describe('Case-insensitive substring search on title and description'),
  })
  .strict();
export type TaskFilter = z.infer<typeof TaskFilterSchema>;

export const ListTasksInputSchema = z
  .object({
    filter: TaskFilterSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    after: z.string().trim().optional(),
    output: OutputModeSchema.optional(),
  })
  .strict();
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

export const TaskBulkOperationSchema = z
  .object({
    set: TaskUpdateSetSchema.optional(),
    add: TaskUpdateAddSchema.optional(),
    remove: TaskUpdateRemoveSchema.optional(),
    resolve: TaskUpdateResolveSchema.optional(),
  })
  .strict();
export type TaskBulkOperation = z.infer<typeof TaskBulkOperationSchema>;

export const QueryTasksInputSchema = z
  .object({
    filter: TaskFilterSchema,
    limit: z.number().int().min(1).max(100),
    after: z.string().trim().optional(),
    operation: TaskBulkOperationSchema,
  })
  .strict();
export type QueryTasksInput = z.infer<typeof QueryTasksInputSchema>;

export const IssueMetadataSchema = z
  .object({
    goal: z.string().trim().optional(),
    effort: EffortValueSchema,
    effortReason: EffortReasonSchema.optional(),
    complexityBias: ComplexityBiasSchema.optional(),
    uncertainties: z.array(UncertaintySchema),
    lessonsLearned: z.array(LessonLearnedSchema),
  })
  .strict();
export type IssueMetadata = z.infer<typeof IssueMetadataSchema>;
