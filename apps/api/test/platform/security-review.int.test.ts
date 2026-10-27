// Adversarial security review (Sprint 0): privilege escalation through role changes, CSRF on
// unsafe methods, oversized/mismatched uploads, and cross-tenant probes not covered elsewhere.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { permissionOverrides } from '../../src/db/schema';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());
afterAll(() => ctx?.close());

async function etagOf(person: { cookie: string }, membershipId: string): Promise<string> {
  const res = await call(ctx, 'GET', `/v1/team/members/${membershipId}`, { as: person });
  expect(res.statusCode).toBe(200);
  return res.headers.etag as string;
}

describe('SEC privilege escalation via role change', () => {
  it('an admin cannot promote another member to admin (only the owner can create admins)', async () => {
    const a = await createCompany(ctx, { roles: ['admin', 'estimator'] });
    const target = a.as('estimator');
    const res = await call(ctx, 'PATCH', `/v1/team/members/${target.membershipId}`, {
      as: a.as('admin'),
      body: { role: 'admin' },
      headers: { 'if-match': await etagOf(a.owner, target.membershipId) },
    });
    expect(res.statusCode).toBe(403);
    // The owner still can.
    const ok = await call(ctx, 'PATCH', `/v1/team/members/${target.membershipId}`, {
      as: a.owner,
      body: { role: 'admin' },
      headers: { 'if-match': await etagOf(a.owner, target.membershipId) },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('a member granted team:update_role by override cannot change their own role', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    const me = a.as('estimator');
    await ctx.owner.db.insert(permissionOverrides).values({
      orgId: a.orgId,
      membershipId: me.membershipId,
      action: 'team:update_role',
      effect: 'grant',
      reason: 'security review probe',
    });
    // team:read is needed for the ETag lookup; use the owner for that.
    const res = await call(ctx, 'PATCH', `/v1/team/members/${me.membershipId}`, {
      as: me,
      body: { role: 'finance' },
      headers: { 'if-match': await etagOf(a.owner, me.membershipId) },
    });
    expect(res.statusCode).toBe(403);
    const after = await call(ctx, 'GET', `/v1/team/members/${me.membershipId}`, { as: a.owner });
    expect(after.json().role).toBe('estimator');
  });

  it('the owner of record cannot be demoted or deactivated by anyone (last-owner protection)', async () => {
    const a = await createCompany(ctx, { roles: ['admin'] });
    for (const body of [{ role: 'admin' }, { status: 'suspended' }]) {
      const res = await call(ctx, 'PATCH', `/v1/team/members/${a.owner.membershipId}`, {
        as: a.owner,
        body,
        headers: { 'if-match': await etagOf(a.owner, a.owner.membershipId) },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
    const dea = await call(ctx, 'POST', `/v1/team/members/${a.owner.membershipId}/deactivate`, {
      as: a.as('admin'),
      body: { reason: "security review probe" },
    });
    expect([403, 409, 422]).toContain(dea.statusCode);
  });
});

describe('SEC CSRF on unsafe methods', () => {
  it('a cross-site POST with a valid session cookie is rejected', async () => {
    const a = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { email: 'csrf@example.test', role: 'estimator' },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    const site = await call(ctx, 'POST', '/v1/auth/logout', {
      as: a.owner,
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(site.statusCode).toBe(403);
  });
});

describe('SEC tenant context never comes from the client', () => {
  it('an org id in a header or body does not change the tenant scope', async () => {
    const a = await createCompany(ctx);
    const b = await createCompany(ctx);
    const res = await call(ctx, 'GET', '/v1/orgs/current', {
      as: b.owner,
      headers: { 'x-org-id': a.orgId, 'x-fieldline-org': a.orgId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(b.orgId);
    const sw = await call(ctx, 'POST', '/v1/session/active-org', { as: b.owner, body: { orgId: a.orgId } });
    expect(sw.statusCode).toBe(404);
    expect(JSON.stringify(sw.json())).not.toContain(a.displayName);
  });
});
