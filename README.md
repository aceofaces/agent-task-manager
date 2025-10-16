# Agent Task Manager

Workflow orchestrator MCP server that wraps Linear and Notion with task management semantics.

## Features

- **Effort-Based Decomposition**: Tasks with effort > 3 must be decomposed before work (Fibonacci scale: 1, 2, 3, 5, 8, 13, 21)
- **Uncertainty Tracking**: High-effort tasks (>3) require uncertainties to be defined upfront
- **Lesson Extraction**: Automatically capture knowledge to Notion for future reference
- **Project Isolation**: Organize tasks and knowledge by project using Linear Projects
- **Enhanced Update Operations**: set/add/remove/resolve semantics for precise task updates
- **Tree Completion Detection**: Automatic prompts for lesson extraction when task trees complete
- **Free Tier Compatible**: Works with Linear and Notion free plans (with workarounds)

## Architecture

```
Agent Task Manager (MCP Server)
  ↓
├─ Linear (Tasks & Workflow)
│  - Issues with metadata in description
│  - Sub-issues for decomposition
│  - Project-based isolation
│  - Labels for effort tracking (effort: 1, 2, 3, 5, 8, 13, 21)
│
└─ Notion (Knowledge Base)
   - Lessons Learned database per project
   - Decisions database per project
   - Optional global databases
   - Semantic search (premium feature)
```

## Installation

```bash
cd agent-task-manager
pnpm install
pnpm run build
```

## Development Scripts

| Command          | Description                                         |
| ---------------- | --------------------------------------------------- |
| `pnpm start`     | Launches the MCP server (requires environment vars) |
| `pnpm lint`      | ESLint (fails on warnings)                          |
| `pnpm typecheck` | TypeScript type checking (`--noEmit`)               |
| `pnpm test`      | Vitest with coverage thresholds                     |
| `pnpm build`     | Emits compiled JS to `dist/`                        |

> The CI workflow runs every command above to keep the baseline healthy.

## Quick Setup (Recommended)

The easiest way to set up the Agent Task Manager is using the interactive setup wizard:

```bash
pnpm run setup
```

This will guide you through:
1. Connecting to Linear (API key discovery)
2. Selecting your team and projects
3. Creating Notion databases
4. Generating configuration files (.env and mcp.json)
5. Validating the setup
6. Running a connection test

For manual setup or advanced configuration, see the detailed instructions below. Detailed developer documentation now lives in `dev_docs/` (ignored in git). Run the setup wizard to regenerate the latest docs locally if needed.

## Configuration

### 1. Environment Variables

Create a `.env` file:

```env
# Linear
LINEAR_API_KEY=lin_api_your_key_here
LINEAR_TEAM_ID=your-team-id-here

# Notion
NOTION_API_KEY=your_integration_token_here

# Project Mappings (JSON)
PROJECT_MAPPINGS={"project-a":{"linearProjectId":"uuid","notionLessonsDbId":"uuid","notionLessonsDataSourceId":"uuid","notionDecisionsDbId":"uuid","notionDecisionsDataSourceId":"uuid"}}

# Optional: Default project key to use when none is provided
DEFAULT_PROJECT=project-a

# Optional: Global databases for cross-project knowledge
NOTION_GLOBAL_LESSONS_DB_ID=uuid
NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID=uuid
NOTION_GLOBAL_DECISIONS_DB_ID=uuid
NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID=uuid

# Optional: Uncertainty resolution enforcement mode
# off = allow decomposition with unresolved uncertainties
# warn = allow but log warning (default)
# block = prevent decomposition until uncertainties resolved
UNCERTAINTY_RESOLUTION_MODE=warn
```

### 2. Linear Setup

1. Create an API key: Settings → API → Personal API keys
2. Get your team ID: Open Linear → URL will be `app.linear.app/TEAM-ID/...`
3. Create Projects for each project you want to track
4. (Optional) Create issue templates with the metadata format

### 3. Notion Setup

1. Create an integration: https://www.notion.so/my-integrations
2. Create databases:
   - Lessons Learned (per project)
   - Decisions (per project)
   - Optional: Global versions for cross-project knowledge
3. Share databases with your integration
4. Get database IDs from URLs

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions.

### 4. MCP Configuration

**For Claude Code (Primary Target):**

Add to your `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "agent-task-manager": {
      "args": ["/work/pm/agent-task-manager/dist/index.js"],
      "env": {
        "LINEAR_API_KEY": "lin_api_...",
        "LINEAR_TEAM_ID": "your-team-id",
        "NOTION_API_KEY": "your_notion_token",
        "PROJECT_MAPPINGS": "{\"my-project\":{\"linearProjectId\":\"uuid\",\"notionLessonsDbId\":\"uuid\",\"notionLessonsDataSourceId\":\"uuid\",\"notionDecisionsDbId\":\"uuid\",\"notionDecisionsDataSourceId\":\"uuid\"}}",
        "NOTION_GLOBAL_LESSONS_DB_ID": "uuid",
        "NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID": "uuid",
        "NOTION_GLOBAL_DECISIONS_DB_ID": "uuid",
        "NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID": "uuid"
      }
    }
  }
}
```

Create a new task with goal, effort estimate, and required uncertainties (for effort > 3).

```typescript
create_task({
  title: "Add OAuth",
  goal: "Secure API endpoints with OAuth",
  effort: 5, // Fibonacci scale: 1, 2, 3, 5, 8, 13, 21
  effortReason: "Requires security review and integration testing",
  complexityBias: "high",
  project: "my-project",
  uncertainties: [
    "PKCE vs implicit?",
    "Need security review availability"
  ]
});
```

**⚠️ Important**:
- Tasks with effort > 3 **require** at least one uncertainty
- `taskEffort.effort` must be one of `1, 2, 3, 5, 8, 13, 21`
- Uncertainties can be captured as simple strings; richer metadata is still preserved internally when resolving

### 3. Decompose Task

```typescript
decompose_task({
  taskID: task.taskID,
  decompositionReason: "Breaking into sequential phases with parallel sub-work",
  subtasks: [
    {
      title: "Research auth patterns",
      effort: 2,
      sequenceOrder: 1  // Phase 1
    },
    {
      title: "Implement password hashing",
      effort: 2,
      sequenceOrder: 2  // Phase 2
    },
    {
      title: "Add JWT token management",
      effort: 3,
      sequenceOrder: 2  // Phase 2 (parallel with password hashing)
    },
    {
      title: "Write tests",
      effort: 2,
      sequenceOrder: 3  // Phase 3 (depends on Phase 2)
    }
  ]
})
// ✅ Task decomposed into 4 subtasks. Ready for work.
```

## Continuous Integration

Every push and pull request to `main` triggers [`.github/workflows/ci.yml`](.github/workflows/ci.yml), which runs:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test -- --reporter=verbose`
4. `pnpm build`
5. A smoke check that `pnpm start` launches with placeholder credentials

Weekly Dependabot checks (`.github/dependabot.yml`) keep npm and GitHub Actions dependencies up to date.

### 4. Complete & Extract Lessons

```typescript
// Mark subtask as done
update_task({
  tasks: [{
    taskID: "LINEAR-124",  // password hashing subtask
    set: { status: "done" },
    add: {
      lessonsLearned: [{
        content: "Use bcrypt with cost factor 12 for password hashing - balances security and performance",
        category: "pattern"
      }]
    }
  }]
})

// When entire tree completes, system automatically prompts:
// ✅ Entire task tree completed: LINEAR-123 - Implement user authentication
// Consider extracting consolidated lessons with extract_lesson tool.

extract_lesson({
  taskID: task.taskID,
  lesson: {
    content: "JWT with refresh token rotation provides good security/UX balance for distributed auth",
    category: "pattern",
    tags: ["security", "authentication", "jwt"]
  },
  scope: "global",
  relatedConcepts: ["Authentication", "Security Best Practices", "Distributed Systems"]
})
// 📝 Lesson extracted to Notion (global scope)
```

## Free Tier Limitations

### Linear Free Plan

- ✅ Unlimited issues
- ❌ No custom fields → We store metadata in description
- ⚠️ Limited to 1 team → Use Projects for isolation

**Workaround**: Metadata stored in structured description format:

```markdown
---WORKFLOW-METADATA---
**Goal:** Secure API with OAuth
**Effort:** 5
**Complexity Bias:** high
**Uncertainties:**
- [ ] PKCE vs implicit flow?
- [x] Token storage?
  - Resolution: Use httpOnly cookies
**Lessons Learned:**
- [pattern] Always validate token signatures
- [security] Refresh token rotation prevents token replay attacks
---END-METADATA---

(Regular description content here)
```

### Notion Free Plan

- ✅ Unlimited pages and blocks
- ❌ No AI/semantic search via API → Returns all results
- ⚠️ 3 req/sec rate limit → Should be fine for solo dev

## Setup Scripts

The project includes several helper scripts for setup and maintenance:

```bash
# Interactive setup wizard (recommended for first-time setup)
pnpm run setup

# Discover Linear teams and projects
pnpm run setup:discover-linear

# Create Notion databases
pnpm run setup:create-notion-dbs

# Update database schemas (add missing properties)
pnpm run setup:update-schema [--env=.env] [--dry-run]

# Generate .env file
pnpm run setup:generate-env

# Generate MCP configuration
pnpm run setup:generate-mcp-config

# Validate setup
pnpm run setup:validate

# Test connection
pnpm run setup:test
```

## Development

```bash
# Watch mode
pnpm run watch

# Build
pnpm run build

# Run
pnpm start
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions, coding standards, and the pre-submit checklist.

## License

Released under the [MIT License](./LICENSE).
