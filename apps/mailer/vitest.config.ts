import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit and flow tests only: Google and Microsoft are replaced by a fake fetch, storage is in memory.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
