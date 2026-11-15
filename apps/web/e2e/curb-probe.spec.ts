import { test } from '@playwright/test';
test.use({ bypassCSP: true });
test('probe', async ({ page }) => {
  await page.goto('/v1/auth/login/dev?returnTo=%2Fcurb%2Fnew');
  console.log(page.url()); console.log((await page.locator('body').innerText()).slice(0, 800));
  page.on('console', (m) => console.log('CONSOLE', m.text()));  await page.getByRole('button', { name: /Demo Curb owner/ }).click();
  await page.waitForURL(/localhost:3000\/curb/);
  await page.waitForTimeout(4000);
  console.log(page.url()); console.log((await page.locator('body').innerText()).slice(0, 2500));
});
