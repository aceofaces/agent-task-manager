# Agent Task Manager

Workflow orchestrator MCP server that wraps Linear with task management semantics, using local markdown files (basic-memory) or Notion for knowledge storage.

## Features

- **Effort-Based Decomposition**: Tasks with effort > 3 must be decomposed before work (Fibonacci scale: 1, 2, 3, 5, 8, 13, 21)
- **Uncertainty Tracking**: High-effort tasks (>3) require uncertainties to be defined upfront
- **Flexible Knowledge Storage**: Choose between local markdown files (basic-memory) or Notion databases
- **Lesson Extraction**: Automatically capture knowledge for future reference
- **Project Isolation**: Organize tasks and knowledge by project using Linear Projects
- **Enhanced Update Operations**: set/add/remove/resolve semantics for precise task updates
- **Tree Completion Detection**: Automatic prompts for lesson extraction when task trees complete
- **Free Tier Compatible**: Works with Linear free plan; Notion optional

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
└─ Knowledge Storage (Choose one):
   │
   ├─ Basic-Memory (Default, Recommended)
   │  - Local markdown files
   │  - Git-friendly and portable
   │  - No external dependencies
   │  - Project-based folders
   │
   └─ Notion (Optional, for team collaboration)
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

The wizard will guide you through:
1. Connecting to Linear (API key discovery)
2. Selecting your team and projects
3. **Choosing storage backend:**
   - **Basic-Memory** (default): Local markdown files, ~2 minute setup
   - **Notion**: Collaborative databases, ~10 minute setup (requires Notion account)
4. Generating configuration files (.env and mcp.json)
5. Validating the setup
6. Running a connection test

**Quick Start (Basic-Memory):**
- Only requires Linear API key
- Knowledge stored in local `./.memory/` directory
- Git-friendly and portable
- Perfect for solo development

**Advanced Setup (Notion):**
- Requires Notion integration token
- Great for team collaboration
- Rich formatting and databases
- See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed Notion setup

For manual setup or advanced configuration, see the detailed instructions below. Detailed developer documentation now lives in `dev_docs/` (ignored in git). Run the setup wizard to regenerate the latest docs locally if needed.

## Configuration

### 1. Environment Variables

#### Basic-Memory (Recommended)

Create a `.env` file:

```env
# Linear Configuration
LINEAR_API_KEY=lin_api_your_key_here
LINEAR_TEAM_ID=your-team-id-here

# Storage Backend
STORAGE_BACKEND=basic-memory

# Basic Memory Configuration
BASIC_MEMORY_ROOT_PATH=./.memory
BASIC_MEMORY_GLOBAL_PATH=./.memory/global

# Project Mappings (JSON)
PROJECT_MAPPINGS={"my-project":{"linearProjectId":"uuid","path":"./.memory/projects/my-project"}}

# Optional: Default project key
DEFAULT_PROJECT=my-project

# Optional: Uncertainty resolution mode
# off = allow decomposition with unresolved uncertainties
# warn = allow but log warning (default)
# block = prevent decomposition until uncertainties resolved
UNCERTAINTY_RESOLUTION_MODE=warn
```

#### Notion (Advanced)

For Notion-based knowledge storage:

```env
# Linear Configuration
LINEAR_API_KEY=lin_api_your_key_here
LINEAR_TEAM_ID=your-team-id-here

# Storage Backend
STORAGE_BACKEND=notion

# Notion Configuration
NOTION_API_KEY=your_integration_token_here

# Project Mappings (JSON)
PROJECT_MAPPINGS={"project-a":{"linearProjectId":"uuid","notionLessonsDbId":"uuid","notionLessonsDataSourceId":"uuid","notionDecisionsDbId":"uuid","notionDecisionsDataSourceId":"uuid"}}

# Optional: Default project key
DEFAULT_PROJECT=project-a

# Optional: Global databases for cross-project knowledge
NOTION_GLOBAL_LESSONS_DB_ID=uuid
NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID=uuid
NOTION_GLOBAL_DECISIONS_DB_ID=uuid
NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID=uuid

# Optional: Uncertainty resolution mode
UNCERTAINTY_RESOLUTION_MODE=warn
```

### 2. Linear Setup

1. Create an API key: Settings → API → Personal API keys
2. Get your team ID: Open Linear → URL will be `app.linear.app/TEAM-ID/...`
3. Create Projects for each project you want to track
4. (Optional) Create issue templates with the metadata format

### 3. Basic-Memory Setup

1. Choose a root directory for knowledge storage (e.g., `./.memory`)
2. The system will automatically create:
   - `<root>/projects/<project-name>/` for each project
   - `<root>/global/` for cross-project knowledge
3. Files are stored as markdown for easy viewing and git tracking

### 4. Notion Setup (Optional)

Only needed if using `STORAGE_BACKEND=notion`:

1. Create an integration: https://www.notion.so/my-integrations
2. Create databases:
   - Lessons Learned (per project)
   - Decisions (per project)
   - Optional: Global versions for cross-project knowledge
3. Share databases with your integration
4. Get database IDs from URLs

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions.

### 5. MCP Configuration

**For Claude Code (Primary Target):**

Add to your `.mcp.json` file in your project root.

**Basic-Memory Configuration:**

```json
{
  "mcpServers": {
    "agent-task-manager": {
      "args": ["/absolute/path/to/agent-task-manager/dist/index.js"],
      "env": {
        "LINEAR_API_KEY": "lin_api_...",
        "LINEAR_TEAM_ID": "your-team-id",
        "STORAGE_BACKEND": "basic-memory",
        "BASIC_MEMORY_ROOT_PATH": "./.memory",
        "BASIC_MEMORY_GLOBAL_PATH": "./.memory/global",
        "PROJECT_MAPPINGS": "{\"my-project\":{\"linearProjectId\":\"uuid\",\"path\":\"./.memory/projects/my-project\"}}"
      }
    }
  }
}
```

**Notion Configuration:**

```json
{
  "mcpServers": {
    "agent-task-manager": {
      "args": ["/absolute/path/to/agent-task-manager/dist/index.js"],
      "env": {
        "LINEAR_API_KEY": "lin_api_...",
        "LINEAR_TEAM_ID": "your-team-id",
        "STORAGE_BACKEND": "notion",
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
// 📝 Lesson extracted to knowledge base (global scope)
```

## Free Tier Compatibility

### Linear Free Plan

The agent-task-manager works perfectly with Linear's free plan:

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

### Basic-Memory (No Costs)

With basic-memory as your storage backend:
- ✅ Zero external dependencies
- ✅ No API limits or rate limiting
- ✅ Git-friendly markdown files
- ✅ Works completely offline
- ✅ Perfect for solo developers

### Notion Free Plan (Optional)

If you choose Notion for knowledge storage:
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
