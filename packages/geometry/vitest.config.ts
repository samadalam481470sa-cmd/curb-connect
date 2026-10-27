import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      // Calculation code is the product's specification: keep it exhaustively tested.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
