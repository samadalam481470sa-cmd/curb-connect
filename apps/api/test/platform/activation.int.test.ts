// One free trial per email address, and activation codes (migration 0021, services/trial-email.ts,
// services/activation-codes.ts, modules/billing POST /billing/activate).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashActivationCode, generateActivationCode } from '../../src/services/activation-codes';
import { call, createTestContext, createUser, signIn, type TestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());
afterAll(() => ctx?.close());

const uniqueEmail = (local: string) => `${local}.${crypto.randomUUID().slice(0, 8)}@example.test`;

async function createCompanyFor(email: string, name: string) {
  const user = await createUser(ctx, { email });
  const session = await signIn(ctx, user.userId, null);
  const res = await call(ctx, 'POST', '/v1/orgs', {
    as: session,
    body: { legalName: `${name} (fictional)`, displayName: name, productLines: ['roof'], timezone: 'America/Chicago' },
    headers: { 'idempotency-key': `act-${crypto.randomUUID()}` },
  });
  expect(res.statusCode).toBe(201);
  ctx.track.org(res.json().id);
  return { orgId: res.json().id as string, session };
}

async function makeCode(days: number): Promise<string> {
  const code = generateActivationCode();
  await ctx.owner.client`insert into public.activation_codes (id, code_hash, label, grant_days)
    values (gen_random_uuid(), ${hashActivationCode(code.replace(/-/g, ''))}, 'test', ${days})`;
  return code;
}

describe('one free trial per email address', () => {
  it('does not give a second company from the same mailbox a new trial', async () => {
    const email = uniqueEmail('owner');
    const first = await createCompanyFor(email, 'Mailbox First');
    const [a] = await ctx.owner.client<{ state: string }[]>`
      select case when trial_ends_at > now() then 'trial' else 'expired' end as state from public.organizations where id = ${first.orgId}`;
    expect(a?.state).toBe('trial');

    // Same mailbox written differently: case, a +tag and a new account.
    const variant = email.replace('@', '+another@').toUpperCase();
    const second = await createCompanyFor(variant, 'Mailbox Second');
    const [b] = await ctx.owner.client<{ state: string }[]>`
      select case when trial_ends_at > now() then 'trial' else 'expired' end as state from public.organizations where id = ${second.orgId}`;
    expect(b?.state).toBe('expired');

    const status = await call(ctx, 'GET', '/v1/billing/status', { as: second.session });
    expect(status.json()).toMatchObject({ access: 'expired', emailTrialUsed: true });
  });

  it('keeps a trial for a different mailbox', async () => {
    const company = await createCompanyFor(uniqueEmail('fresh'), 'Fresh Mailbox');
    const status = await call(ctx, 'GET', '/v1/billing/status', { as: company.session });
    expect(status.json()).toMatchObject({ access: 'trial', trialDaysLeft: 7, emailTrialUsed: true });
  });
});

describe('activation codes', () => {
  it('extends an expired company by the code\'s days, and a code works once', async () => {
    const company = await createCompanyFor(uniqueEmail('activate'), 'Activate Co');
    await ctx.owner.client`update public.organizations set trial_ends_at = '2020-01-01T00:00:00Z' where id = ${company.orgId}`;
    const blocked = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: company.session });
    expect(blocked.statusCode).toBe(402);

    const code = await makeCode(30);
    const redeemed = await call(ctx, 'POST', '/v1/billing/activate', { as: company.session, body: { code: code.toLowerCase() } });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({ access: 'activated', trialDaysLeft: null });
    const ok = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: company.session });
    expect(ok.statusCode).toBe(200);

    const [row] = await ctx.owner.client<{ days: number }[]>`
      select round(extract(epoch from (activated_until - now())) / 86400)::int as days from public.organizations where id = ${company.orgId}`;
    expect(row?.days).toBe(30);

    const again = await call(ctx, 'POST', '/v1/billing/activate', { as: company.session, body: { code } });
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('activation_code_invalid');

    const other = await createCompanyFor(uniqueEmail('thief'), 'Other Co');
    const stolen = await call(ctx, 'POST', '/v1/billing/activate', { as: other.session, body: { code } });
    expect(stolen.statusCode).toBe(400);
  });

  it('rejects malformed and unknown codes without revealing which', async () => {
    const company = await createCompanyFor(uniqueEmail('guess'), 'Guess Co');
    const malformed = await call(ctx, 'POST', '/v1/billing/activate', { as: company.session, body: { code: 'ABCD' } });
    expect(malformed.statusCode).toBe(400);
    const unknown = await call(ctx, 'POST', '/v1/billing/activate', { as: company.session, body: { code: generateActivationCode() } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('activation_code_invalid');
  });

  it('cannot be set on a company by the tenant role', async () => {
    const company = await createCompanyFor(uniqueEmail('tamper'), 'Tamper Co');
    const attempt = ctx.owner.client.begin(async (tx) => {
      await tx`set local role fieldline_app`;
      await tx`select set_config('app.org_id', ${company.orgId}, true)`;
      await tx`update public.organizations set activated_until = now() + interval '365 days' where id = ${company.orgId}`;
    });
    await expect(attempt).rejects.toThrow(/billing fields can only be changed by the platform/);
  });

  it('is not readable or writable by the tenant role', async () => {
    const company = await createCompanyFor(uniqueEmail('readcodes'), 'Read Codes Co');
    const attempt = ctx.owner.client.begin(async (tx) => {
      await tx`set local role fieldline_app`;
      await tx`select set_config('app.org_id', ${company.orgId}, true)`;
      await tx`select count(*) from public.activation_codes`;
    });
    await expect(attempt).rejects.toThrow(/permission denied/);
  });
});
