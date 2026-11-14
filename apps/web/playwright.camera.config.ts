import { defineConfig, devices } from '@playwright/test';

// Camera measure checks across phone, tablet and desktop profiles in Google Chrome with a fake
// camera. Runs against a Vite harness (e2e/camera-harness), so no API or sign-in is needed:
//   npx playwright test -c playwright.camera.config.ts
// Note: Playwright's WebKit/Firefox builds are separate downloads; these profiles emulate
// iPhone/iPad screen size, touch and user agent inside Chrome, not real iOS Safari.
const chrome = {
  browserName: 'chromium' as const,
  channel: 'chrome',
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  permissions: ['camera'],
};

const profiles: [string, (typeof devices)[string]][] = [
  ['iPhone SE', devices['iPhone SE']!],
  ['iPhone 15 Pro', devices['iPhone 15 Pro']!],
  ['iPhone 15 Pro Max landscape', devices['iPhone 15 Pro Max landscape']!],
  ['iPad Mini', devices['iPad Mini']!],
  ['iPad Pro 11 landscape', devices['iPad Pro 11 landscape']!],
  ['Pixel 7', devices['Pixel 7']!],
  ['Galaxy S9+', devices['Galaxy S9+']!],
  ['Galaxy Tab S4', devices['Galaxy Tab S4']!],
  ['Desktop Chrome', devices['Desktop Chrome']!],
  ['Laptop 1366x768', { ...devices['Desktop Chrome']!, viewport: { width: 1366, height: 768 } }],
];

export default defineConfig({
  testDir: './e2e',
  testMatch: /camera\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4319' },
  projects: profiles.map(([name, device]) => ({
    name,
    use: { ...device, ...chrome, defaultBrowserType: 'chromium' },
  })),
  webServer: {
    command: 'npx vite --config e2e/camera-harness/vite.config.ts',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
