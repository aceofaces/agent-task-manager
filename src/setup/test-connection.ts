#!/usr/bin/env node
/**
 * Test end-to-end connection by creating a test task and lesson
 * Usage: node scripts/test-connection.js [--env=.env] [--project=PROJECT_NAME]
 */

import * as dotenv from 'dotenv';
import { WorkflowOrchestrator } from '../orchestrator/workflow-orchestrator.js';
import type { Config, ProjectsConfig } from '../types.js';
import { log, parseProjectMappings } from './utils.js';

/**
 * Load config from .env
 */
function loadConfig(envPath: string): Config {
  dotenv.config({ path: envPath });

  const linearApiKey = process.env.LINEAR_API_KEY;
  const linearTeamId = process.env.LINEAR_TEAM_ID;
  const notionApiKey = process.env.NOTION_API_KEY;

  if (!linearApiKey || !linearTeamId || !notionApiKey) {
    throw new Error('Missing required environment variables');
  }

  const projectMappings: ProjectsConfig =
    parseProjectMappings(process.env.PROJECT_MAPPINGS || '{}') ?? {};

  return {
    linear: {
      apiKey: linearApiKey,
      teamId: linearTeamId,
    },
    storageBackend: 'notion',
    notion: {
      apiKey: notionApiKey,
      globalLessonsDbId: process.env.NOTION_GLOBAL_LESSONS_DB_ID,
      globalDecisionsDbId: process.env.NOTION_GLOBAL_DECISIONS_DB_ID,
    },
    projects: projectMappings,
  };
}

/**
 * Run end-to-end test
 */
async function testConnection(envPath: string, testProject?: string): Promise<void> {
  log.step('Testing End-to-End Connection');

  // Load config
  log.info('Loading configuration...');
  const config = loadConfig(envPath);

  // Determine project to use
  const projectNames = Object.keys(config.projects);
  const projectName = testProject || projectNames[0];

  if (!projectName) {
    throw new Error(
      'No projects configured. Add PROJECT_MAPPINGS to .env or specify --project=NAME'
    );
  }

  log.info(`Using project: ${projectName}`);

  // Create orchestrator
  const uncertaintyMode =
    (process.env.UNCERTAINTY_RESOLUTION_MODE as 'off' | 'warn' | 'block') || 'warn';
  const orchestrator = new WorkflowOrchestrator(config, { uncertaintyMode });

  // Test 1: Create a test task
  log.step('Test 1: Creating test task...');

  const testTask = await orchestrator.createTask({
    title: '[TEST] Connection Test Task',
    description: 'This is a test task created by the setup validation script.',
    goal: 'Verify that the task manager can create tasks in Linear',
    effort: 2,
    project: projectName,
    labels: ['setup-test'],
  });

  log.success(`Created test task: ${testTask.taskID}`);
  log.info(`  Title: ${testTask.title}`);
  log.info(`  Effort: ${testTask.effort}/10`);
  log.info(`  Status: ${testTask.status}`);

  // Test 2: Update the task
  log.step('Test 2: Updating test task...');

  await orchestrator.updateTask({
    tasks: [
      {
        taskID: testTask.taskID,
        set: {
          status: 'in-progress',
        },
      },
    ],
  });

  log.success('Updated task status to in-progress');

  // Test 3: Add a lesson learned
  log.step('Test 3: Extracting test lesson to Notion...');

  try {
    await orchestrator.extractLesson({
      taskID: testTask.taskID,
      lesson: {
        content: 'Successfully validated the agent-task-manager setup!',
        category: 'solution',
        tags: ['setup', 'validation'],
      },
      scope: 'project',
      relatedConcepts: ['Setup', 'Testing'],
    });

    log.success('Created test lesson in Notion');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No Notion lessons database')) {
      log.warn('Skipping lesson extraction - no Notion database configured for this project');
    } else {
      throw error instanceof Error ? error : new Error(message);
    }
  }

  // Test 4: Mark task as done
  log.step('Test 4: Completing test task...');

  await orchestrator.updateTask({
    tasks: [
      {
        taskID: testTask.taskID,
        set: {
          status: 'done',
        },
      },
    ],
  });

  log.success('Marked task as done');

  // Summary
  console.log('\n' + '='.repeat(60));
  log.success('✨ All connection tests passed!');
  console.log('\nTest results:');
  console.log(`✅ Created task in Linear: ${testTask.taskID}`);
  console.log(`✅ Updated task status`);
  console.log(`✅ Extracted lesson to Notion`);
  console.log(`✅ Completed task`);
  console.log('\nYou can:');
  console.log(`1. View the test task in Linear`);
  console.log(`2. View the test lesson in your Notion ${projectName} database`);
  console.log(`3. Delete the test task if you want: Linear → Search "${testTask.title}"`);
  console.log('\nSetup is fully functional! 🎉');
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const envPath = args.find((arg) => arg.startsWith('--env='))?.split('=')[1] || '.env';
  const projectName = args.find((arg) => arg.startsWith('--project='))?.split('=')[1];

  testConnection(envPath, projectName)
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Connection test failed: ${message}`);
      console.error('\nDebugging steps:');
      console.error('1. Run: pnpm run setup:validate');
      console.error('2. Check your .env file');
      console.error('3. Verify API keys and database IDs');
      process.exit(1);
    });
}

export { testConnection };
