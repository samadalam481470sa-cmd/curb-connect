import { expect, test } from '@playwright/test';

// Signed-in acceptance journey for the ConstructionOS plumbing estimator (PL-001): a seeded company
// owner prices a takeoff, saves it to company records, approves it, and the panel must end in the
// approved-and-frozen state.
//
// It needs the running stack, not just the web build: the API on :4000 with the stand-in dev IdP
// (DEV_IDP_ISSUER/DEV_IDP_CLIENT_ID) enabled, the IdP itself on :4100, and the demo seed applied so
// `demo-roof-owner` exists with its owner membership. CI's e2e job starts all of that; without the
// seeded owner the deep link lands on a sign-in page that has no provider to offer.
//
// The journey is desktop-only on purpose: it is a table-heavy data-entry panel, and the mobile
// project would exercise the same mutations through a layout this test does not aim to cover.
test.skip(({ isMobile }) => isMobile, 'Desktop data-entry panel');

test('PL-001-QA: an owner prices, saves and approves a plumbing estimate', async ({ page }) => {
  // An unauthenticated deep link is sent to /sign-in with a return path; the dev IdP is the only
  // configured provider there, so the sign-in page starts that flow by itself and comes back here.
  await page.goto('/plumbing');
  await expect(page.getByRole('heading', { level: 1, name: 'Plumbing' })).toBeVisible();
  await expect(page).toHaveURL(/\/plumbing$/);

  // Prove this is the seeded owner and not a fresh sign-up: /v1/me is read through the page's own
  // session cookies, exactly like the app does.
  const me = await page.request.get('/v1/me');
  expect(me.ok()).toBe(true);
  const session = (await me.json()) as {
    user: { email: string };
    activeRole: string;
    activeOrgId: string;
  };
  expect(session.user.email).toBe('demo-roof-owner@example.test');
  expect(session.activeRole).toBe('owner');
  expect(session.activeOrgId).toBeTruthy();

  // The default draft has line(s) with no price, so the takeoff says so and approval would be
  // refused. Pricing comes first because an estimate records the lines priced when it was computed.
  await expect(page.getByText(/still need a price before this can be sent/)).toBeVisible();
  await page.getByRole('button', { name: 'Use sample prices' }).click();
  await expect(page.getByText(/still need a price before this can be sent/)).toHaveCount(0);

  // Save: creates the company-owned project, one immutable revision and a server-computed estimate.
  await page.getByRole('button', { name: 'Save priced estimate to company records' }).click();
  const status = page.getByRole('status').filter({ hasText: 'Saved revision' });
  await expect(status).toBeVisible();
  await expect(status).toContainText('Saved revision 1');
  await expect(status).toContainText(/\$[\d,]+\.\d{2}/);
  await expect(status).toContainText('all lines priced.');

  // Approval is only reachable now that every line carries a price.
  const approve = page.getByRole('button', { name: 'Approve estimate' });
  await expect(approve).toBeEnabled();
  await approve.click();

  // Approved and frozen: the panel reports it and the action cannot be repeated.
  await expect(status).toContainText('all lines priced, approved and frozen.');
  const approved = page.getByRole('button', { name: 'Approved', exact: true });
  await expect(approved).toBeVisible();
  await expect(approved).toBeDisabled();

  // A second save adds the next immutable revision to the same project rather than a new project.
  await expect(page.getByRole('button', { name: 'Save new revision' })).toBeEnabled();
});
