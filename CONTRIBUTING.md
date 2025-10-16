# Contributing Guidelines

Thanks for helping improve Agent Task Manager! This document captures the minimum expectations for contributions while the project is being prepared for its first public commit.

## Prerequisites

- [Node.js 20](https://nodejs.org/) or newer
- [pnpm](https://pnpm.io/) (Corepack users can run `corepack enable`)

## Getting Started

```bash
pnpm install
```

Before sending changes, please make sure all automated checks pass:

```bash
pnpm lint        # ESLint (flat config)
pnpm typecheck   # TypeScript --noEmit
pnpm test        # Vitest + coverage thresholds
pnpm build       # tsc emits to dist/
```

## Commit & PR Checklist

- Update documentation when behaviour or setup changes (e.g., README, docs, examples).
- Leave generated artifacts (`dist/`, `coverage/`, etc.) out of commits—these folders are produced as part of CI.
- Reference Linear issue keys (e.g., `NON-###`) in commit messages when applicable.

## Reporting Issues

Open a Linear task or GitHub issue with:

1. **Summary** – what you expected vs. what happened.
2. **Reproduction** – minimal steps or scripts.
3. **Environment** – OS, Node.js version, additional context.

Thank you for contributing!
