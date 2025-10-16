#!/usr/bin/env node
/**
 * Migrate/update existing Notion database schemas
 * Usage: pnpm run setup:update-schema [--env=.env] [--dry-run]
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { Client } from '@notionhq/client';
import { LESSONS_SCHEMA, DECISIONS_SCHEMA } from './shared-types.js';
import type { NotionSchemaDefinition, NotionPropertySchema } from './shared-types.js';
import type { ProjectMapping, NotionProjectMapping } from '../types.js';
import {
  log,
  validateNotionToken,
  printValidationResults,
  parseProjectMappings,
  retry,
  sleep,
} from './utils.js';

// Type guard to check if project mapping is for Notion
const isNotionMapping = (mapping: ProjectMapping): mapping is NotionProjectMapping => {
  return 'notionLessonsDbId' in mapping;
};

interface SchemaChanges {
  databaseId: string;
  databaseName: string;
  changes: {
    addedProperties: string[];
    addedSelectOptions: Array<{ property: string; options: string[] }>;
  };
}

/**
 * Get current database schema
 */
type DatabaseProperties = Record<string, unknown>;

const isPlainTextEntry = (value: unknown): value is { plain_text: string } =>
  !!value &&
  typeof value === 'object' &&
  'plain_text' in value &&
  typeof (value as { plain_text: unknown }).plain_text === 'string';

async function getCurrentSchema(
  client: Client,
  databaseId: string
): Promise<{ properties: DatabaseProperties; title: string }> {
  log.debug(`Fetching schema for database: ${databaseId}`);

  try {
    const database = await retry(async () =>
      client.databases.retrieve({ database_id: databaseId })
    );

    const dbRecord = database as Record<string, unknown>;
    const titleRaw: unknown = dbRecord.title;
    const titleArray = Array.isArray(titleRaw) ? (titleRaw as unknown[]) : [];
    const titleRich = titleArray.find(isPlainTextEntry);
    const title = titleRich?.plain_text ?? 'Unknown';

    const propertiesValue =
      dbRecord.properties && typeof dbRecord.properties === 'object'
        ? (dbRecord.properties as Record<string, unknown>)
        : {};

    return { properties: propertiesValue, title };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch database schema: ${message}`);
  }
}

/**
 * Compare schemas and detect missing properties
 */
function compareSchemas(
  currentProperties: DatabaseProperties,
  expectedSchema: NotionSchemaDefinition
): {
  missingProperties: Array<{ name: string; config: NotionPropertySchema }>;
  missingOptions: Array<{ property: string; options: string[] }>;
} {
  const missingProperties: Array<{ name: string; config: NotionPropertySchema }> = [];
  const missingOptions: Array<{ property: string; options: string[] }> = [];

  for (const [name, config] of Object.entries(expectedSchema)) {
    const property = currentProperties[name];

    if (!property || typeof property !== 'object') {
      missingProperties.push({ name, config });
      continue;
    }

    if (config.type === 'select' && config.options) {
      const propertyRecord = property as Record<string, unknown>;
      const propertyType = propertyRecord.type;

      if (propertyType !== 'select') {
        // Property exists but has different type; treat as missing for alignment
        missingProperties.push({ name, config });
        continue;
      }

      const selectConfig = propertyRecord.select;
      if (!selectConfig || typeof selectConfig !== 'object') {
        missingProperties.push({ name, config });
        continue;
      }

      const optionsValue = (selectConfig as Record<string, unknown>).options;
      const optionNames = Array.isArray(optionsValue)
        ? optionsValue
            .map((option) => {
              if (!option || typeof option !== 'object') {
                return null;
              }
              const optionRecord = option as Record<string, unknown>;
              return typeof optionRecord.name === 'string' ? optionRecord.name : null;
            })
            .filter((nameValue): nameValue is string => nameValue !== null)
        : [];

      const missing = config.options.filter((option) => !optionNames.includes(option));
      if (missing.length > 0) {
        missingOptions.push({ property: name, options: missing });
      }
    }
  }

  return { missingProperties, missingOptions };
}

/**
 * Build update properties for Notion API
 */
const buildPropertyDefinition = (config: NotionPropertySchema): Record<string, unknown> => {
  switch (config.type) {
    case 'title':
      return { title: {} };
    case 'rich_text':
      return { rich_text: {} };
    case 'multi_select':
      return { multi_select: { options: [] } };
    case 'select':
      return {
        select: {
          options: (config.options ?? []).map((option) => ({ name: option })),
        },
      };
    default:
      return {};
  }
};

function buildUpdateProperties(
  missingProperties: Array<{ name: string; config: NotionPropertySchema }>,
  missingOptions: Array<{ property: string; options: string[] }>,
  currentProperties: DatabaseProperties
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  for (const { name, config } of missingProperties) {
    updates[name] = buildPropertyDefinition(config);
  }

  for (const { property, options } of missingOptions) {
    const existing = currentProperties[property];
    let existingOptionObjects: Array<{ name: string }> = [];

    if (existing && typeof existing === 'object') {
      const existingRecord = existing as Record<string, unknown>;
      const selectSection = existingRecord.select;

      if (selectSection && typeof selectSection === 'object') {
        const rawOptions = (selectSection as Record<string, unknown>).options;
        if (Array.isArray(rawOptions)) {
          existingOptionObjects = rawOptions
            .map((option) => {
              if (!option || typeof option !== 'object') {
                return null;
              }
              const optionRecord = option as Record<string, unknown>;
              return typeof optionRecord.name === 'string' ? { name: optionRecord.name } : null;
            })
            .filter((entry): entry is { name: string } => entry !== null);
        }
      }
    }

    const mergedOptions = [
      ...existingOptionObjects,
      ...options.map((option) => ({ name: option })),
    ];

    updates[property] = {
      select: {
        options: mergedOptions,
      },
    };
  }

  return updates;
}

/**
 * Update database schema
 */
async function updateDatabaseSchema(
  client: Client,
  databaseId: string,
  updates: Record<string, unknown>,
  dryRun: boolean = false
): Promise<boolean> {
  if (Object.keys(updates).length === 0) {
    log.info('No updates needed');
    return true;
  }

  if (dryRun) {
    log.info('[DRY RUN] Would update database with:');
    console.log(JSON.stringify(updates, null, 2));
    return true;
  }

  try {
    log.info('Updating database schema...');
    const payload = {
      database_id: databaseId,
      properties: updates,
    } as const;

    await retry(async () =>
      client.databases.update(
        payload as Parameters<typeof client.databases.update>[0]
      )
    );

    await sleep(500); // Rate limiting

    log.success('Database schema updated successfully');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to update schema: ${message}`);
    return false;
  }
}

/**
 * Update schema for a single database
 */
async function updateSchema(
  client: Client,
  databaseId: string,
  expectedSchema: NotionSchemaDefinition,
  dryRun: boolean = false
): Promise<SchemaChanges> {
  // Get current schema
  const { properties: currentProperties, title } = await getCurrentSchema(
    client,
    databaseId
  );

  log.info(`Checking schema for: ${title}`);

  // Compare schemas
  const { missingProperties, missingOptions } = compareSchemas(
    currentProperties,
    expectedSchema
  );

  // Report findings
  if (missingProperties.length === 0 && missingOptions.length === 0) {
    log.success('Schema is up to date!');
    return {
      databaseId,
      databaseName: title,
      changes: {
        addedProperties: [],
        addedSelectOptions: [],
      },
    };
  }

  log.warn('Schema differences detected:');

  if (missingProperties.length > 0) {
    log.info(`Missing properties (${missingProperties.length}):`);
    missingProperties.forEach(({ name, config }) => {
      console.log(`  - ${name} (${config.type})`);
    });
  }

  if (missingOptions.length > 0) {
    log.info(`Missing select options (${missingOptions.length} properties):`);
    missingOptions.forEach(({ property, options }) => {
      console.log(`  - ${property}: ${options.join(', ')}`);
    });
  }

  // Build updates
  const updates = buildUpdateProperties(
    missingProperties,
    missingOptions,
    currentProperties
  );

  // Apply updates
  const success = await updateDatabaseSchema(client, databaseId, updates, dryRun);

  if (!success) {
    throw new Error('Schema update failed');
  }

  return {
    databaseId,
    databaseName: title,
    changes: {
      addedProperties: missingProperties.map(({ name }) => name),
      addedSelectOptions: missingOptions,
    },
  };
}

/**
 * Main function - update all databases from .env
 */
async function main() {
  const args = process.argv.slice(2);
  const envPath = args.find((arg) => arg.startsWith('--env='))?.split('=')[1] || '.env';
  const dryRun = args.includes('--dry-run');

  log.step('Notion Database Schema Migration');

  if (dryRun) {
    log.warn('DRY RUN MODE - No changes will be made');
  }

  // Load .env
  log.info(`Loading environment from: ${envPath}`);

  if (!fs.existsSync(envPath)) {
    log.error(`.env file not found at ${envPath}`);
    process.exit(1);
  }

  const result = dotenv.config({ path: envPath });

  if (result.error) {
    log.error(`Failed to parse .env: ${result.error.message}`);
    process.exit(1);
  }

  const env = result.parsed || {};

  // Validate Notion token
  if (!env.NOTION_API_KEY) {
    log.error('NOTION_API_KEY not found in .env');
    process.exit(1);
  }

  const tokenValidation = validateNotionToken(env.NOTION_API_KEY);
  if (!printValidationResults(tokenValidation, 'Notion token')) {
    process.exit(1);
  }

  const client = new Client({ auth: env.NOTION_API_KEY });

  // Track all changes
  const allChanges: SchemaChanges[] = [];
  let errorCount = 0;

  // Update project databases
  if (env.PROJECT_MAPPINGS) {
    log.step('Updating project databases...');

    const mappings = parseProjectMappings(env.PROJECT_MAPPINGS);

    if (!mappings) {
      log.error('PROJECT_MAPPINGS is not valid JSON');
      process.exit(1);
    }

    for (const projectName of Object.keys(mappings)) {
      const config: ProjectMapping = mappings[projectName];
      log.info(`\nProject: ${projectName}`);

      // Skip basic-memory projects
      if (!isNotionMapping(config)) {
        log.info('  Skipping (basic-memory project)');
        continue;
      }

      // Update Lessons database
      if (config.notionLessonsDbId) {
        try {
          log.info('Updating Lessons database...');
          const changes = await updateSchema(
            client,
            config.notionLessonsDbId,
            LESSONS_SCHEMA,
            dryRun
          );
          allChanges.push(changes);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Failed to update Lessons database: ${message}`);
          errorCount++;
        }
      }

      // Update Decisions database
      if (config.notionDecisionsDbId) {
        try {
          log.info('\nUpdating Decisions database...');
          const changes = await updateSchema(
            client,
            config.notionDecisionsDbId,
            DECISIONS_SCHEMA,
            dryRun
          );
          allChanges.push(changes);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Failed to update Decisions database: ${message}`);
          errorCount++;
        }
      }
    }
  }

  // Update global databases
  if (env.NOTION_GLOBAL_LESSONS_DB_ID || env.NOTION_GLOBAL_DECISIONS_DB_ID) {
    log.step('\nUpdating global databases...');

    if (env.NOTION_GLOBAL_LESSONS_DB_ID) {
      try {
        log.info('Updating Global Lessons database...');
        const changes = await updateSchema(
          client,
          env.NOTION_GLOBAL_LESSONS_DB_ID,
          LESSONS_SCHEMA,
          dryRun
        );
        allChanges.push(changes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Failed to update Global Lessons database: ${message}`);
        errorCount++;
      }
    }

    if (env.NOTION_GLOBAL_DECISIONS_DB_ID) {
      try {
        log.info('\nUpdating Global Decisions database...');
        const changes = await updateSchema(
          client,
          env.NOTION_GLOBAL_DECISIONS_DB_ID,
          DECISIONS_SCHEMA,
          dryRun
        );
        allChanges.push(changes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Failed to update Global Decisions database: ${message}`);
        errorCount++;
      }
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  log.step('Migration Summary');

  const totalChanges = allChanges.filter(
    (change) =>
      change.changes.addedProperties.length > 0 ||
      change.changes.addedSelectOptions.length > 0
  ).length;

  console.log(`\nDatabases checked: ${allChanges.length}`);
  console.log(`Databases updated: ${totalChanges}`);
  console.log(`Errors: ${errorCount}`);

  if (totalChanges > 0) {
    console.log('\nChanges made:');
    allChanges.forEach((change) => {
      const hasChanges =
        change.changes.addedProperties.length > 0 ||
        change.changes.addedSelectOptions.length > 0;

      if (hasChanges) {
        console.log(`\n  ${change.databaseName}:`);
        if (change.changes.addedProperties.length > 0) {
          console.log(
            `    Added properties: ${change.changes.addedProperties.join(', ')}`
          );
        }
        if (change.changes.addedSelectOptions.length > 0) {
          change.changes.addedSelectOptions.forEach(({ property, options }) => {
            console.log(`    Added options to ${property}: ${options.join(', ')}`);
          });
        }
      }
    });
  }

  console.log('\n' + '='.repeat(60));

  if (errorCount === 0) {
    if (dryRun) {
      log.success(
        '✨ Dry run completed successfully! Run without --dry-run to apply changes.'
      );
    } else {
      log.success('✨ Schema migration completed successfully!');
    }
    process.exit(0);
  } else {
    log.error(`❌ Migration completed with ${errorCount} error(s)`);
    process.exit(1);
  }
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Migration failed: ${message}`);
    process.exit(1);
  });
}

export { updateSchema, compareSchemas };
