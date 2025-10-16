import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const baseTsRules = {
  ...js.configs.recommended.rules,
  ...tsPlugin.configs.recommended.rules,
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-console': 'off',
};

const typeAwareRules = {
  ...tsPlugin.configs['recommended-type-checked'].rules,
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
};

const baseLanguageOptions = {
  parser: tsParser,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  globals: {
    ...globals.node,
  },
};

const typeAwareLanguageOptions = {
  ...baseLanguageOptions,
  parserOptions: {
    ...baseLanguageOptions.parserOptions,
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
};

const vitestLanguageOptions = {
  ...baseLanguageOptions,
  globals: {
    ...globals.node,
    ...globals.vitest,
  },
};

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: baseLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...baseTsRules,
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/**/*.ts'],
    languageOptions: typeAwareLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...baseTsRules,
      ...typeAwareRules,
    },
  },
  {
    files: ['src/__tests__/**/*.ts', 'vitest.config.ts'],
    languageOptions: vitestLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...baseTsRules,
      'no-console': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
