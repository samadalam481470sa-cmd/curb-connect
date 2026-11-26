import { expect, type Page } from '@playwright/test';

export async function chooseDevIdentity(page: Page, subject: string) {
  const chooser = page.locator('form.pick');
  await expect(chooser.locator('button[name="sub"][value="' + subject + '"]')).toBeVisible();
  const action = await chooser.getAttribute('action');
  if (!action) throw new Error('The development identity form has no action.');
  const response = await page.request.post(new URL(action, page.url()).href, {
    form: { sub: subject },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  const resume = response.headers().location;
  if (!resume) throw new Error('The development identity provider did not resume authorization.');
  // Navigate explicitly because this dev form's CSP restricts cross-origin form redirects.
  await page.goto(new URL(resume, page.url()).href);
}
