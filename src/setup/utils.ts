/**
 * Shared utilities for setup scripts
 */

import { ValidationResult } from './shared-types.js';
import { ProjectsConfigSchema } from '../types.js';
import type { ProjectsConfig } from '../types.js';

/**
 * Debug mode - set via DEBUG=1 environment variable
 */
export const DEBUG = process.env.DEBUG === '1';

/**
 * Logger with debug support
 */
export const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  warn: (msg: string) => console.warn(`⚠️  ${msg}`),
  debug: (msg: string) => DEBUG && console.log(`🔍 ${msg}`),
  step: (msg: string) => console.log(`\n📋 ${msg}\n`),
};

/**
 * Validate API key format
 */
export function validateLinearApiKey(key: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!key) {
    errors.push('Linear API key is required');
  } else if (!key.startsWith('lin_api_')) {
    errors.push('Linear API key should start with "lin_api_"');
  } else if (key.length < 40) {
    warnings.push('Linear API key seems too short');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate Notion integration token format
 * Note: Notion tokens may start with different prefixes (secret_, ntn_, etc.)
 * depending on the API version and integration type
 */
export function validateNotionToken(token: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!token) {
    errors.push('Notion integration token is required');
  } else if (token.length < 40) {
    errors.push('Notion integration token seems too short (minimum 40 characters)');
  } else {
    // Check for common known prefixes but only warn if not found
    const knownPrefixes = ['secret_', 'ntn_', 'notion_'];
    const hasKnownPrefix = knownPrefixes.some(prefix => token.startsWith(prefix));

    if (!hasKnownPrefix) {
      warnings.push(
        `Token doesn't start with common prefixes (${knownPrefixes.join(', ')}). ` +
        'This is OK if Notion changed their token format. Validation will continue.'
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate Notion database ID format
 */
export function validateNotionDatabaseId(id: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!id) {
    errors.push('Database ID is required');
  } else {
    // Remove hyphens for validation
    const cleaned = id.replace(/-/g, '');
    if (cleaned.length !== 32) {
      errors.push(`Database ID should be 32 characters (got ${cleaned.length})`);
    }
    if (!/^[a-f0-9]+$/i.test(cleaned)) {
      errors.push('Database ID should only contain hexadecimal characters');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate UUID format (for Linear team/project IDs)
 */
export function validateUUID(id: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!id) {
    errors.push('ID is required');
  } else {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      errors.push('ID is not a valid UUID');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Format a Notion database ID (remove hyphens)
 */
export function formatNotionDatabaseId(id: string): string {
  return id.replace(/-/g, '');
}

/**
 * Parse PROJECT_MAPPINGS from JSON string
 */
export function parseProjectMappings(json: string): ProjectsConfig | null {
  try {
    const parsed: unknown = JSON.parse(json);
    const result = ProjectsConfigSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Sleep helper for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for API calls
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (_error) {
      const error = _error instanceof Error ? _error : new Error(String(_error));
      lastError = error;
      log.debug(`Retry ${i + 1}/${maxRetries} failed: ${lastError.message}`);
      if (i < maxRetries - 1) {
        await sleep(delayMs * (i + 1)); // Exponential backoff
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Print validation results
 */
export function printValidationResults(results: ValidationResult, context: string): boolean {
  if (results.errors.length > 0) {
    log.error(`${context} validation failed:`);
    results.errors.forEach((err) => console.error(`  - ${err}`));
  }

  if (results.warnings.length > 0) {
    log.warn(`${context} warnings:`);
    results.warnings.forEach((warn) => console.warn(`  - ${warn}`));
  }

  if (results.valid && results.warnings.length === 0) {
    log.success(`${context} validation passed`);
  }

  return results.valid;
}
