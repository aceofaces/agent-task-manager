#!/usr/bin/env node
/**
 * Interactive setup wizard for Agent Task Manager
 * Usage: pnpm run setup
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { discoverLinear } from './discover-linear.js';
import { createProjectDatabases, createGlobalDatabases } from './create-notion-dbs.js';
import { generateEnvContent } from './generate-env.js';
import { generateMCPConfig, writeMCPConfig } from './generate-mcp-config.js';
import { runValidations } from './validate-setup.js';
import { testConnection } from './test-connection.js';
import type { SetupConfig, LinearProject, LinearTeam, NotionDatabase } from './shared-types.js';
import { validateLinearApiKey, validateNotionToken } from './utils.js';

interface WizardState {
  linearApiKey?: string;
  linearTeamId?: string;
  linearTeamName?: string;
  storageBackend: 'basic-memory' | 'notion';
  // Basic-memory fields
  basicMemoryRootPath?: string;
  basicMemoryGlobalPath?: string;
  // Notion fields
  notionApiKey?: string;
  notionParentPageId?: string;
  selectedProjects: LinearProject[];
  createGlobal: boolean;
  projectDatabases: Record<string, { lessons: NotionDatabase; decisions: NotionDatabase }>;
  globalDatabases?: { lessons: NotionDatabase; decisions: NotionDatabase };
  uncertaintyMode?: 'off' | 'warn' | 'block';
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Display welcome banner
 */
function displayWelcome() {
  console.clear();
  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║                                                            ║'));
  console.log(chalk.bold.cyan('║        Agent Task Manager - Setup Wizard                   ║'));
  console.log(chalk.bold.cyan('║                                                            ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝\n'));

  console.log(chalk.white('This wizard will help you set up the Agent Task Manager MCP server.\n'));
  console.log(chalk.white('Quick Start (recommended):'));
  console.log(chalk.gray('  ✓ Linear API key (from app.linear.app/settings/api)'));
  console.log(chalk.gray('  ✓ Local markdown files for knowledge storage (basic-memory)\n'));
  console.log(chalk.white('Advanced Setup (optional):'));
  console.log(chalk.gray('  • Notion integration for collaborative knowledge base'));
  console.log(chalk.gray('  • Requires Notion token and parent page setup\n'));
}

/**
 * Step 1: Get Linear API key and discover resources
 */
async function stepLinearDiscovery(): Promise<{
  apiKey: string;
  teams: LinearTeam[];
  projects: LinearProject[];
}> {
  console.log(chalk.bold.yellow('\n📋 Step 1: Linear Configuration\n'));

  const { linearApiKey } = await inquirer.prompt<{ linearApiKey: string }>([
    {
      type: 'password',
      name: 'linearApiKey',
      message: 'Enter your Linear API key:',
      validate: (input: string) => {
        const validation = validateLinearApiKey(input);
        return validation.valid ? true : validation.errors[0];
      },
    },
  ]);

  const spinner = ora('Discovering Linear teams and projects...').start();

  try {
    const { teams, projects } = await discoverLinear(linearApiKey);
    spinner.succeed(
      chalk.green(
        `Found ${teams.length} team(s) and ${projects.length} project(s)`
      )
    );
    return { apiKey: linearApiKey, teams, projects };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`Discovery failed: ${message}`));
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Step 2: Select Linear team
 */
async function stepSelectTeam(teams: LinearTeam[]): Promise<LinearTeam> {
  console.log(chalk.bold.yellow('\n📋 Step 2: Select Linear Team\n'));

  if (teams.length === 1) {
    console.log(chalk.gray(`Using team: ${teams[0].name} (${teams[0].key})\n`));
    return teams[0];
  }

  const { teamId } = await inquirer.prompt<{ teamId: string }>([
    {
      type: 'list',
      name: 'teamId',
      message: 'Select your team:',
      choices: teams.map((team) => ({
        name: `${team.name} (${team.key})`,
        value: team.id,
      })),
    },
  ]);

  const selectedTeam = teams.find((team) => team.id === teamId);
  if (!selectedTeam) {
    throw new Error('Selected team not found');
  }

  return selectedTeam;
}

/**
 * Step 3: Select projects to track
 */
async function stepSelectProjects(
  projects: LinearProject[],
  teamId: string,
  storageBackend: 'basic-memory' | 'notion'
): Promise<LinearProject[]> {
  console.log(chalk.bold.yellow('\n📋 Step 3: Select Projects to Track\n'));

  const teamProjects = projects.filter((p) => p.teamId === teamId);

  if (teamProjects.length === 0) {
    console.log(chalk.yellow('No projects found in this team.'));
    console.log(chalk.gray('You can create projects in Linear and run this wizard again.\n'));
    return [];
  }

  // For basic-memory, projects are optional (auto-discovery is available)
  if (storageBackend === 'basic-memory') {
    console.log(chalk.white('Project configuration for basic-memory:\n'));
    console.log(chalk.gray('  • Auto-discovery: Projects are discovered on-demand from Linear'));
    console.log(chalk.gray('  • Pre-configuration: Optionally pre-configure project paths\n'));

    const { mode } = await inquirer.prompt<{ mode: 'auto' | 'manual' }>([
      {
        type: 'list',
        name: 'mode',
        message: 'How would you like to configure projects?',
        choices: [
          { name: 'Auto-discovery (recommended - zero configuration)', value: 'auto' },
          { name: 'Pre-configure projects manually', value: 'manual' },
        ],
        default: 'auto',
      },
    ]);

    if (mode === 'auto') {
      console.log(chalk.green('\n✓ Projects will be auto-discovered on first use'));
      console.log(chalk.gray(`  Available projects: ${teamProjects.map(p => p.name).join(', ')}\n`));
      return [];
    }
  }

  // For Notion or manual basic-memory configuration, select projects
  type ProjectSelectionAnswers = { selectedProjectIds: string[] };

  const { selectedProjectIds } = await inquirer.prompt<ProjectSelectionAnswers>([
    {
      type: 'checkbox',
      name: 'selectedProjectIds',
      message: 'Select projects to track:',
      choices: teamProjects.map((project) => ({
        name: `${project.name} (${project.key})`,
        value: project.id,
        checked: teamProjects.length === 1,
      })),
      validate: (input: unknown) => {
        const values = Array.isArray(input) ? input : [];
        return values.length > 0 ? true : 'Select at least one project';
      },
    },
  ]);
  return teamProjects.filter((p) => selectedProjectIds.includes(p.id));
}

/**
 * Step 4: Choose storage backend
 */
async function stepChooseStorageBackend(): Promise<'basic-memory' | 'notion'> {
  console.log(chalk.bold.yellow('\n📋 Step 4: Choose Knowledge Storage Backend\n'));

  console.log(chalk.white('Select how to store lessons and decisions:\n'));
  console.log(chalk.cyan('  Basic-Memory (recommended for getting started)'));
  console.log(chalk.gray('    • Local markdown files'));
  console.log(chalk.gray('    • Git-friendly and portable'));
  console.log(chalk.gray('    • No external dependencies'));
  console.log(chalk.gray('    • Quick setup (~2 minutes)\n'));
  console.log(chalk.cyan('  Notion (for team collaboration)'));
  console.log(chalk.gray('    • Collaborative knowledge base'));
  console.log(chalk.gray('    • Rich formatting and databases'));
  console.log(chalk.gray('    • Requires Notion account and setup'));
  console.log(chalk.gray('    • Setup time: ~10 minutes\n'));

  const { storageBackend } = await inquirer.prompt<{ storageBackend: 'basic-memory' | 'notion' }>([
    {
      type: 'list',
      name: 'storageBackend',
      message: 'Select storage backend:',
      choices: [
        { name: 'Basic-Memory (local markdown files)', value: 'basic-memory' },
        { name: 'Notion (collaborative databases)', value: 'notion' },
      ],
      default: 'basic-memory',
    },
  ]);

  return storageBackend;
}

/**
 * Step 5a: Configure basic-memory paths
 */
async function stepBasicMemoryPaths(): Promise<{ rootPath: string; globalPath: string }> {
  console.log(chalk.bold.yellow('\n📋 Step 5: Configure Basic-Memory Storage\n'));

  console.log(chalk.white('Specify where to store markdown files for lessons and decisions.\n'));

  const { rootPath } = await inquirer.prompt<{ rootPath: string }>([
    {
      type: 'input',
      name: 'rootPath',
      message: 'Root path for knowledge storage:',
      default: './.memory',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Root path is required';
        }
        return true;
      },
    },
  ]);

  const { globalPath } = await inquirer.prompt<{ globalPath: string }>([
    {
      type: 'input',
      name: 'globalPath',
      message: 'Path for global (cross-project) knowledge:',
      default: `${rootPath}/global`,
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Global path is required';
        }
        return true;
      },
    },
  ]);

  console.log(chalk.green('\n✓ Basic-memory will use local markdown files'));
  console.log(chalk.gray(`  Root: ${rootPath}`));
  console.log(chalk.gray(`  Global: ${globalPath}\n`));

  return { rootPath: rootPath.trim(), globalPath: globalPath.trim() };
}

/**
 * Step 5b: Get Notion integration token
 */
async function stepNotionToken(): Promise<string> {
  console.log(chalk.bold.yellow('\n📋 Step 5: Notion Configuration\n'));

  console.log(chalk.white('Create a Notion integration at:'));
  console.log(chalk.cyan('  https://www.notion.so/my-integrations\n'));

  const { notionToken } = await inquirer.prompt<{ notionToken: string }>([
    {
      type: 'password',
      name: 'notionToken',
      message: 'Enter your Notion integration token:',
      validate: (input: string) => {
        const validation = validateNotionToken(input);
        return validation.valid ? true : validation.errors[0];
      },
    },
  ]);

  return notionToken;
}

/**
 * Step 5c: Get Notion parent page ID
 */
async function stepNotionParentPage(): Promise<string> {
  console.log(chalk.bold.yellow('\n📋 Step 6: Notion Parent Page\n'));

  console.log(chalk.white('Instructions:'));
  console.log(chalk.gray('  1. Create a page in Notion (e.g., "Task Manager")'));
  console.log(chalk.gray('  2. Share it with your integration'));
  console.log(chalk.gray('  3. Copy the page URL'));
  console.log(chalk.gray('  4. Extract the ID from the URL:'));
  console.log(chalk.gray('     https://notion.so/My-Page-abc123def456...'));
  console.log(chalk.gray('     The ID is: abc123def456...\n'));

  const { parentPageId } = await inquirer.prompt<{ parentPageId: string }>([
    {
      type: 'input',
      name: 'parentPageId',
      message: 'Enter the parent page ID:',
      validate: (input: string) => {
        if (!input || input.length < 32) {
          return 'Page ID should be at least 32 characters';
        }
        return true;
      },
    },
  ]);

  return parentPageId.replace(/-/g, '');
}

/**
 * Step 5d: Ask about global databases (Notion only)
 */
async function stepGlobalDatabases(): Promise<boolean> {
  console.log(chalk.bold.yellow('\n📋 Step 7: Global Databases\n'));

  console.log(chalk.white('Global databases store cross-project knowledge.'));
  console.log(chalk.gray('  - Useful for lessons that apply to multiple projects'));
  console.log(chalk.gray('  - Optional: You can add them later\n'));

  const { createGlobal } = await inquirer.prompt<{ createGlobal: boolean }>([
    {
      type: 'confirm',
      name: 'createGlobal',
      message: 'Create global databases?',
      default: false,
    },
  ]);

  return createGlobal;
}

/**
 * Step 5e: Create Notion databases
 */
async function stepCreateDatabases(
  notionToken: string,
  parentPageId: string,
  selectedProjects: LinearProject[],
  createGlobal: boolean
): Promise<{
  projectDatabases: Record<string, { lessons: NotionDatabase; decisions: NotionDatabase }>;
  globalDatabases?: { lessons: NotionDatabase; decisions: NotionDatabase };
}> {
  console.log(chalk.bold.yellow('\n📋 Step 7: Create Notion Databases\n'));

  const projectDatabases: Record<
    string,
    { lessons: NotionDatabase; decisions: NotionDatabase }
  > = {};

  // Create project databases
  for (const project of selectedProjects) {
    const spinner = ora(`Creating databases for ${project.name}...`).start();

    try {
      const { lessonsDb, decisionsDb } = await createProjectDatabases(
        notionToken,
        project.name,
        {
          parentPageId,
          checkDuplicates: true,
        }
      );

      projectDatabases[project.name] = {
        lessons: lessonsDb,
        decisions: decisionsDb,
      };

      spinner.succeed(chalk.green(`Created databases for ${project.name}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(chalk.red(`Failed to create databases: ${message}`));
      throw error instanceof Error ? error : new Error(message);
    }
  }

  // Create global databases
  let globalDatabases: { lessons: NotionDatabase; decisions: NotionDatabase } | undefined;

  if (createGlobal) {
    const spinner = ora('Creating global databases...').start();

    try {
      const { lessonsDb, decisionsDb } = await createGlobalDatabases(
        notionToken,
        selectedProjects.map((p) => p.name),
        {
          parentPageId,
          checkDuplicates: true,
        }
      );

      globalDatabases = {
        lessons: lessonsDb,
        decisions: decisionsDb,
      };

      spinner.succeed(chalk.green('Created global databases'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(chalk.red(`Failed to create global databases: ${message}`));
      throw error instanceof Error ? error : new Error(message);
    }
  }

  return { projectDatabases, globalDatabases };
}

/**
 * Step 6: Configure uncertainty mode
 */
async function stepUncertaintyMode(): Promise<'off' | 'warn' | 'block'> {
  console.log(chalk.bold.yellow('\n📋 Step 6: Uncertainty Resolution Mode\n'));

  console.log(chalk.white('How should the system handle unresolved uncertainties?'));
  console.log(chalk.gray('  off   - Allow decomposition with unresolved uncertainties'));
  console.log(chalk.gray('  warn  - Allow but log warning (recommended)'));
  console.log(chalk.gray('  block - Prevent decomposition until resolved\n'));

  const { uncertaintyMode } = await inquirer.prompt<{ uncertaintyMode: 'off' | 'warn' | 'block' }>([
    {
      type: 'list',
      name: 'uncertaintyMode',
      message: 'Select uncertainty resolution mode:',
      choices: [
        { name: 'Warn (recommended)', value: 'warn' },
        { name: 'Block (strict)', value: 'block' },
        { name: 'Off (permissive)', value: 'off' },
      ],
      default: 'warn',
    },
  ]);

  return uncertaintyMode;
}

/**
 * Step 7: Generate .env file
 */
function stepGenerateEnv(state: WizardState): string {
  console.log(chalk.bold.yellow('\n📋 Step 7: Generate Configuration\n'));

  const spinner = ora('Generating .env file...').start();

  try {
    if (!state.linearApiKey || !state.linearTeamId) {
      throw new Error('Missing required configuration details');
    }

    if (state.storageBackend === 'basic-memory') {
      // Basic-memory configuration
      if (!state.basicMemoryRootPath || !state.basicMemoryGlobalPath) {
        throw new Error('Missing basic-memory configuration');
      }

      const config: SetupConfig = {
        linear: {
          apiKey: state.linearApiKey,
          teamId: state.linearTeamId,
          teamName: state.linearTeamName,
        },
        storageBackend: 'basic-memory',
        basicMemory: {
          rootPath: state.basicMemoryRootPath,
          globalPath: state.basicMemoryGlobalPath,
        },
        projects: state.selectedProjects.map((project) => ({
          name: project.name,
          linearProjectId: project.id,
          path: `${state.basicMemoryRootPath}/projects/${project.name}`,
        })),
        uncertaintyMode: state.uncertaintyMode,
      };

      const envContent = generateEnvContent(config);
      const envPath = path.resolve('.env');

      // Check if .env exists
      if (fs.existsSync(envPath)) {
        const backupPath = `.env.backup.${Date.now()}`;
        fs.copyFileSync(envPath, backupPath);
        spinner.info(chalk.yellow(`Created backup: ${backupPath}`));
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');
      spinner.succeed(chalk.green('Generated .env file'));

      return envPath;
    } else {
      // Notion configuration
      if (!state.notionApiKey) {
        throw new Error('Missing Notion API key');
      }

      const config: SetupConfig = {
        linear: {
          apiKey: state.linearApiKey,
          teamId: state.linearTeamId,
          teamName: state.linearTeamName,
        },
        storageBackend: 'notion',
        notion: {
          apiKey: state.notionApiKey,
          globalLessonsDbId: state.globalDatabases?.lessons.id,
          globalLessonsDataSourceId: state.globalDatabases?.lessons.dataSourceId,
          globalDecisionsDbId: state.globalDatabases?.decisions.id,
          globalDecisionsDataSourceId: state.globalDatabases?.decisions.dataSourceId,
        },
        projects: state.selectedProjects.map((project) => ({
          name: project.name,
          linearProjectId: project.id,
          notionLessonsDbId: state.projectDatabases[project.name].lessons.id,
          notionLessonsDataSourceId: state.projectDatabases[project.name].lessons.dataSourceId,
          notionDecisionsDbId: state.projectDatabases[project.name].decisions.id,
          notionDecisionsDataSourceId: state.projectDatabases[project.name].decisions.dataSourceId,
        })),
        uncertaintyMode: state.uncertaintyMode,
      };

      const envContent = generateEnvContent(config);
      const envPath = path.resolve('.env');

      // Check if .env exists
      if (fs.existsSync(envPath)) {
        const backupPath = `.env.backup.${Date.now()}`;
        fs.copyFileSync(envPath, backupPath);
        spinner.info(chalk.yellow(`Created backup: ${backupPath}`));
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');
      spinner.succeed(chalk.green('Generated .env file'));

      return envPath;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`Failed to generate .env: ${message}`));
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Step 8: Run validation
 */
async function stepValidate(envPath: string): Promise<boolean> {
  console.log(chalk.bold.yellow('\n📋 Step 8: Validate Configuration\n'));

  const spinner = ora('Validating setup...').start();

  try {
    const results = await runValidations(envPath);
    const resultKeys = Object.keys(results) as Array<keyof typeof results>;

    const allValid = resultKeys.every((key) => {
      const outcome = results[key];
      return outcome.valid || outcome.errors.length === 0;
    });

    if (allValid) {
      spinner.succeed(chalk.green('Validation passed!'));
    } else {
      spinner.fail(chalk.red('Validation failed'));

      // Show errors
      for (const key of resultKeys) {
        const result = results[key];
        if (result.errors.length > 0) {
          console.log(chalk.red(`\n${String(key)} errors:`));
          for (const err of result.errors) {
            console.log(chalk.red(`  - ${err}`));
          }
        }
      }
    }

    return allValid;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`Validation failed: ${message}`));
    return false;
  }
}

/**
 * Step 9: Generate MCP config
 */
function stepGenerateMCPConfig(envPath: string): string {
  console.log(chalk.bold.yellow('\n📋 Step 9: Generate MCP Configuration\n'));

  const spinner = ora('Generating mcp.json...').start();

  try {
    const envResult = dotenv.config({ path: envPath });
    if (envResult.error) {
      throw envResult.error;
    }

    const env = envResult.parsed ?? {};

    // Get dist path
    const distPath = path.resolve(moduleDir, '../../dist/index.js');

    // Generate config
    const config = generateMCPConfig(env, distPath);

    // Write config
    const mcpPath = path.resolve('mcp.json');
    writeMCPConfig(config, mcpPath, { force: true, backup: true });

    spinner.succeed(chalk.green('Generated mcp.json'));

    return mcpPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`Failed to generate MCP config: ${message}`));
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Step 10: Run connection test
 */
async function stepConnectionTest(envPath: string, projectName: string): Promise<void> {
  console.log(chalk.bold.yellow('\n📋 Step 10: Test Connection\n'));

  const { runTest } = await inquirer.prompt<{ runTest: boolean }>([
    {
      type: 'confirm',
      name: 'runTest',
      message: 'Run end-to-end connection test?',
      default: true,
    },
  ]);

  if (!runTest) {
    console.log(chalk.gray('Skipping connection test.\n'));
    return;
  }

  const spinner = ora('Running connection test...').start();

  try {
    // Build first to ensure dist is up to date
    spinner.text = 'Building project...';
    const { execSync } = await import('child_process');
    execSync('pnpm run build', { stdio: 'ignore' });

    spinner.text = 'Testing connection...';
    await testConnection(envPath, projectName);

    spinner.succeed(chalk.green('Connection test passed!'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`Connection test failed: ${message}`));
    console.log(chalk.yellow('\nYou can run the test later with:'));
    console.log(chalk.cyan('  pnpm run setup:test\n'));
  }
}

/**
 * Display final summary
 */
function displaySummary(state: WizardState, envPath: string, mcpPath: string) {
  console.log(chalk.bold.green('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.green('║                                                            ║'));
  console.log(chalk.bold.green('║              Setup Complete! 🎉                            ║'));
  console.log(chalk.bold.green('║                                                            ║'));
  console.log(chalk.bold.green('╚════════════════════════════════════════════════════════════╝\n'));

  console.log(chalk.white.bold('Configuration Summary:\n'));
  console.log(chalk.gray(`  Linear Team: ${state.linearTeamName}`));

  if (state.selectedProjects.length > 0) {
    console.log(chalk.gray(`  Projects: ${state.selectedProjects.map((p) => p.name).join(', ')}`));
  } else {
    console.log(chalk.gray(`  Projects: Auto-discovery enabled (all Linear projects)`));
  }

  console.log(chalk.gray(`  Storage Backend: ${state.storageBackend}`));

  if (state.storageBackend === 'basic-memory') {
    console.log(chalk.gray(`  Root Path: ${state.basicMemoryRootPath}`));
    console.log(chalk.gray(`  Global Path: ${state.basicMemoryGlobalPath}`));
    if (state.selectedProjects.length === 0) {
      console.log(chalk.gray(`  Project Discovery: Automatic (on first use)`));
    }
  } else {
    console.log(chalk.gray(`  Global Databases: ${state.createGlobal ? 'Yes' : 'No'}`));
  }

  console.log(chalk.gray(`  Uncertainty Mode: ${state.uncertaintyMode || 'warn'}`));

  console.log(chalk.white.bold('\n\nGenerated Files:\n'));
  console.log(chalk.gray(`  .env file: ${envPath}`));
  console.log(chalk.gray(`  MCP config: ${mcpPath}`));

  if (state.storageBackend === 'notion' && Object.keys(state.projectDatabases).length > 0) {
    console.log(chalk.white.bold('\n\nNotion Databases:\n'));
    state.selectedProjects.forEach((project) => {
      const dbs = state.projectDatabases[project.name];
      if (dbs) {
        console.log(chalk.cyan(`  ${project.name}:`));
        console.log(chalk.gray(`    Lessons: ${dbs.lessons.url}`));
        console.log(chalk.gray(`    Decisions: ${dbs.decisions.url}`));
      }
    });

    if (state.globalDatabases) {
      console.log(chalk.cyan('  Global:'));
      console.log(chalk.gray(`    Lessons: ${state.globalDatabases.lessons.url}`));
      console.log(chalk.gray(`    Decisions: ${state.globalDatabases.decisions.url}`));
    }
  } else if (state.storageBackend === 'basic-memory') {
    console.log(chalk.white.bold('\n\nKnowledge Storage:\n'));
    console.log(chalk.gray(`  Local markdown files will be created in:`));
    console.log(chalk.cyan(`    ${state.basicMemoryRootPath}/`));
    if (state.selectedProjects.length > 0) {
      state.selectedProjects.forEach((project) => {
        console.log(chalk.gray(`      projects/${project.name}/`));
      });
    } else {
      console.log(chalk.gray(`      projects/{project-name}/ (created on first use)`));
    }
    console.log(chalk.gray(`      global/`));
  }

  console.log(chalk.white.bold('\n\nNext Steps:\n'));
  console.log(chalk.white('1. The generated mcp.json is ready for Claude Code'));
  console.log(chalk.gray('   - Add it to your project root as .mcp.json'));
  console.log(chalk.gray('   - Or merge it into an existing .mcp.json file\n'));
  console.log(chalk.white('2. Claude Code will auto-discover the MCP server via stdio transport\n'));
  console.log(chalk.white('3. Start using the agent-task-manager tools!\n'));
  console.log(chalk.gray('   Note: Also compatible with Claude Desktop if needed:'));
  console.log(chalk.gray('   - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json'));
  console.log(chalk.gray('   - Windows: %APPDATA%\\Claude\\claude_desktop_config.json'));
  console.log(chalk.gray('   - Linux: ~/.config/Claude/claude_desktop_config.json\n'));

  console.log(chalk.white.bold('Available Commands:\n'));
  console.log(chalk.cyan('  pnpm run setup:validate') + chalk.gray('     - Validate configuration'));
  console.log(chalk.cyan('  pnpm run setup:test') + chalk.gray('         - Test connection'));
  if (state.storageBackend === 'notion') {
    console.log(chalk.cyan('  pnpm run setup:update-schema') + chalk.gray(' - Update database schemas'));
  }
  console.log(chalk.cyan('  pnpm run build') + chalk.gray('              - Build the project'));
  console.log(chalk.cyan('  pnpm start') + chalk.gray('                - Start MCP server\n'));

  console.log(chalk.white('Documentation: ') + chalk.cyan('README.md, SETUP_GUIDE.md\n'));
}

/**
 * Main wizard flow
 */
async function runWizard() {
  const state: WizardState = {
    selectedProjects: [],
    createGlobal: false,
    projectDatabases: {},
    storageBackend: 'basic-memory', // Default
  };

  try {
    // Welcome
    displayWelcome();

    // Step 1: Linear discovery
    const { apiKey, teams, projects } = await stepLinearDiscovery();
    state.linearApiKey = apiKey;

    // Step 2: Select team
    const team = await stepSelectTeam(teams);
    state.linearTeamId = team.id;
    state.linearTeamName = team.name;

    // Step 3: Choose storage backend (moved before project selection)
    state.storageBackend = await stepChooseStorageBackend();

    // Step 4: Select projects (now aware of storage backend)
    const selectedProjects = await stepSelectProjects(projects, team.id, state.storageBackend);
    state.selectedProjects = selectedProjects;

    // For Notion, we require at least one project (need to create databases)
    if (state.storageBackend === 'notion' && selectedProjects.length === 0) {
      console.log(chalk.yellow('\nNotion requires at least one project. Exiting setup.\n'));
      process.exit(0);
    }

    // Conditional flow based on storage backend
    if (state.storageBackend === 'basic-memory') {
      // Step 5a: Configure basic-memory paths
      const { rootPath, globalPath } = await stepBasicMemoryPaths();
      state.basicMemoryRootPath = rootPath;
      state.basicMemoryGlobalPath = globalPath;
    } else {
      // Step 5b: Notion token
      state.notionApiKey = await stepNotionToken();

      // Step 5c: Notion parent page
      state.notionParentPageId = await stepNotionParentPage();

      // Step 5d: Global databases
      state.createGlobal = await stepGlobalDatabases();

      // Step 5e: Create databases
      if (!state.notionApiKey || !state.notionParentPageId) {
        throw new Error('Notion configuration is incomplete');
      }

      const { projectDatabases, globalDatabases } = await stepCreateDatabases(
        state.notionApiKey,
        state.notionParentPageId,
        selectedProjects,
        state.createGlobal
      );
      state.projectDatabases = projectDatabases;
      state.globalDatabases = globalDatabases;
    }

    // Step 6: Uncertainty mode
    state.uncertaintyMode = await stepUncertaintyMode();

    // Step 7: Generate .env
    const envPath = stepGenerateEnv(state);

    // Step 8: Validate
    const valid = await stepValidate(envPath);

    if (!valid) {
      console.log(chalk.red('\n❌ Setup validation failed. Please fix errors and run again.\n'));
      process.exit(1);
    }

    // Step 9: Generate MCP config
    const mcpPath = stepGenerateMCPConfig(envPath);

    // Step 10: Connection test
    await stepConnectionTest(envPath, selectedProjects[0].name);

    // Summary
    displaySummary(state, envPath, mcpPath);

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n\n❌ Setup failed: ${message}\n`));
    console.log(chalk.yellow('You can run the wizard again with: pnpm run setup\n'));
    process.exit(1);
  }
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  runWizard().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Fatal error: ${message}`));
    process.exit(1);
  });
}

export { runWizard };
