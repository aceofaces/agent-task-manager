#!/usr/bin/env node
/**
 * Create Notion databases with proper schema
 * Usage: node scripts/create-notion-dbs.js <NOTION_TOKEN> <PROJECT_NAME> [--parent-page-id=<ID>]
 */

import { Client } from '@notionhq/client';
import type {
  SearchResponse,
  DataSourceObjectResponse,
  DatabaseObjectResponse,
  CreateDatabaseParameters,
  CreateDatabaseResponse,
  GetDatabaseResponse,
} from '@notionhq/client/build/src/api-endpoints.js';
import { NotionDatabase, LESSONS_SCHEMA, DECISIONS_SCHEMA, NotionSchemaDefinition } from './shared-types.js';
import { log, validateNotionToken, printValidationResults, retry, sleep } from './utils.js';

interface CreateDatabaseOptions {
  parentPageId?: string;
  checkDuplicates?: boolean;
  scope?: 'project' | 'global';
}

type SearchResultEntry = SearchResponse['results'][number];
type CreateDatabaseInitialDataSource = NonNullable<CreateDatabaseParameters['initial_data_source']>;
type InitialProperties = NonNullable<CreateDatabaseInitialDataSource['properties']>;
type PropertyConfiguration = InitialProperties[string];

const isDataSourceResult = (result: SearchResultEntry): result is DataSourceObjectResponse =>
  result.object === 'data_source';

const isFullDatabase = (
  database: GetDatabaseResponse | CreateDatabaseResponse
): database is DatabaseObjectResponse => 'data_sources' in database;

const extractTitle = (title: DataSourceObjectResponse['title']): string =>
  title?.[0]?.plain_text ?? '';

const resolveDatabaseId = (result: DataSourceObjectResponse): string => {
  const parent = result.database_parent as Record<string, unknown>;
  const databaseId = parent.database_id;
  if (typeof databaseId === 'string') {
    return databaseId;
  }

  return result.id;
};

function buildPropertyConfiguration(
  name: string,
  config: NotionSchemaDefinition[string],
  projectNames: readonly string[],
  scope: 'project' | 'global'
): PropertyConfiguration | null {
  switch (config.type) {
    case 'title':
      return { type: 'title', title: {} };
    case 'rich_text':
      return { type: 'rich_text', rich_text: {} };
    case 'multi_select':
      return {
        type: 'multi_select',
        multi_select: { options: [] },
      };
    case 'select': {
      if (name === 'Project') {
        if (scope === 'global') {
          return null;
        }
        return {
          type: 'select',
          select: {
            options: projectNames.map((projectName) => ({ name: projectName })),
          },
        };
      }

      return {
        type: 'select',
        select: {
          options: config.options?.map((option) => ({ name: option })) ?? [],
        },
      };
    }
    default:
      return null;
  }
}

function buildInitialProperties(
  schema: NotionSchemaDefinition,
  projectNames: readonly string[],
  scope: 'project' | 'global'
): InitialProperties {
  const properties: InitialProperties = {};

  for (const [name, config] of Object.entries(schema)) {
    const property = buildPropertyConfiguration(
      name,
      config,
      projectNames,
      scope
    );

    if (property) {
      properties[name] = property;
    }
  }

  return properties;
}

/**
 * Search for existing databases by title
 */
async function findExistingDatabase(
  client: Client,
  title: string
): Promise<NotionDatabase | null> {
  log.debug(`Searching for existing database: "${title}"`);

  try {
    const response = await retry<SearchResponse>(async () =>
      client.search({
        query: title,
        filter: { property: 'object', value: 'data_source' },
      })
    );

    const exactMatch = response.results.find(
      (result): result is DataSourceObjectResponse =>
        isDataSourceResult(result) && extractTitle(result.title) === title
    );

    if (exactMatch) {
      const databaseId = resolveDatabaseId(exactMatch);
      const dbDetails = await retry<GetDatabaseResponse>(async () =>
        client.databases.retrieve({ database_id: databaseId })
      );
      const dataSourceId =
        (isFullDatabase(dbDetails) && dbDetails.data_sources[0]?.id) || exactMatch.id;

      return {
        id: databaseId,
        dataSourceId,
        title,
        url: exactMatch.url ?? '',
      };
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.debug(`Search failed: ${message}`);
    return null;
  }
}

/**
 * Create a Notion database
 */
async function createDatabase(
  client: Client,
  title: string,
  schema: NotionSchemaDefinition,
  projectNames: readonly string[],
  options: CreateDatabaseOptions = {}
): Promise<NotionDatabase> {
  const { parentPageId, checkDuplicates = true, scope = 'project' } = options;

  // Check for duplicates
  if (checkDuplicates) {
    const existing = await findExistingDatabase(client, title);
    if (existing) {
      log.warn(`Database "${title}" already exists (ID: ${existing.id})`);
      log.info('Skipping creation. Use existing database or delete it first.');
      return existing;
    }
  }

  log.info(`Creating database: "${title}"`);

  const effectiveParentPageId = parentPageId || process.env.NOTION_PARENT_PAGE_ID;

  if (!effectiveParentPageId) {
    throw new Error(
      'Parent page ID required. Set NOTION_PARENT_PAGE_ID env var or pass --parent-page-id'
    );
  }

  const properties = buildInitialProperties(schema, projectNames, scope);

  // Create database (Notion API 2025-09-03: wrap properties in initial_data_source)
  const createParams: CreateDatabaseParameters = {
    parent: {
      type: 'page_id',
      page_id: effectiveParentPageId,
    },
    title: [{ type: 'text', text: { content: title } }],
    initial_data_source: {
      properties,
    },
  };

  const databaseResponse = await retry<CreateDatabaseResponse>(async () =>
    client.databases.create(createParams)
  );
  const databaseId = databaseResponse.id;

  log.success(`Created database: "${title}" (ID: ${databaseId})`);
  const databaseUrl =
    (isFullDatabase(databaseResponse) && databaseResponse.url) || 'URL not available';
  log.debug(`Database URL: ${databaseUrl}`);

  await sleep(500); // Rate limiting

  // Fetch data source ID (Notion API 2025-09-03)
  log.debug('Fetching data source ID...');
  const dbDetails = await retry<GetDatabaseResponse>(async () =>
    client.databases.retrieve({ database_id: databaseId })
  );

  const dataSourceId =
    (isFullDatabase(dbDetails) && dbDetails.data_sources[0]?.id) || databaseId;

  log.debug(`Data source ID: ${dataSourceId}`);

  return {
    id: databaseId,
    dataSourceId,
    title,
    url: databaseUrl,
  };
}

/**
 * Create databases for a project
 */
export async function createProjectDatabases(
  notionToken: string,
  projectName: string,
  options: CreateDatabaseOptions = {}
): Promise<{
  lessonsDb: NotionDatabase;
  decisionsDb: NotionDatabase;
}> {
  // Validate token
  const validation = validateNotionToken(notionToken);
  if (!printValidationResults(validation, 'Notion token')) {
    throw new Error('Invalid Notion integration token format');
  }

  log.step(`Creating databases for project: ${projectName}`);

  const client = new Client({ auth: notionToken });

  // Create Lessons Learned database
  const lessonsDb = await createDatabase(
    client,
    `Lessons Learned - ${projectName}`,
    LESSONS_SCHEMA,
    [projectName],
    options
  );

  // Create Decisions database
  const decisionsDb = await createDatabase(
    client,
    `Decisions - ${projectName}`,
    DECISIONS_SCHEMA,
    [projectName],
    options
  );

  return { lessonsDb, decisionsDb };
}

/**
 * Create global databases
 */
export async function createGlobalDatabases(
  notionToken: string,
  projectNames: string[],
  options: CreateDatabaseOptions = {}
): Promise<{
  lessonsDb: NotionDatabase;
  decisionsDb: NotionDatabase;
}> {
  // Validate token
  const validation = validateNotionToken(notionToken);
  if (!printValidationResults(validation, 'Notion token')) {
    throw new Error('Invalid Notion integration token format');
  }

  log.step('Creating global databases...');

  const client = new Client({ auth: notionToken });

  // Create Global Lessons Learned database
  const lessonsDb = await createDatabase(
    client,
    'Global Lessons Learned',
    LESSONS_SCHEMA,
    projectNames,
    { ...options, scope: 'global' }
  );

  // Create Global Decisions database
  const decisionsDb = await createDatabase(
    client,
    'Global Decisions',
    DECISIONS_SCHEMA,
    projectNames,
    { ...options, scope: 'global' }
  );

  return { lessonsDb, decisionsDb };
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const notionToken = args[0];
  const projectName = args[1];
  const parentPageId = args.find((arg) => arg.startsWith('--parent-page-id='))?.split('=')[1];
  const isGlobal = args.includes('--global');

  if (!notionToken || (!projectName && !isGlobal)) {
    console.error('Usage:');
    console.error('  Project databases:');
    console.error(
      '    node create-notion-dbs.js <NOTION_TOKEN> <PROJECT_NAME> [--parent-page-id=<ID>]'
    );
    console.error('  Global databases:');
    console.error('    node create-notion-dbs.js <NOTION_TOKEN> --global [--parent-page-id=<ID>]');
    console.error('\nExample:');
    console.error('  node create-notion-dbs.js YOUR_NOTION_TOKEN my-api --parent-page-id=abc123');
    process.exit(1);
  }

  const runSetup = isGlobal
    ? createGlobalDatabases(notionToken, [projectName || 'Default'], { parentPageId })
    : createProjectDatabases(notionToken, projectName, { parentPageId });

  runSetup
    .then(({ lessonsDb, decisionsDb }) => {
      console.log('\n' + '='.repeat(60));
      log.success('Databases created successfully!');
      console.log('\nAdd these IDs to your .env file:');
      if (isGlobal) {
        console.log(`NOTION_GLOBAL_LESSONS_DB_ID=${lessonsDb.id}`);
        console.log(`NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID=${lessonsDb.dataSourceId}`);
        console.log(`NOTION_GLOBAL_DECISIONS_DB_ID=${decisionsDb.id}`);
        console.log(`NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID=${decisionsDb.dataSourceId}`);
      } else {
        console.log(`\nFor project "${projectName}":`);
        console.log(`  notionLessonsDbId: ${lessonsDb.id}`);
        console.log(`  notionLessonsDataSourceId: ${lessonsDb.dataSourceId}`);
        console.log(`  notionDecisionsDbId: ${decisionsDb.id}`);
        console.log(`  notionDecisionsDataSourceId: ${decisionsDb.dataSourceId}`);
      }
      console.log('\nDatabase URLs:');
      console.log(`  Lessons: ${lessonsDb.url}`);
      console.log(`  Decisions: ${decisionsDb.url}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to create databases: ${message}`);
      if (message.includes('parent')) {
        log.info('\nTip: Create a parent page in Notion first, then pass its ID:');
        log.info('  --parent-page-id=<YOUR_PAGE_ID>');
        log.info('\nTo get a page ID: Share the page, copy link, extract ID from URL');
      }
      process.exit(1);
    });
}
