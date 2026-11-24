// Delete your own account (POST /v1/auth/account/delete): a sole owner closes their workspace
// and is gone; a member of a shared workspace only loses the membership; the sole owner of a
// shared workspace must transfer ownership first. Append-only records stay behind by design and
// the workspace is closed, not erased.
import { DeleteAccountResponseSchema } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  cookieCleared,
  createCompany,
  createTestContext,
  type TestContext,
} from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

const ORIGIN = { origin: 'http://localhost:3000' };

async function deleteAccount(as: { cookie: string }, body: unknown = { confirm: 'DELETE' }) {
  return call(ctx, 'POST', '/v1/auth/account/delete', { as, body, headers: ORIGIN });
}

describe('delete your own account', () => {
  it('closes the solely-owned workspace, deletes what can be deleted, and signs out', async () => {
    const company = await createCompany(ctx);
    const owner = company.owner;
    // A deletable tenant row and an append-only row for the same workspace.
    await ctx.owner.client`
      insert into user_workspace_drafts (org_id, user_id, draft_key, value)
      values (${company.orgId}, ${owner.userId}, 'roof-draft', '{}'::jsonb)`;
    await ctx.owner.client`
      insert into audit_events (org_id, actor_type, action, resource_type)
      values (${company.orgId}, 'system', 'test.event', 'test')`;
    // A paid subscription: deleting the account must not silently cancel it.
    const planCode = `test-standard-${crypto.randomUUID().slice(0, 8)}`;
    const [plan] = await ctx.owner.client<{ id: string }[]>`
      insert into plans (code, name, interval, price_minor, currency, included_usage, features)
      values (${planCode}, 'Test Standard', 'month', 9900, 'USD', '{}'::jsonb, '{}')
      returning id`;
    await ctx.owner.client`
      insert into subscriptions (org_id, plan_id, status, provider_subscription_id, current_period_start, current_period_end)
      values (${company.orgId}, ${plan!.id}, 'active', 'sub_test_123', now(), now() + interval '1 month')`;

    const res = await deleteAccount(owner);
    expect(res.statusCode, res.body).toBe(200);
    const body = DeleteAccountResponseSchema.parse(res.json());
    expect(body.deleted).toBe(true);
    expect(body.organizationsClosed).toEqual([{ id: company.orgId, displayName: company.displayName }]);
    expect(body.membershipsRemoved).toEqual([]);
    expect(body.hadActiveSubscription).toBe(true);
    // Append-only records stay: the audit row and the settings history from creation.
    expect(body.retainedTables).toContain('public.audit_events');
    expect(body.retainedTables).toContain('public.org_settings_revisions');
    expect(body.enterpriseRecordsRetained).toBe(false);
    expect(cookieCleared(res, 'fl_session')).toBe(true);

    const [org] = await ctx.owner.client<{ status: string }[]>`
      select status from organizations where id = ${company.orgId}`;
    expect(org!.status).toBe('closed');
    const [user] = await ctx.owner.client<{ id: string }[]>`
      select id from users where id = ${owner.userId}`;
    expect(user).toBeUndefined();
    const [session] = await ctx.owner.client<{ id: string }[]>`
      select id from sessions where user_id = ${owner.userId}`;
    expect(session).toBeUndefined();
    const [draft] = await ctx.owner.client<{ id: string }[]>`
      select id from user_workspace_drafts where org_id = ${company.orgId}`;
    expect(draft).toBeUndefined();
    const [audit] = await ctx.owner.client<{ id: string }[]>`
      select id from audit_events where org_id = ${company.orgId}`;
    expect(audit).toBeDefined();
    // The old session no longer works.
    expect((await call(ctx, 'GET', '/v1/me', { as: owner })).statusCode).toBe(401);
  });

  it('only removes the membership in a shared workspace', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    const member = company.as('estimator');
    const res = await deleteAccount(member);
    expect(res.statusCode, res.body).toBe(200);
    const body = DeleteAccountResponseSchema.parse(res.json());
    expect(body.organizationsClosed).toEqual([]);
    expect(body.membershipsRemoved).toEqual([{ id: company.orgId, displayName: company.displayName }]);
    expect(body.hadActiveSubscription).toBe(false);

    const [org] = await ctx.owner.client<{ status: string }[]>`
      select status from organizations where id = ${company.orgId}`;
    expect(org!.status).toBe('active');
    const [ownerMember] = await ctx.owner.client<{ id: string }[]>`
      select id from memberships where org_id = ${company.orgId} and user_id = ${company.owner.userId}`;
    expect(ownerMember).toBeDefined();
    const [gone] = await ctx.owner.client<{ id: string }[]>`
      select id from users where id = ${member.userId}`;
    expect(gone).toBeUndefined();
  });

  it('refuses when the person is the only owner of a shared workspace', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    const res = await deleteAccount(company.owner);
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toContain('Transfer ownership');
    const [user] = await ctx.owner.client<{ id: string }[]>`
      select id from users where id = ${company.owner.userId}`;
    expect(user).toBeDefined();
  });

  it('refuses the wrong confirmation word', async () => {
    const company = await createCompany(ctx);
    const res = await deleteAccount(company.owner, { confirm: 'delete' });
    expect(res.statusCode).toBe(400);
  });
});
