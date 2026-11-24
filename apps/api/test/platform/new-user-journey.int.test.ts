// Full new-user journey (Phase F item 29): sign up with a password, land signed in, create a
// company (trial starts), use the main tools (jobs, dashboard, search, flags, team, Ask Field
// Pro help), make and send an invoice, then the trial ends and product routes block while
// billing stays reachable. Everything goes through the real HTTP surface with the restricted
// app role, exactly as a browser would. Needs TEST_DATABASE_URL / TEST_APP_DATABASE_URL (CI).
import { MeResponseSchema } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, createTestContext, setCookieValue, type TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  // Track the password account this journey created so cleanup removes it.
  const rows = await ctx.owner.client<{ user_id: string }[]>`
    select user_id from password_credentials where username like 'e2e-%'`;
  for (const row of rows) ctx.track.user(row.user_id);
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

const ORIGIN = { origin: 'http://localhost:3000' };
const PASSWORD = 'curbs-and-roofs-2026';

function cookieOf(res: Awaited<ReturnType<typeof call>>) {
  const value = setCookieValue(res, 'fl_session');
  if (!value) throw new Error('no session cookie');
  return { cookie: value };
}

describe('new-user journey', () => {
  it('signs up, creates a company, works, invoices, then the trial ends', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const username = `e2e-${id}`;

    // 1. Sign up. With no mail configured the account is auto-verified and signed in.
    const signUp = await call(ctx, 'POST', '/v1/auth/password/sign-up', {
      body: {
        displayName: 'Journey Tester',
        username,
        email: `${username}@example.test`,
        password: PASSWORD,
        ageConfirmed: true,
      },
      headers: ORIGIN,
    });
    expect(signUp.statusCode, signUp.body).toBe(200);
    expect(signUp.json()).toEqual({ redirectTo: '/' });
    const me0 = cookieOf(signUp);

    const me = await call(ctx, 'GET', '/v1/me', { as: me0 });
    expect(me.statusCode).toBe(200);
    const meBody = MeResponseSchema.parse(me.json());
    expect(meBody.user.email).toBe(`${username}@example.test`);
    expect(meBody.memberships).toHaveLength(0);
    expect(meBody.activeOrgId).toBeNull();

    // Wrong password is refused; the right one signs back in (login regression inside the journey).
    const wrong = await call(ctx, 'POST', '/v1/auth/password/sign-in', {
      body: { username, password: 'not-the-password-1' },
      headers: ORIGIN,
    });
    expect(wrong.statusCode).toBe(401);

    // 2. Create the company: the 7-day trial starts and the session lands in the new workspace.
    const orgRes = await call(ctx, 'POST', '/v1/orgs', {
      as: me0,
      body: {
        legalName: 'Journey Roofing LLC (fictional)',
        displayName: 'Journey Roofing',
        productLines: ['roof', 'curb'],
        timezone: 'America/Chicago',
      },
      headers: { 'idempotency-key': `e2e-org-${id}` },
    });
    expect(orgRes.statusCode, orgRes.body).toBe(201);
    const orgId = orgRes.json().id as string;
    ctx.track.org(orgId);

    const meAfter = await call(ctx, 'GET', '/v1/me', { as: me0 });
    expect(MeResponseSchema.parse(meAfter.json()).activeOrgId).toBe(orgId);

    const billing = await call(ctx, 'GET', '/v1/billing/status', { as: me0 });
    expect(billing.statusCode).toBe(200);
    expect(billing.json()).toMatchObject({ access: 'trial', trialDaysLeft: 7 });

    // 3. Use the tools: job lifecycle, dashboard, search, flags, team, Ask Field Pro help.
    const job = await call(ctx, 'POST', '/v1/jobs', {
      as: me0,
      body: { title: 'Journey reroof', productLine: 'roof', estimatedValueMinor: 250000 },
    });
    expect(job.statusCode, job.body).toBe(201);
    const jobId = job.json().id as string;
    const staged = await call(ctx, 'PATCH', `/v1/jobs/${jobId}/stage`, {
      as: me0,
      body: { stage: 'estimating' },
    });
    expect(staged.statusCode).toBe(200);

    for (const url of ['/v1/jobs', '/v1/dashboard', '/v1/flags', '/v1/team/members']) {
      const res = await call(ctx, 'GET', url, { as: me0 });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    }
    const search = await call(ctx, 'GET', '/v1/search?q=Journey', { as: me0 });
    expect(search.statusCode, search.body).toBe(200);

    // Ask Field Pro: no AI configured in tests, so status is honest, ask refuses plainly, and
    // the built-in help topics answer instead (item 28).
    const aiStatus = await call(ctx, 'GET', '/v1/assistant/status', { as: me0 });
    expect(aiStatus.statusCode).toBe(200);
    expect(aiStatus.json()).toMatchObject({ homeServer: 'not_configured', available: false });
    const ask = await call(ctx, 'POST', '/v1/assistant/ask', {
      as: me0,
      body: { question: 'How does the trial work?', mode: 'general' },
    });
    expect(ask.statusCode).toBe(503);
    const help = await call(ctx, 'GET', '/v1/assistant/help?q=trial', { as: me0 });
    expect(help.statusCode, help.body).toBe(200);
    expect(help.json().topics.map((t: { id: string }) => t.id)).toContain('trial');
    expect(help.json().aiAvailable).toBe(false);

    // 4. Make and send an invoice.
    const invoice = await call(ctx, 'POST', '/v1/invoices', {
      as: me0,
      body: {
        billTo: { name: 'Journey Customer', email: 'customer@example.test', cityState: 'Dallas, TX' },
        from: { name: 'Journey Roofing' },
        title: 'Invoice',
        terms: 'Net 30',
        issuedOn: '2026-11-22',
        dueOn: '2026-12-22',
        taxRate: '0.0825',
        lines: [
          { description: 'Reroof, 30 squares', quantity: '30', unit: 'each', unitPriceMinor: 35000 },
        ],
      },
      headers: { 'idempotency-key': `e2e-inv-${id}` },
    });
    expect(invoice.statusCode, invoice.body).toBe(201);
    expect(invoice.json()).toMatchObject({ status: 'draft', totalMinor: 1_136_625 });
    const sent = await call(ctx, 'POST', `/v1/invoices/${invoice.json().id}/send`, {
      as: me0,
      body: {},
      headers: { 'idempotency-key': `e2e-send-${id}` },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'issued' });

    // 5. The trial ends: product routes block with trial_expired, billing stays reachable,
    // and sign-in still works so the owner can subscribe.
    await ctx.owner.client`update public.organizations set trial_ends_at = now() - interval '1 hour' where id = ${orgId}`;
    const blocked = await call(ctx, 'GET', '/v1/jobs', { as: me0 });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe('trial_expired');
    const billingAfter = await call(ctx, 'GET', '/v1/billing/status', { as: me0 });
    expect(billingAfter.statusCode).toBe(200);
    expect(billingAfter.json()).toMatchObject({ access: 'expired' });

    const signIn = await call(ctx, 'POST', '/v1/auth/password/sign-in', {
      body: { username, password: PASSWORD },
      headers: ORIGIN,
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
  });

  it('keeps a second company for the same person from restarting the trial', async () => {
    const id = crypto.randomUUID().slice(0, 8);
    const username = `e2e-two-${id}`;
    const signUp = await call(ctx, 'POST', '/v1/auth/password/sign-up', {
      body: {
        displayName: 'Journey Tester',
        username,
        email: `${username}@example.test`,
        password: PASSWORD,
        ageConfirmed: true,
      },
      headers: ORIGIN,
    });
    expect(signUp.statusCode).toBe(200);
    const me = cookieOf(signUp);
    const body = {
      legalName: 'First Journey Co (fictional)',
      displayName: 'First Journey Co',
      productLines: ['roof'],
      timezone: 'America/Chicago',
    };
    const first = await call(ctx, 'POST', '/v1/orgs', {
      as: me,
      body,
      headers: { 'idempotency-key': `e2e-two-1-${id}` },
    });
    expect(first.statusCode).toBe(201);
    ctx.track.org(first.json().id);
    const second = await call(ctx, 'POST', '/v1/orgs', {
      as: me,
      body: { ...body, legalName: 'Second Journey Co (fictional)', displayName: 'Second Journey Co' },
      headers: { 'idempotency-key': `e2e-two-2-${id}` },
    });
    expect(second.statusCode).toBe(201);
    ctx.track.org(second.json().id);
    const switched = await call(ctx, 'POST', '/v1/session/active-org', {
      as: me,
      body: { orgId: second.json().id },
    });
    expect(switched.statusCode, switched.body).toBe(200);
    const billing = await call(ctx, 'GET', '/v1/billing/status', { as: me });
    expect(billing.json()).toMatchObject({ access: 'expired' });
  });
});
