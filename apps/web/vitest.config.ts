import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Playwright journeys live in e2e/ and run with `npm run test:e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
