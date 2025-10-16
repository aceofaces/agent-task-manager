#!/usr/bin/env node
/**
 * Validate complete setup - .env, APIs, databases, MCP config
 * Usage: node scripts/validate-setup.js [--env=.env] [--mcp=mcp.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { LinearClient } from '@linear/sdk';
import { Client as NotionClient } from '@notionhq/client';
import type { DatabaseObjectResponse, GetDatabaseResponse } from '@notionhq/client/build/src/api-endpoints.js';
import {
  log,
  validateLinearApiKey,
  validateNotionToken,
  validateNotionDatabaseId,
  validateUUID,
  parseProjectMappings,
  retry,
} from './utils.js';
import type { ProjectMapping, NotionProjectMapping } from '../types.js';

// Type guard to check if project mapping is for Notion
const isNotionMapping = (mapping: ProjectMapping): mapping is NotionProjectMapping => {
  return 'notionLessonsDbId' in mapping;
};

interface ValidationResults {
  env: { valid: boolean; errors: string[]; warnings: string[] };
  linear: { valid: boolean; errors: string[]; warnings: string[] };
  notion: { valid: boolean; errors: string[]; warnings: string[] };
  projects: { valid: boolean; errors: string[]; warnings: string[] };
  mcp: { valid: boolean; errors: string[]; warnings: string[] };
}

/**
 * Validate .env file
 */
function validateEnvFile(envPath: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  env: Record<string, string>;
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.info(`Checking .env file at: ${envPath}`);

  // Check file exists
  if (!fs.existsSync(envPath)) {
    errors.push(`.env file not found at ${envPath}`);
    return { valid: false, errors, warnings, env: {} };
  }

  // Parse .env
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    errors.push(`Failed to parse .env: ${result.error.message}`);
    return { valid: false, errors, warnings, env: {} };
  }

  const env: Record<string, string> = result.parsed ?? {};

  // Validate required fields
  const required = ['LINEAR_API_KEY', 'LINEAR_TEAM_ID', 'NOTION_API_KEY'];
  required.forEach((key) => {
    if (!env[key]) {
      errors.push(`Missing required field: ${key}`);
    }
  });

  // Validate Linear API key format
  if (env.LINEAR_API_KEY) {
    const keyValidation = validateLinearApiKey(env.LINEAR_API_KEY);
    errors.push(...keyValidation.errors);
    warnings.push(...keyValidation.warnings);
  }

  // Validate Notion token format
  if (env.NOTION_API_KEY) {
    const tokenValidation = validateNotionToken(env.NOTION_API_KEY);
    errors.push(...tokenValidation.errors);
    warnings.push(...tokenValidation.warnings);
  }

  // Validate team ID format
  if (env.LINEAR_TEAM_ID) {
    const teamIdValidation = validateUUID(env.LINEAR_TEAM_ID);
    if (!teamIdValidation.valid) {
      errors.push(`LINEAR_TEAM_ID is not a valid UUID: ${env.LINEAR_TEAM_ID}`);
    }
  }

  // Validate PROJECT_MAPPINGS format
  if (env.PROJECT_MAPPINGS) {
    const mappings = parseProjectMappings(env.PROJECT_MAPPINGS);
    if (!mappings) {
      errors.push('PROJECT_MAPPINGS is not valid JSON');
    } else if (Object.keys(mappings).length === 0) {
      warnings.push('PROJECT_MAPPINGS is empty');
    }
  } else {
    warnings.push('PROJECT_MAPPINGS not set - you won\'t be able to use project-scoped features');
  }

  // Validate global database IDs format (if present)
  if (env.NOTION_GLOBAL_LESSONS_DB_ID) {
    const dbValidation = validateNotionDatabaseId(env.NOTION_GLOBAL_LESSONS_DB_ID);
    if (!dbValidation.valid) {
      errors.push('NOTION_GLOBAL_LESSONS_DB_ID has invalid format');
    }
  }

  if (env.NOTION_GLOBAL_DECISIONS_DB_ID) {
    const dbValidation = validateNotionDatabaseId(env.NOTION_GLOBAL_DECISIONS_DB_ID);
    if (!dbValidation.valid) {
      errors.push('NOTION_GLOBAL_DECISIONS_DB_ID has invalid format');
    }
  }

  // Validate global data source IDs format (Notion API 2025-09-03)
  if (env.NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID) {
    const dsValidation = validateNotionDatabaseId(env.NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID);
    if (!dsValidation.valid) {
      errors.push('NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID has invalid format');
    }
  }

  if (env.NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID) {
    const dsValidation = validateNotionDatabaseId(env.NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID);
    if (!dsValidation.valid) {
      errors.push('NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID has invalid format');
    }
  }

  // Validate uncertainty mode (if present)
  if (env.UNCERTAINTY_RESOLUTION_MODE) {
    const validModes = ['off', 'warn', 'block'];
    if (!validModes.includes(env.UNCERTAINTY_RESOLUTION_MODE)) {
      errors.push(`UNCERTAINTY_RESOLUTION_MODE must be one of: ${validModes.join(', ')}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, env };
}

/**
 * Validate Linear API connection
 */
async function validateLinearAPI(apiKey: string, teamId: string): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.info('Testing Linear API connection...');

  try {
    const client = new LinearClient({ apiKey });

    // Test viewer access
    const viewer = await retry(async () => await client.viewer);

    if (!viewer) {
      errors.push('Failed to fetch viewer - check API key');
      return { valid: false, errors, warnings };
    }

    log.debug(`Authenticated as: ${viewer.name} (${viewer.email})`);

    // Test team access
    const team = await retry(async () => await client.team(teamId));

    if (!team) {
      errors.push(`Team ${teamId} not found - check LINEAR_TEAM_ID`);
      return { valid: false, errors, warnings };
    }

    log.debug(`Team: ${team.name} (${team.key})`);

    // Test projects access
    const projects = await retry(async () => await team.projects());

    if (!projects || projects.nodes.length === 0) {
      warnings.push('No projects found in team');
    } else {
      log.debug(`Found ${projects.nodes.length} project(s)`);
    }

    log.success('Linear API connection successful');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Linear API error: ${message}`);
    if (message.includes('401') || message.includes('Authentication')) {
      errors.push('Check your LINEAR_API_KEY');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate Notion API connection
 */
async function validateNotionAPI(token: string): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.info('Testing Notion API connection...');

  try {
    const client = new NotionClient({ auth: token });

    // Test by listing users (minimal permissions needed)
    await retry(async () => await client.users.list({}));

    log.success('Notion API connection successful');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Notion API error: ${message}`);
    if (message.includes('401') || message.includes('unauthorized')) {
      errors.push('Check your NOTION_API_KEY');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate project mappings and database access
 */
type NotionDatabaseResponse = GetDatabaseResponse | DatabaseObjectResponse;

const isDatabaseWithDataSources = (database: NotionDatabaseResponse): database is DatabaseObjectResponse =>
  'data_sources' in database;

const getDataSourceIds = (database: DatabaseObjectResponse): string[] =>
  database.data_sources?.map((source) => source?.id).filter((id): id is string => typeof id === 'string') ?? [];

async function validateProjects(
  linearClient: LinearClient,
  notionClient: NotionClient,
  mappingsJson: string
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.info('Validating project mappings...');

  const mappings = parseProjectMappings(mappingsJson);

  if (!mappings) {
    errors.push('PROJECT_MAPPINGS is not valid JSON');
    return { valid: false, errors, warnings };
  }

  const projectNames = Object.keys(mappings);

  for (const projectName of projectNames) {
    const config: ProjectMapping = mappings[projectName];
    log.info(`Checking project: ${projectName}`);

    // Validate Linear project
    if (!config.linearProjectId) {
      errors.push(`${projectName}: Missing linearProjectId`);
      continue;
    }

    try {
      const project = await retry(async () => linearClient.project(config.linearProjectId));
      if (!project) {
        errors.push(`${projectName}: Linear project ${config.linearProjectId} not found`);
      } else {
        log.debug(`  ✓ Linear project: ${project.name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${projectName}: Error accessing Linear project: ${message}`);
    }

    // Skip Notion validation for basic-memory projects
    if (!isNotionMapping(config)) {
      log.debug(`  ℹ️ Skipping Notion validation (using basic-memory backend)`);
      continue;
    }

    // Validate Notion Lessons database
    if (!config.notionLessonsDbId) {
      errors.push(`${projectName}: Missing notionLessonsDbId`);
    } else {
      let lessonsDatabase: NotionDatabaseResponse | undefined;
      try {
        lessonsDatabase = await retry(async () =>
          notionClient.databases.retrieve({ database_id: config.notionLessonsDbId })
        );
        log.debug(`  ✓ Notion Lessons database`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${projectName}: Lessons database ${config.notionLessonsDbId} not accessible`);
        if (message.includes('Could not find')) {
          errors.push(`  → Database not found or not shared with integration`);
        }
      }

      if (config.notionLessonsDataSourceId) {
        if (lessonsDatabase && isDatabaseWithDataSources(lessonsDatabase)) {
          const dataSourceIds = getDataSourceIds(lessonsDatabase);
          if (!dataSourceIds.includes(config.notionLessonsDataSourceId)) {
            warnings.push(
              `${projectName}: Lessons data source ${config.notionLessonsDataSourceId} not linked to database ${config.notionLessonsDbId}`
            );
          }
        } else if (!lessonsDatabase) {
          // Already recorded as error above
        } else {
          warnings.push(
            `${projectName}: Lessons database metadata does not include data source information (Notion API change?)`
          );
        }
      }
    }

    // Validate Notion Lessons data source (Notion API 2025-09-03)
    if (!config.notionLessonsDataSourceId) {
      warnings.push(`${projectName}: Missing notionLessonsDataSourceId`);
    }

    // Validate Notion Decisions database
    if (!config.notionDecisionsDbId) {
      errors.push(`${projectName}: Missing notionDecisionsDbId`);
    } else {
      let decisionsDatabase: NotionDatabaseResponse | undefined;
      try {
        decisionsDatabase = await retry(async () =>
          notionClient.databases.retrieve({ database_id: config.notionDecisionsDbId })
        );
        log.debug(`  ✓ Notion Decisions database`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${projectName}: Decisions database ${config.notionDecisionsDbId} not accessible`);
        if (message.includes('Could not find')) {
          errors.push(`  → Database not found or not shared with integration`);
        }
      }

      if (config.notionDecisionsDataSourceId) {
        if (decisionsDatabase && isDatabaseWithDataSources(decisionsDatabase)) {
          const dataSourceIds = getDataSourceIds(decisionsDatabase);
          if (!dataSourceIds.includes(config.notionDecisionsDataSourceId)) {
            warnings.push(
              `${projectName}: Decisions data source ${config.notionDecisionsDataSourceId} not linked to database ${config.notionDecisionsDbId}`
            );
          }
        } else if (!decisionsDatabase) {
          // Error logged above
        } else {
          warnings.push(
            `${projectName}: Decisions database metadata does not include data source information (Notion API change?)`
          );
        }
      }
    }

    // Validate Notion Decisions data source (Notion API 2025-09-03)
    if (!config.notionDecisionsDataSourceId) {
      warnings.push(`${projectName}: Missing notionDecisionsDataSourceId`);
    }
  }

  if (errors.length === 0) {
    log.success(`All ${projectNames.length} project(s) validated`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate MCP config file
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function validateMCPConfig(mcpPath: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.info(`Checking MCP config at: ${mcpPath}`);

  if (!fs.existsSync(mcpPath)) {
    warnings.push(`MCP config not found at ${mcpPath}`);
    warnings.push('Generate it with: pnpm run setup:generate-mcp-config');
    return { valid: true, errors, warnings }; // Not required, just a warning
  }

  try {
    const content = fs.readFileSync(mcpPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isRecord(parsed)) {
      errors.push('MCP config must be a JSON object');
      return { valid: false, errors, warnings };
    }

    const serversRaw = parsed.mcpServers;
    if (!isRecord(serversRaw)) {
      errors.push('MCP config missing mcpServers key');
      return { valid: false, errors, warnings };
    }

    const server = serversRaw['agent-task-manager'];
    if (!isRecord(server)) {
      errors.push('MCP config missing agent-task-manager server');
      return { valid: false, errors, warnings };
    }

    // Check command
    if (typeof server.command !== 'string' || server.command !== 'node') {
      errors.push('MCP server command should be "node"');
    }

    // Check args
    if (!Array.isArray(server.args) || server.args.length === 0) {
      errors.push('MCP server args missing');
    } else {
      const argsStrings = server.args.filter(
        (arg): arg is string => typeof arg === 'string'
      );
      if (argsStrings.length !== server.args.length) {
        errors.push('MCP server args must be strings');
      } else {
        const indexPath = path.resolve(argsStrings[0]);
        if (!fs.existsSync(indexPath)) {
          errors.push(`Index file not found: ${indexPath}`);
          errors.push('Run: pnpm run build');
        }
      }
    }

    // Check env
    if (!isRecord(server.env)) {
      errors.push('MCP server env missing');
    } else {
      const envRecord = server.env;
      const required = ['LINEAR_API_KEY', 'LINEAR_TEAM_ID', 'NOTION_API_KEY'] as const;
      for (const key of required) {
        if (typeof envRecord[key] !== 'string' || envRecord[key] === '') {
          errors.push(`MCP server env missing ${key}`);
        }
      }
    }

    if (errors.length === 0) {
      log.success('MCP config is valid');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse MCP config: ${message}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Run all validations
 */
async function runValidations(envPath: string, mcpPath?: string): Promise<ValidationResults> {
  const results: ValidationResults = {
    env: { valid: false, errors: [], warnings: [] },
    linear: { valid: false, errors: [], warnings: [] },
    notion: { valid: false, errors: [], warnings: [] },
    projects: { valid: false, errors: [], warnings: [] },
    mcp: { valid: false, errors: [], warnings: [] },
  };

  log.step('Step 1: Validate Environment File');
  const envValidation = validateEnvFile(envPath);
  results.env = envValidation;

  if (!envValidation.valid) {
    log.error('Environment validation failed. Fix errors before continuing.');
    return results;
  }

  log.step('Step 2: Validate Linear API');
  const linearApiKey = envValidation.env.LINEAR_API_KEY;
  const linearTeamId = envValidation.env.LINEAR_TEAM_ID;
  if (linearApiKey && linearTeamId) {
    results.linear = await validateLinearAPI(linearApiKey, linearTeamId);
  }

  log.step('Step 3: Validate Notion API');
  const notionApiKey = envValidation.env.NOTION_API_KEY;
  if (notionApiKey) {
    results.notion = await validateNotionAPI(notionApiKey);
  }

  const projectMappingsJson = envValidation.env.PROJECT_MAPPINGS;
  if (results.linear.valid && results.notion.valid && projectMappingsJson) {
    log.step('Step 4: Validate Project Mappings');
    const linearClient = new LinearClient({ apiKey: linearApiKey });
    const notionClient = new NotionClient({ auth: notionApiKey });
    results.projects = await validateProjects(
      linearClient,
      notionClient,
      projectMappingsJson
    );
  }

  if (mcpPath) {
    log.step('Step 5: Validate MCP Config');
    results.mcp = validateMCPConfig(mcpPath);
  }

  return results;
}

/**
 * Print summary
 */
function printSummary(results: ValidationResults): boolean {
  console.log('\n' + '='.repeat(60));
  log.step('Validation Summary');

  const checks = [
    { name: 'Environment File', result: results.env },
    { name: 'Linear API', result: results.linear },
    { name: 'Notion API', result: results.notion },
    { name: 'Project Mappings', result: results.projects },
    { name: 'MCP Configuration', result: results.mcp },
  ];

  checks.forEach(({ name, result }) => {
    if (result.valid) {
      log.success(`${name}: PASSED`);
    } else if (result.errors.length === 0 && result.warnings.length > 0) {
      log.warn(`${name}: WARNINGS`);
    } else if (result.errors.length > 0) {
      log.error(`${name}: FAILED`);
      result.errors.forEach((err) => console.error(`  - ${err}`));
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach((warn) => console.warn(`  ⚠️  ${warn}`));
    }
  });

  const allValid = checks.every((check) => check.result.valid || check.result.errors.length === 0);

  console.log('\n' + '='.repeat(60));
  if (allValid) {
    log.success('✨ All validations passed! Setup is ready to use.');
    console.log('\nNext steps:');
    console.log('1. Run: pnpm run setup:test');
    console.log('2. Add mcp.json to your project as .mcp.json');
    console.log('3. Claude Code will auto-discover the MCP server');
    console.log('\nNote: Also compatible with Claude Desktop if needed');
  } else {
    log.error('❌ Validation failed. Please fix the errors above.');
    console.log('\nCommon fixes:');
    console.log('- Check API keys are correct');
    console.log('- Ensure Notion databases are shared with integration');
    console.log('- Run: pnpm run build (if index.js missing)');
  }

  return allValid;
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const envPath = args.find((arg) => arg.startsWith('--env='))?.split('=')[1] || '.env';
  const mcpPath = args.find((arg) => arg.startsWith('--mcp='))?.split('=')[1];

  runValidations(envPath, mcpPath)
    .then((results) => {
      const success = printSummary(results);
      process.exit(success ? 0 : 1);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Validation failed: ${message}`);
      process.exit(1);
    });
}

export { runValidations, validateEnvFile, validateLinearAPI, validateNotionAPI, validateProjects, validateMCPConfig };
