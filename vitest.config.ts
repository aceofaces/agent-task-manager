import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      all: true,
      clean: true,
      lines: 90,
      functions: 87,
      statements: 90,
      branches: 82,
      include: [
        'src/orchestrator/**/*.ts',
        'src/domain/**/*.ts',
        'src/config/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/types.ts',
        'src/setup/**/*.ts', // Setup scripts are interactive
        'src/integrations/**/*.ts', // External API integrations
      ],
      thresholds: {
        autoUpdate: false,
        lines: 90,
        functions: 87,
        statements: 90,
        branches: 82,
        perFile: false,
      },
    },
  },
});
