import type {
  ListResourcesResult,
  ListResourceTemplatesResult,
  ReadResourceResult,
  TextResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './types.js';

const QUICKSTART_MARKDOWN = `# Agent Task Manager Quickstart

## Scope Rule
- Effort <3 → TodoWrite (session-local)
- Effort ≥3 → Task Manager (persistent, decomposes)

## Typical Flow
1. \`create_task\` → Capture the request. Use Fibonacci effort (1,2,3,5,8,13,21) and add uncertainties when effort > 3.
2. \`decompose_task\` → Break down high-effort tasks before work begins.
3. \`update_task\` → Move status before/after work, add lessons, and document how uncertainties were resolved.
4. \`extract_lesson\` → Capture reusable knowledge as you go.

## Understanding Uncertainties

**Uncertainties are task-specific and do NOT automatically propagate between parent and subtasks.**

### Key Behaviors:
- **Parent uncertainties** represent questions about the overall approach or architecture
- **Subtask uncertainties** represent specific implementation questions within that subtask
- Resolving a subtask's uncertainty does NOT resolve the parent's uncertainty
- Resolving a parent's uncertainty does NOT resolve subtask uncertainties

### Best Practices:
1. **Before decomposition**: Add high-level uncertainties to the parent task (effort >3 requires this)
2. **During decomposition**: Add specific uncertainties to individual subtasks as needed
3. **As work progresses**: Resolve uncertainties on the task where they were added
4. **Parent resolution**: Consider resolving parent uncertainties once subtasks provide answers

### Example:
\`\`\`json
// Parent task (NON-100): Build authentication system
{
  "effort": 8,
  "uncertainties": ["OAuth vs JWT for token management?"]
}

// After research in subtask, resolve parent uncertainty:
{
  "taskID": "NON-100",
  "resolve": {
    "uncertainties": [{
      "title": "OAuth vs JWT for token management?",
      "resolution": "Using JWT with refresh tokens based on team consensus"
    }]
  }
}
\`\`\`

## Task Cleanup & Cancellation

When tasks are no longer relevant, use the **canceled** status instead of deletion:

\`\`\`json
{
  "tasks": [{
    "taskID": "task-id",
    "set": { "status": "canceled" }
  }]
}
\`\`\`

**Why canceled instead of deletion?**
- Preserves history and context for future reference
- Maintains relationships with dependent tasks
- Allows lessons learned to remain searchable
- Deletion is reserved for human operators only

**Common cancellation scenarios:**
- Duplicate tasks
- Requirements changed
- Work deprioritized or abandoned
- Tasks blocked indefinitely

Use \`query_task\` to bulk-cancel multiple tasks by filter.

## Status Transitions

Tasks flow through these states:

\`\`\`
backlog → todo → in-progress → in-review → done
   ↓
canceled (can transition from any status)
\`\`\`

**Status Definitions:**
- **backlog** – Captured but not yet prioritized for active work
- **todo** – Prioritized and ready to start (no blockers)
- **in-progress** – Actively being worked on
- **in-review** – Work complete, awaiting review/approval
- **done** – Work completed and verified
- **canceled** – No longer relevant (preserves history)

**Common Patterns:**
- \`backlog → todo\`: Move when prioritized and dependencies resolved
- \`todo → in-progress\`: Start work (mark ONE task at a time)
- \`in-progress → in-review\`: Submit for review
- \`in-review → done\`: Review approved
- \`in-review → in-progress\`: Changes requested
- \`any → canceled\`: Task no longer needed

**Rules:**
- You can skip \`in-review\` if no review process exists
- \`canceled\` preserves task history (preferred over deletion)
- Use \`query_task\` for bulk status transitions

## Reminders
- JSON arguments only—no natural language wrappers.
- The \`effort\` parameter maps directly to Linear's estimate field. Use Fibonacci values (1,2,3,5,8,13,21).
- Effort > 3 demands uncertainties and a decomposition plan.
- We expose Linear keys alongside UUIDs for easy referencing. Linear keys use the format ORG-### (e.g., NON-123) where ORG is your organization's team identifier.
- See help://effort-calibration for practical guidance on choosing effort values.
- See help://tool-selection for help choosing between list_tasks and query_task.
`;

const EFFORT_CALIBRATION_MARKDOWN = `# Effort Calibration Guide

The \`effort\` parameter maps directly to Linear's estimate field and uses Fibonacci values for intentional non-linearity.

## Fibonacci Values & Practical Guidance

### **1 point** – Trivial → Use TodoWrite
- **Time estimate:** < 1 hour
- **Scope:** Session-local
- **Characteristics:**
  - No research needed
  - Single file changes
  - Copy/paste with minor tweaks
  - Documentation updates
- **Examples:**
  - Fix typo in error message
  - Update environment variable
  - Add missing type annotation

### **2 points** – Simple → Use TodoWrite
- **Time estimate:** 1-2 hours
- **Scope:** Session-local
- **Characteristics:**
  - Straightforward implementation
  - Familiar patterns
  - Minimal edge cases
  - Self-contained change
- **Examples:**
  - Add validation to existing form
  - Write unit test for existing function
  - Refactor small utility function

### **3 points** – Moderate → Judgment call
- **Time estimate:** 2-4 hours
- **Scope:** TodoWrite if single session, Task Manager if cross-session
- **Characteristics:**
  - Moderate complexity
  - May touch 2-3 files
  - Some design decisions required
  - Testing straightforward
- **Examples:**
  - Add new API endpoint with standard CRUD
  - Integrate third-party library (documented)
  - Build simple UI component

### **5 points** – Substantial ⚠️
- **Time estimate:** 4-8 hours (1 day)
- **Characteristics:**
  - **Requires uncertainties** – document unknowns before starting
  - Cross-cutting changes
  - Integration complexity
  - Multiple edge cases
- **Examples:**
  - Implement authentication flow
  - Database migration with data transform
  - Refactor to support new architecture pattern

### **8 points** – Complex ⚠️⚠️
- **Time estimate:** 1-2 days
- **Characteristics:**
  - **Must decompose before starting**
  - Multiple integration points
  - Performance considerations
  - Significant testing required
- **Examples:**
  - Build real-time sync system
  - Implement complex business workflow
  - Major refactoring across modules

### **13 points** – Very Complex ⚠️⚠️⚠️
- **Time estimate:** 2-3 days
- **Characteristics:**
  - **Must decompose + document architecture**
  - System-wide impact
  - Requires coordination across teams
  - High uncertainty
- **Examples:**
  - Design and implement new microservice
  - Build admin dashboard from scratch
  - Implement end-to-end encryption

### **21 points** – Epic ⚠️⚠️⚠️⚠️
- **Time estimate:** 1+ weeks
- **Characteristics:**
  - **Should probably be a project, not a task**
  - Multiple milestones
  - Cross-functional collaboration
  - Consider breaking into separate tasks
- **Examples:**
  - Platform migration
  - Greenfield product feature
  - Major architectural overhaul

## Rules of Thumb

1. **Effort >3 requires uncertainties** – If you can't articulate what might go wrong, the estimate is probably too low
2. **Effort >5 requires decomposition** – Break it down before starting work
3. **When in doubt, round up** – Fibonacci spacing helps you choose conservatively
4. **Compare to past tasks** – Use completed tasks as calibration anchors
5. **Include testing & documentation** – Effort should cover the complete definition of done

## Complexity Bias (Optional)

Use \`complexityBias\` to signal risk when effort alone doesn't capture it. This parameter helps differentiate between tasks with the same effort but different risk profiles.

### When to Use Complexity Bias

**\`low\`** – Well-understood, low risk
- Clear requirements with no ambiguity
- Working with familiar tools and patterns
- Straightforward implementation path
- Example: Add a new field to existing form (effort 2, low bias)

**\`medium\`** – Standard complexity for the effort level (default assumption)
- Normal uncertainty for the given effort
- Standard patterns and approaches apply
- No special risk factors
- Example: Implement new API endpoint (effort 3, medium bias)

**\`high\`** – Technical unknowns, legacy code, performance-critical
- Working with unfamiliar technology
- Touching legacy code with poor test coverage
- Performance-critical path requiring optimization
- Integration with external systems (unstable APIs)
- Security-sensitive operations
- Example: Refactor core authentication logic (effort 5, high bias)

### Complexity Bias vs Uncertainties

- **Use uncertainties** when you have specific questions that need answers
- **Use complexityBias** when the task has general risk characteristics
- **Use both** when a high-effort task has both specific unknowns AND general risk factors

Example:
\`\`\`json
{
  "effort": 8,
  "complexityBias": "high",
  "uncertainties": ["Which rate limiting algorithm?", "Redis cluster setup?"]
}
\`\`\`

## Anti-patterns

❌ **Don't use effort 1 for everything** – Breaks team velocity tracking
❌ **Don't use effort 21 without decomposition** – Task is too large to execute
❌ **Don't mix "ideal time" with "calendar time"** – Effort is complexity, not duration
❌ **Don't skip effortReason for high-effort tasks** – Future you will need context
`;

const TOOL_SELECTION_MARKDOWN = `# Tool Selection: list_tasks vs query_task

Both tools filter tasks, but they serve different purposes. Use this decision tree to choose the right one.

## Quick Decision Tree

\`\`\`
Do you need to UPDATE the tasks you find?
│
├─ YES → Use query_task
│         - Filters AND modifies tasks in one operation
│         - Requires: filter, limit, operation
│         - Returns: matched count + updated tasks
│
└─ NO  → Use list_tasks
          - Read-only discovery
          - Requires: optional filter, optional limit
          - Returns: tasks + pagination info
\`\`\`

## list_tasks – Read-Only Discovery

### When to use:
- Viewing tasks by status/project/labels
- Finding ready-to-work tasks (\`filter.ready: true\`)
- Browsing backlog
- Checking project state
- Getting tasks for display/reporting

### Signature:
\`\`\`json
{
  "filter": {
    "project": "agent-task-manager",
    "status_in": ["todo", "backlog"],
    "labels_has_every": ["urgent"],
    "has_unresolved_uncertainties": false,
    "ready": true,  // Excludes blocked tasks
    "search": "authentication"  // Full-text search on title and description
  },
  "limit": 25,
  "after": "cursor-for-pagination"
}
\`\`\`

**Search Filter:**
The \`search\` parameter performs case-insensitive substring matching on task title and description fields. It wraps Linear's native search functionality, which means:
- Searches both title and description
- Case-insensitive
- Substring matching (e.g., "auth" matches "authentication", "authorize")
- Works across all other filters (can combine with status, labels, etc.)

Example: \`"search": "rate limit"\` finds tasks with "rate limiting", "Rate Limiter API", "implement rate limits", etc.

### Example: Find ready tasks
\`\`\`json
{
  "filter": { "ready": true },
  "limit": 10
}
\`\`\`

### Returns:
\`\`\`json
{
  "tasks": [...],
  "pageInfo": {
    "hasNextPage": true,
    "endCursor": "..."
  }
}
\`\`\`

## query_task – Filter + Bulk Update

### When to use:
- Bulk status transitions (backlog → todo)
- Adding labels to multiple tasks
- Bulk uncertainty resolution
- Applying lessons to a group
- Cleaning up stale tasks

### Signature:
\`\`\`json
{
  "filter": { /* same as list_tasks */ },
  "limit": 50,  // REQUIRED (safety bound)
  "operation": {
    "set": { "status": "done" },
    "add": { "labels": ["archived"] },
    "remove": { "labels": ["wip"] },
    "resolve": { "uncertainties": [...] }
  }
}
\`\`\`

### Example: Bulk transition ready tasks to todo
\`\`\`json
{
  "filter": {
    "ready": true,
    "status_in": ["backlog"]
  },
  "limit": 20,
  "operation": {
    "set": { "status": "todo" }
  }
}
\`\`\`

### Returns:
\`\`\`json
{
  "matched": 18,
  "updated": 18,
  "tasks": [...]
}
\`\`\`

## Key Differences

| Feature | list_tasks | query_task |
|---------|-----------|-----------|
| **Purpose** | Discovery | Discovery + Modification |
| **limit** | Optional | **Required** (safety) |
| **operation** | N/A | **Required** (must have set/add/remove/resolve) |
| **Side effects** | None | Updates Linear tasks |
| **Pagination** | Supported via \`after\` | Supported via \`after\` |
| **Return value** | tasks + pageInfo | matched + updated + tasks |

## Safety Notes

- **query_task requires explicit limit** – Prevents accidental bulk operations on thousands of tasks
- **operation must include at least one field** – No-op operations are rejected
- **Always test filters with list_tasks first** – Verify the filter matches what you expect before running query_task

## Common Patterns

### Pattern 1: Preview before bulk update
\`\`\`
1. list_tasks with filter → Review results
2. query_task with same filter + operation → Apply changes
\`\`\`

### Pattern 2: Find and mark ready work
\`\`\`
list_tasks({ filter: { ready: true }, limit: 10 })
// Returns tasks without blockers/uncertainties/needs-decomposition
\`\`\`

### Pattern 3: Clean up completed sprint
\`\`\`
query_task({
  filter: { status_in: ["done"], labels_has_every: ["sprint-42"] },
  limit: 100,
  operation: { add: { labels: ["archived"] } }
})
\`\`\`

### Pattern 4: Cancel duplicate or stale tasks
\`\`\`
query_task({
  filter: { search: "duplicate", status_in: ["todo", "backlog"] },
  limit: 20,
  operation: { set: { status: "canceled" } }
})
\`\`\`

**Note:** Use \`status: "canceled"\` instead of deleting tasks. This preserves history, maintains task relationships, and keeps lessons learned searchable. Deletion is reserved for human operators only.
`;

const EXAMPLE_WORKFLOW_RESOURCES = [
  {
    uri: 'examples://feature-launch-workflow',
    name: 'Feature Launch Workflow',
    title: 'Feature Launch Workflow',
    description:
      'End-to-end example capturing a product request, decomposing it, and updating progress through completion.',
    text: `# Feature Launch Workflow

This walkthrough demonstrates how to capture a product feature request, decompose the work, track execution, and close the loop with lessons learned.

## 1. Capture the product request
Use \`create_task\` to register the request and document the initial plan.

\`\`\`json
{
  "title": "Add dark mode toggle",
  "description": "Allow users to switch between light and dark themes from the header.",
  "goal": "Deliver dark mode prior to the Q3 launch",
  "effort": 8,
  "effortReason": "Requires design, implementation, and QA across platforms",
  "project": "launch",
  "uncertainties": [
    {
      "title": "Design tokens impact",
      "description": "Need confirmation that existing tokens support dark mode"
    }
  ],
  "dependencies": [
    {
      "taskID": "NON-1010",
      "type": "blocked_by"
    }
  ]
}
\`\`\`

## 2. Decompose the high-effort parent task
Because the parent effort is greater than 3, immediately break down the work with \`decompose_task\`.

\`\`\`json
{
  "taskID": "NON-1234",
  "decompositionReason": "Cross-discipline delivery benefits from parallel execution",
  "subtasks": [
    {
      "title": "Finalize dark mode visual design",
      "effort": 3,
      "sequenceOrder": 1,
      "assignee": "maya.design"
    },
    {
      "title": "Implement theme switcher",
      "effort": 5,
      "sequenceOrder": 2,
      "assignee": "lee.frontend"
    },
    {
      "title": "QA and rollout plan",
      "effort": 2,
      "sequenceOrder": 3,
      "assignee": "sam.qa"
    }
  ]
}
\`\`\`

## 3. Track day-to-day execution
Use \`update_task\` to communicate progress, ready state, and any new lessons.

\`\`\`json
{
  "taskID": "NON-1234",
  "set": {
    "status": "in-progress",
    "description": "Implementation underway after design sign-off"
  },
  "add": {
    "lessonsLearned": [
      {
        "content": "Component library theming requires explicit inverted icons.",
        "category": "gotcha"
      }
    ]
  }
}
\`\`\`

## 4. Resolve uncertainties and close the task
When blockers are cleared, close the loop by resolving outstanding uncertainties and capturing the outcome with \`update_task\`.

\`\`\`json
{
  "taskID": "NON-1234",
  "resolve": {
    "uncertainties": [
      {
        "title": "Design tokens impact",
        "resolution": "Tokens extended with dark counterparts; rollout is safe"
      }
    ]
  }
}
\`\`\`

Finally, mark the task as done once QA verifies the rollout:

\`\`\`json
{
  "taskID": "NON-1234",
  "set": {
    "status": "done"
  },
  "add": {
    "lessonsLearned": [
      {
        "content": "Ship critical theme work behind a feature flag for faster rollouts.",
        "category": "decision"
      }
    ]
  }
}
\`\`\`
`,
  },
  {
    uri: 'examples://incident-triage-loop',
    name: 'Incident Triage Loop',
    title: 'Incident Triage Loop',
    description:
      'Example workflow for capturing an urgent incident, coordinating mitigation, and updating status as information arrives.',
    text: `# Incident Triage Loop

This scenario shows how to respond to a production incident by capturing the initial alert, coordinating mitigation work, and documenting outcomes.

## 1. Capture the incident as a task
Record the alert details with \`create_task\` so the team has a single source of truth.

\`\`\`json
{
  "title": "Latency spike on checkout",
  "description": "Checkout API P95 latency > 5s since 12:05 UTC",
  "effort": 3,
  "effortReason": "Likely a configuration regression",
  "project": "reliability",
  "labels": ["incident", "sev-1"],
  "uncertainties": [
    {
      "title": "Is recent deployment related?",
      "description": "Need to confirm impact of release 2024.04.18"
    }
  ]
}
\`\`\`

## 2. Coordinate mitigation with subtasks
If the response spans multiple functions, decompose the task for clarity.

\`\`\`json
{
  "taskID": "NON-2345",
  "subtasks": [
    {
      "title": "Roll back release 2024.04.18",
      "effort": 2,
      "sequenceOrder": 1,
      "assignee": "ops.oncall"
    },
    {
      "title": "Gather database metrics",
      "effort": 1,
      "sequenceOrder": 1,
      "assignee": "db.engineer"
    },
    {
      "title": "Draft customer update",
      "effort": 1,
      "sequenceOrder": 2,
      "assignee": "support.lead"
    }
  ]
}
\`\`\`

## 3. Provide frequent status updates
Keep stakeholders informed by moving the status and adding context via \`update_task\`.

\`\`\`json
{
  "taskID": "NON-2345",
  "set": {
    "status": "in-progress",
    "description": "Rollback underway; monitoring impact"
  },
  "add": {
    "lessonsLearned": [
      {
        "content": "Real-time dashboards surfaced anomaly faster than paging threshold.",
        "category": "pattern"
      }
    ]
  }
}
\`\`\`

## 4. Resolve remaining uncertainty
Once the team confirms the cause, close the open question using \`update_task\`.

\`\`\`json
{
  "taskID": "NON-2345",
  "resolve": {
    "uncertainties": [
      {
        "title": "Is recent deployment related?",
        "resolution": "Root cause traced to release 2024.04.18 cache invalidation bug",
        "resolvedBy": "ops.oncall"
      }
    ]
  }
}
\`\`\`

## 5. Wrap up the incident
When mitigated, move the task to done and extract the final lesson.

\`\`\`json
{
  "taskID": "NON-2345",
  "set": {
    "status": "done"
  },
  "add": {
    "lessonsLearned": [
      {
        "content": "Automate post-deploy smoke tests for cache warmers.",
        "category": "solution",
        "tags": ["release", "automation"]
      }
    ]
  }
}
\`\`\`
`,
  },
] as const satisfies ReadonlyArray<{
  uri: string;
  name: string;
  title: string;
  description: string;
  text: string;
}>;

const EXAMPLE_WORKFLOW_LOOKUP = new Map(EXAMPLE_WORKFLOW_RESOURCES.map((resource) => [resource.uri, resource]));
type ExampleWorkflowUri = (typeof EXAMPLE_WORKFLOW_RESOURCES)[number]['uri'];
const isExampleWorkflowUri = (uri: string): uri is ExampleWorkflowUri =>
  EXAMPLE_WORKFLOW_RESOURCES.some((resource) => resource.uri === uri);

export function listResources(config?: Config): ListResourcesResult {
  const resources: ListResourcesResult['resources'] = [
    {
      uri: 'help://quickstart',
      name: 'Quickstart Guide',
      mimeType: 'text/markdown',
      description: 'Workflow overview, rules, and reminders for the MCP server',
      annotations: {
        audience: ['assistant'],
        priority: 1.0, // Always load first - essential workflow context
      },
    },
    {
      uri: 'help://effort-calibration',
      name: 'Effort Calibration Guide',
      mimeType: 'text/markdown',
      description: 'Practical guide to choosing Fibonacci effort values with time estimates and examples',
      annotations: {
        audience: ['assistant'],
        priority: 0.6, // Load when effort questions arise
      },
    },
    {
      uri: 'help://tool-selection',
      name: 'Tool Selection Guide',
      mimeType: 'text/markdown',
      description: 'Decision tree for choosing between list_tasks and query_task',
      annotations: {
        audience: ['assistant'],
        priority: 0.5, // Load when choosing between list/query tools
      },
    },
    ...(config
      ? [
          {
            uri: 'config://server',
            name: 'Server Configuration',
            mimeType: 'application/json',
            description: `Current Linear/Notion/project configuration snapshot (default project: ${config.defaultProject ?? 'not set'})`,
            annotations: {
              audience: ['assistant'],
              priority: 0.9, // Critical for understanding available integrations
            },
          },
        ]
      : []),
    ...EXAMPLE_WORKFLOW_RESOURCES.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      mimeType: 'text/markdown',
      description: resource.description,
      annotations: {
        audience: ['assistant'],
        priority: 0.4, // Helpful but not essential - load on demand
      },
    })),
  ];

  if (config && Object.entries(config.projects).length > 0) {
    resources.push({
      uri: 'task://NON-***',
      name: 'Task by Linear key',
      mimeType: 'application/json',
      description: 'Use read_resource on task://NON-### to fetch individual task details',
      annotations: {
        audience: ['assistant'],
        priority: 0.3, // Low priority - just a template pointer
      },
    });
  }

  return { resources };
}

export function listResourceTemplates(): ListResourceTemplatesResult {
  return {
    resourceTemplates: [
      {
        uriTemplate: 'help://quickstart',
        name: 'Quickstart Guide',
        description: 'Workflow reminders for Agent Task Manager',
        mimeType: 'text/markdown',
        annotations: {
          audience: ['assistant'],
          priority: 1.0,
        },
      },
      {
        uriTemplate: 'help://effort-calibration',
        name: 'Effort Calibration Guide',
        description: 'Practical guide to choosing Fibonacci effort values with time estimates and examples',
        mimeType: 'text/markdown',
        annotations: {
          audience: ['assistant'],
          priority: 0.6,
        },
      },
      {
        uriTemplate: 'help://tool-selection',
        name: 'Tool Selection Guide',
        description: 'Decision tree for choosing between list_tasks and query_task',
        mimeType: 'text/markdown',
        annotations: {
          audience: ['assistant'],
          priority: 0.5,
        },
      },
      {
        uriTemplate: 'config://server',
        name: 'Server Configuration',
        description: 'Snapshot of sanitized server configuration',
        mimeType: 'application/json',
        annotations: {
          audience: ['assistant'],
          priority: 0.9,
        },
      },
      ...EXAMPLE_WORKFLOW_RESOURCES.map((resource) => ({
        uriTemplate: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: 'text/markdown',
        annotations: {
          audience: ['assistant'],
          priority: 0.4,
        },
      })),
      {
        uriTemplate: 'task://{linearKey}',
        name: 'Task by Linear key',
        description: 'Fetch details for a Linear issue using its NON-### identifier',
        mimeType: 'application/json',
        annotations: {
          audience: ['assistant'],
          priority: 0.3,
        },
      },
    ],
  } satisfies ListResourceTemplatesResult;
}

function serializeConfig(config: Config): Record<string, unknown> {
  const result: Record<string, unknown> = {
    linear: {
      teamId: config.linear.teamId,
    },
    storageBackend: config.storageBackend,
    defaultProject: config.defaultProject,
  };

  if (config.storageBackend === 'basic-memory' && config.basicMemory) {
    result.basicMemory = {
      rootPath: config.basicMemory.rootPath,
      globalPath: config.basicMemory.globalPath,
    };
    result.projects = Object.fromEntries(
      Object.entries(config.projects).map(([key, value]) => [
        key,
        {
          linearProjectId: value.linearProjectId,
          path: 'path' in value ? value.path : undefined,
        },
      ])
    );
  } else if (config.notion) {
    result.notion = {
      hasGlobalLessons: Boolean(config.notion.globalLessonsDbId),
      hasGlobalDecisions: Boolean(config.notion.globalDecisionsDbId),
    };
    result.projects = Object.fromEntries(
      Object.entries(config.projects).map(([key, value]) => [
        key,
        {
          linearProjectId: value.linearProjectId,
          notionLessonsDbId: 'notionLessonsDbId' in value ? value.notionLessonsDbId : undefined,
          notionDecisionsDbId: 'notionDecisionsDbId' in value ? value.notionDecisionsDbId : undefined,
        },
      ])
    );
  }

  return result;
}

export function readResource(uri: string, config?: Config): ReadResourceResult {
  if (uri === 'help://quickstart') {
    return {
      contents: [
        {
          uri,
          name: 'quickstart',
          title: 'Quickstart Guide',
          description: 'Workflow overview and reminders',
          mimeType: 'text/markdown',
          text: QUICKSTART_MARKDOWN,
          annotations: {
            audience: ['assistant'],
            priority: 1.0,
          },
        } satisfies TextResourceContents,
      ],
    } satisfies ReadResourceResult;
  }

  if (uri === 'help://effort-calibration') {
    return {
      contents: [
        {
          uri,
          name: 'effort-calibration',
          title: 'Effort Calibration Guide',
          description: 'Practical guide to choosing Fibonacci effort values',
          mimeType: 'text/markdown',
          text: EFFORT_CALIBRATION_MARKDOWN,
          annotations: {
            audience: ['assistant'],
            priority: 0.6,
          },
        } satisfies TextResourceContents,
      ],
    } satisfies ReadResourceResult;
  }

  if (uri === 'help://tool-selection') {
    return {
      contents: [
        {
          uri,
          name: 'tool-selection',
          title: 'Tool Selection Guide',
          description: 'Decision tree for list_tasks vs query_task',
          mimeType: 'text/markdown',
          text: TOOL_SELECTION_MARKDOWN,
          annotations: {
            audience: ['assistant'],
            priority: 0.5,
          },
        } satisfies TextResourceContents,
      ],
    } satisfies ReadResourceResult;
  }

  if (uri === 'config://server') {
    if (!config) {
      throw new Error('Server configuration has not been loaded yet.');
    }
    return {
      contents: [
        {
          uri,
          name: 'server-config',
          title: 'Server Configuration',
          description: 'Sanitized view of active configuration',
          mimeType: 'application/json',
          text: JSON.stringify(serializeConfig(config), null, 2),
          annotations: {
            audience: ['assistant'],
            priority: 0.9,
          },
        } satisfies TextResourceContents,
      ],
    } satisfies ReadResourceResult;
  }

  if (isExampleWorkflowUri(uri)) {
    const example = EXAMPLE_WORKFLOW_LOOKUP.get(uri);
    if (!example) {
      throw new Error(`Example workflow ${uri} missing from lookup`);
    }
    return {
      contents: [
        {
          uri,
          name: example.name,
          title: example.title,
          description: example.description,
          mimeType: 'text/markdown',
          text: example.text,
          annotations: {
            audience: ['assistant'],
            priority: 0.4,
          },
        } satisfies TextResourceContents,
      ],
    } satisfies ReadResourceResult;
  }

  if (uri.startsWith('task://')) {
    return {
      contents: [
        {
          uri,
          name: uri.replace('task://', ''),
          title: `Task reference for ${uri.replace('task://', '')}`,
          description: 'Use get_task to retrieve the latest task payload for this Linear key.',
          mimeType: 'text/markdown',
          text: `🔗 Use \`get_task\` to fetch full task details:
- Single task: {taskID: "${uri.replace('task://', '')}"}
- With tree: {taskID: "${uri.replace('task://', '')}", includeTree: true}
- Compact: {taskID: "${uri.replace('task://', '')}", output: "compact"}`,
          annotations: {
            audience: ['assistant'],
            priority: 0.3,
          },
        } satisfies TextResourceContents,
      ],
    } satisfies ReadResourceResult;
  }

  throw new Error(`Unsupported resource URI: ${uri}`);
}
