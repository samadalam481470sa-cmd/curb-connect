import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          // Pure unit tests: no database, no network. Safe for any CI job.
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Integration tests against the dedicated fieldline_test database. The global setup
          // refuses any database whose name does not end in "_test", then applies migrations.
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup-env.ts'],
          // One shared database: run files serially so per-test cleanup cannot race.
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
