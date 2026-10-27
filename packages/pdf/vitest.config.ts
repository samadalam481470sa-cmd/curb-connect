import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // First render loads fonts and the layout engine; give it room on slow CI machines.
    testTimeout: 30_000,
  },
});
