import { expect, test } from '@playwright/test';

// Minimal acceptance journeys for the web shell (LCH-095). They need the API on :4000 (behind the
// /v1 rewrite) and the dev IdP for the signed-in parts. Browsers are installed separately
// (`npx playwright install`); this file is not run in the default test suite.

test('PLT-011-QA: serves an installable web app manifest', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { display: string; icons: { purpose?: string }[] };
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
});

test('PLT-013-QA: sign-in page lists configured providers safely', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  const providers = page.getByRole('link', { name: /^Continue with/ });
  const noneConfigured = page.getByRole('alert').filter({
    hasText: 'No sign-in provider is configured',
  });
  await expect(providers.first().or(noneConfigured)).toBeVisible();
  if (await providers.count()) {
    const labels = await providers.allTextContents();
    // Microsoft must sort first when configured, but CI must not fake an OAuth provider.
    if (labels.some((label) => label.includes('Microsoft'))) {
      expect(labels[0]).toContain('Microsoft');
    }
  } else {
    await expect(noneConfigured).toContainText('administrator');
  }
});

test('PLT-011-QA: the access recovery page shows no workspace content', async ({ page }) => {
  await page.goto('/access?reason=expired');
  await expect(page.getByRole('heading', { name: 'Your session ended' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('PLT-011-QA: an unauthenticated deep link is sent to sign-in with a return path', async ({
  page,
}) => {
  await page.goto('/team');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fteam/);
});

test('PLT-018-QA: the offline fallback page is prerendered', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
});
