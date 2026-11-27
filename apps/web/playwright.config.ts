import { defineConfig, devices } from '@playwright/test';

// Acceptance journeys (LCH-095). Runs against a production build: `npm run build -w @fieldline/web`
// first, or point E2E_BASE_URL at an already running environment. Browsers are installed
// separately with `npx playwright install` (not part of npm install).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // The signed-in plumbing journey lives beside the shell journeys; the camera suite has its own
  // config (playwright.camera.config.ts) and is not part of this run.
  testMatch:
    /(?:home|plumbing|enterprise-(?:budget|actual-costs|takeoff|estimates|homeowner-finance|jobsite-media|sales-leads))\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...(process.env.E2E_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
