#!/usr/bin/env node
/**
 * Generate MCP configuration file from .env
 * Usage: node scripts/generate-mcp-config.js [--output=mcp.json]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { log } from './utils.js';

interface MCPConfig {
  mcpServers: {
    [key: string]: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

/**
 * Load environment from .env file
 */
function loadEnv(envPath: string = '.env'): Record<string, string> {
  const fullPath = path.resolve(envPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`.env file not found at ${fullPath}`);
  }

  const result = dotenv.config({ path: fullPath });

  if (result.error) {
    throw new Error(`Failed to parse .env file: ${result.error.message}`);
  }

  return result.parsed || {};
}

/**
 * Generate MCP config from environment
 */
export function generateMCPConfig(env: Record<string, string>, distPath?: string): MCPConfig {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(moduleDir, '../..');
  const indexPath = distPath || path.resolve(projectRoot, 'dist/index.js');

  const { LINEAR_API_KEY, LINEAR_TEAM_ID, NOTION_API_KEY } = env;

  // Validate required environment variables
  const missing = [
    ['LINEAR_API_KEY', LINEAR_API_KEY],
    ['LINEAR_TEAM_ID', LINEAR_TEAM_ID],
    ['NOTION_API_KEY', NOTION_API_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Build environment object for MCP server
  const mcpEnv: Record<string, string> = {
    LINEAR_API_KEY,
    LINEAR_TEAM_ID,
    NOTION_API_KEY,
  };

  const optionalKeys: Array<keyof typeof env> = [
    'PROJECT_MAPPINGS',
    'NOTION_GLOBAL_LESSONS_DB_ID',
    'NOTION_GLOBAL_LESSONS_DATA_SOURCE_ID',
    'NOTION_GLOBAL_DECISIONS_DB_ID',
    'NOTION_GLOBAL_DECISIONS_DATA_SOURCE_ID',
    'UNCERTAINTY_RESOLUTION_MODE',
  ];

  for (const key of optionalKeys) {
    const value = env[key];
    if (value) {
      mcpEnv[key] = value;
    }
  }

  // Generate config
  const config: MCPConfig = {
    mcpServers: {
      'agent-task-manager': {
        command: 'node',
        args: [indexPath],
        env: mcpEnv,
      },
    },
  };

  return config;
}

/**
 * Write MCP config file
 */
export function writeMCPConfig(
  config: MCPConfig,
  outputPath: string = 'mcp.json',
  options: { force?: boolean; backup?: boolean } = {}
): void {
  const { force = false, backup = true } = options;

  const fullPath = path.resolve(outputPath);

  // Check if file exists
  if (fs.existsSync(fullPath) && !force) {
    throw new Error(
      `MCP config file already exists at ${fullPath}. Use --force to overwrite.`
    );
  }

  // Create backup if requested
  if (fs.existsSync(fullPath) && backup) {
    const backupPath = `${fullPath}.backup.${Date.now()}`;
    fs.copyFileSync(fullPath, backupPath);
    log.info(`Created backup: ${backupPath}`);
  }

  // Write file
  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(fullPath, content, 'utf-8');

  log.success(`Generated MCP config: ${fullPath}`);
}

/**
 * Validate MCP config
 */
export function validateMCPConfig(config: MCPConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.mcpServers) {
    errors.push('Missing mcpServers key');
    return { valid: false, errors };
  }

  const serverConfig = config.mcpServers['agent-task-manager'];

  if (!serverConfig) {
    errors.push('Missing agent-task-manager server configuration');
    return { valid: false, errors };
  }

  if (!serverConfig.command) {
    errors.push('Missing command');
  }

  if (!serverConfig.args || serverConfig.args.length === 0) {
    errors.push('Missing args');
  }

  if (!serverConfig.env) {
    errors.push('Missing env');
  } else {
    const required = ['LINEAR_API_KEY', 'LINEAR_TEAM_ID', 'NOTION_API_KEY'];
    required.forEach((key) => {
      if (!serverConfig.env[key]) {
        errors.push(`Missing env.${key}`);
      }
    });
  }

  // Check if index.js exists
  if (serverConfig.args && serverConfig.args[0]) {
    const indexPath = path.resolve(serverConfig.args[0]);
    if (!fs.existsSync(indexPath)) {
      errors.push(`Index file not found: ${indexPath} (did you run 'pnpm run build'?)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * CLI mode
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const envPath = args.find((arg) => arg.startsWith('--env='))?.split('=')[1] || '.env';
  const outputPath = args.find((arg) => arg.startsWith('--output='))?.split('=')[1] || 'mcp.json';
  const distPath = args.find((arg) => arg.startsWith('--dist='))?.split('=')[1];
  const force = args.includes('--force');
  const backup = !args.includes('--no-backup');

  try {
    log.step('Generating MCP configuration...');

    // Load environment
    log.info(`Loading environment from: ${envPath}`);
    const env = loadEnv(envPath);

    // Generate config
    const config = generateMCPConfig(env, distPath);

    // Validate config
    const validation = validateMCPConfig(config);
    if (!validation.valid) {
      log.error('MCP config validation failed:');
      validation.errors.forEach((err) => log.error(`  - ${err}`));
      process.exit(1);
    }

    // Write config
    writeMCPConfig(config, outputPath, { force, backup });

    console.log('\n' + '='.repeat(60));
    log.success('MCP configuration generated!');
    console.log('\nNext steps:');
    console.log('1. Add this config to your project as .mcp.json (primary target)');
    console.log('2. Claude Code will auto-discover the MCP server via stdio transport');
    console.log('\nAlternatively for Claude Desktop:');
    console.log('   - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json');
    console.log('   - Windows: %APPDATA%\\Claude\\claude_desktop_config.json');
    console.log('   - Linux: ~/.config/Claude/claude_desktop_config.json');
    console.log('\nConfig location: ' + path.resolve(outputPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to generate MCP config: ${message}`);
    process.exit(1);
  }
}
