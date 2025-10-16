# Quality Gates

This document describes the quality gates enforced in this project to ensure code quality, security, and maintainability.

## Overview

As a project **built by agents for agents**, we enforce strict quality gates to ensure reliability and maintainability for AI-driven development workflows.

## Pre-commit Checks

The following checks run automatically on every commit via Husky:

1. **Security audit** (`pnpm audit`)
2. **Type checking** (`pnpm typecheck`)
3. **Linting** (`pnpm lint`)
4. **Tests** (`pnpm test`)
5. **Build verification** (`pnpm build`)
6. **Start verification** (`pnpm run verify:start`)

## Continuous Quality Checks

### 🔴 High Priority (Enforced in Precommit)

#### 1. Security Audit
```bash
pnpm audit --audit-level=high
```
- **Purpose**: Detect known vulnerabilities in dependencies
- **Threshold**: No high or critical vulnerabilities allowed
- **Enforcement**: Blocks commits
- **Fix**: `pnpm audit --fix`

#### 2. Commit Message Linting
- **Tool**: `@commitlint/config-conventional`
- **Purpose**: Enforce conventional commit format
- **Format**: `type(scope): subject`
- **Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`
- **Enforcement**: Blocks commits via commit-msg hook

#### 3. Code Coverage Thresholds
```typescript
// vitest.config.ts
coverage: {
  lines: 0.95,        // 95% line coverage
  functions: 0.95,    // 95% function coverage
  statements: 0.95,   // 95% statement coverage
  branches: 0.9,      // 90% branch coverage
}
```
- **Purpose**: Ensure comprehensive test coverage
- **Enforcement**: Test suite fails if thresholds not met
- **Scope**: `src/orchestrator/**/*.ts` and `src/domain/**/*.ts`

#### 4. MCP Schema Validation
- **Test**: `src/__tests__/mcp-schema-validation.test.ts`
- **Purpose**: Ensure MCP tool schemas match implementation
- **Benefits**: Agents can rely on consistent interfaces

### 🟡 Medium Priority (Run on Demand)

#### 5. Circular Dependency Detection
```bash
pnpm run check:circular
```
- **Tool**: `madge`
- **Purpose**: Detect circular dependencies
- **Command**: Analyzes TypeScript source files
- **Result**: Lists any circular dependencies found

#### 6. Dead Code Detection
```bash
pnpm run check:unused
```
- **Tool**: `ts-prune`
- **Purpose**: Identify unused exports
- **Command**: Scans for exports never imported elsewhere
- **Result**: Lists potentially unused exports
- **Note**: Some exports may be intentionally public API

#### 7. API Breaking Change Detection
```bash
pnpm run check:api
```
- **Tool**: `@microsoft/api-extractor`
- **Purpose**: Track public API surface changes
- **Output**: `etc/api-report.api.md`
- **Benefits**:
  - Prevents accidental breaking changes
  - Documents public API
  - Version-to-version API diffs

#### 8. Run All Checks
```bash
pnpm run check:all
```
Runs: circular dependency check, unused exports check, and API report generation.

## CI/CD Pipeline

### GitHub Actions Workflow (`.github/workflows/ci.yml`)

Runs on:
- Push to `main` branch
- Pull requests to `main`

Steps:
1. Checkout code
2. Setup Node.js 20
3. Install dependencies (frozen lockfile)
4. Security audit (fail on high/critical)
5. Lint (zero warnings)
6. Type check
7. Run tests with coverage
8. Build

## Configuration Files

### `.commitlintrc.json`
```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [2, "always", [
      "feat", "fix", "docs", "refactor", "test", "chore", "perf"
    ]]
  }
}
```

### `.husky/pre-commit`
```bash
#!/usr/bin/env sh
pnpm run precommit
```

### `.husky/commit-msg`
```bash
#!/usr/bin/env sh
npx --no -- commitlint --edit "$1"
```

### `vitest.config.ts`
Defines coverage thresholds and test configuration.

### `api-extractor.json`
Configures API report generation and validation.

## For Developers

### Before Committing
Husky will automatically run precommit checks. Ensure they pass:
```bash
pnpm run precommit
```

### Running Individual Checks
```bash
# Security
pnpm audit

# Type safety
pnpm typecheck

# Code style
pnpm lint

# Tests
pnpm test

# Code quality checks
pnpm run check:all
```

### Fixing Issues
```bash
# Fix security vulnerabilities
pnpm audit --fix

# Fix linting errors
pnpm lint --fix

# Update API report after intentional changes
pnpm run check:api
git add etc/api-report.api.md
```

## Bypassing Checks (Not Recommended)

In rare cases where you need to bypass hooks:
```bash
git commit --no-verify
```

**Warning**: This should only be used in emergencies and requires approval during code review.

## Quality Metrics

### Current Status
- ✅ 95%+ code coverage on core modules
- ✅ Zero circular dependencies
- ✅ Zero high/critical vulnerabilities
- ✅ All 80+ tests passing
- ✅ API surface documented and tracked

### Goals
- Maintain 95%+ coverage on critical paths
- Zero tolerance for security vulnerabilities
- No accidental breaking changes to public API
- Clear commit history via conventional commits

## Why These Quality Gates?

As a project built by agents for agents, we prioritize:

1. **Reliability**: High test coverage ensures agents can depend on predictable behavior
2. **Security**: Automated security scanning protects against supply chain attacks
3. **Maintainability**: Clean architecture (no circular deps) makes code easier to understand
4. **API Stability**: Breaking change detection prevents disrupting agent workflows
5. **Traceability**: Conventional commits create clear audit trails

## Adding New Quality Gates

To add a new quality gate:

1. Add dev dependency: `pnpm add -D <tool>`
2. Add script to `package.json`: `"check:something": "..."`
3. Document in this file
4. Consider adding to CI workflow
5. Update `check:all` if appropriate
6. Add to precommit if critical

## Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [API Extractor](https://api-extractor.com/)
- [Madge](https://github.com/pahen/madge)
- [ts-prune](https://github.com/nadeesha/ts-prune)
- [Vitest Coverage](https://vitest.dev/guide/coverage.html)
