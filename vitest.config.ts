import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      lines: 0.95,
      functions: 0.95,
      statements: 0.95,
      branches: 0.9,
      include: ['src/orchestrator/**/*.ts', 'src/domain/**/*.ts'],
    },
  },
});
