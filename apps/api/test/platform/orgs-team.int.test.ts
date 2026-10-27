// PLT-014-QA / PLT-015-QA / BE-073-QA: tenant creation (idempotent), versioned settings with
// If-Match, team management with audit, invitations (accept, expiry recovery, revoke, resend),
// approval delegations, the role matrix, Idempotency-Key replay/conflict/in-flight, and removal
// taking effect on the next request.
import { OrganizationSchema } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestFingerprint } from '../../src/http/idempotency';
import {
  auditRows,
  call,
  createCompany,
  createTestContext,
  createUser,
  signIn,
  type TestContext,
} from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());
afterAll(() => ctx?.close());

const ORG_BODY = {
  legalName: 'Northwind Curb & Roof LLC (fictional)',
  displayName: 'Northwind Curb & Roof',
  productLines: ['curb', 'roof'],
  timezone: 'America/Chicago',
};

async function graphileJobs(orgId: string, task: string): Promise<number> {
  const [row] = await ctx.owner.client<{ n: number }[]>`
    select count(*)::int as n from graphile_worker._private_jobs j
    join graphile_worker._private_tasks t on t.id = j.task_id
    where t.identifier = ${task} and j.payload ->> 'orgId' = ${orgId}`;
  return row?.n ?? 0;
}

describe('PLT-014-QA create a company', () => {
  it('creates the tenant with the caller as owner of record, defaults, audit, and makes it active', async () => {
    const user = await createUser(ctx);
    const session = await signIn(ctx, user.userId, null);
    const res = await call(ctx, 'POST', '/v1/orgs', {
      as: session,
      body: ORG_BODY,
      headers: { 'idempotency-key': `create-org-${crypto.randomUUID()}` },
    });
    expect(res.statusCode).toBe(201);
    const org = OrganizationSchema.parse(res.json());
    ctx.track.org(org.id);
    expect(org.slug).toBe('northwind-curb-roof');
    expect(org.currency).toBe('USD');

    const me = await call(ctx, 'GET', '/v1/me', { as: session });
    expect(me.json().activeOrgId).toBe(org.id);
    expect(me.json().activeRole).toBe('owner');
    const settings = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: session });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().revisionNumber).toBe(1);
    expect(settings.json().settings.onboarding).toEqual({
      completedSteps: ['company'],
      currentStep: 'products',
    });
    expect(settings.json().settings.estimating.defaultTargetMargin).toBe('0.25');

    const actions = (await auditRows(ctx, org.id)).map((r) => r.action).sort();
    expect(actions).toEqual(['org.created', 'team.member_added']);
  });

  it('is idempotent: the same key and body replays the same company; another body is 422', async () => {
    const user = await createUser(ctx);
    const session = await signIn(ctx, user.userId, null);
    const key = `create-org-${crypto.randomUUID()}`;
    const first = await call(ctx, 'POST', '/v1/orgs', {
      as: session,
      body: ORG_BODY,
      headers: { 'idempotency-key': key },
    });
    ctx.track.org(first.json().id);
    const again = await call(ctx, 'POST', '/v1/orgs', {
      as: session,
      body: ORG_BODY,
      headers: { 'idempotency-key': key },
    });
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json().id).toBe(first.json().id);
    const [count] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from memberships where user_id = ${user.userId}`;
    expect(count?.n).toBe(1);

    const other = await call(ctx, 'POST', '/v1/orgs', {
      as: session,
      body: { ...ORG_BODY, displayName: 'Something else' },
      headers: { 'idempotency-key': key },
    });
    expect(other.statusCode).toBe(422);
    expect(other.json().code).toBe('idempotency_key_reused');
  });

  it('requires a signed-in user and validates the body', async () => {
    expect((await call(ctx, 'POST', '/v1/orgs', { body: ORG_BODY })).statusCode).toBe(401);
    const user = await createUser(ctx);
    const session = await signIn(ctx, user.userId, null);
    const bad = await call(ctx, 'POST', '/v1/orgs', {
      as: session,
      body: { ...ORG_BODY, productLines: [] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('validation_failed');
    expect(bad.json().errors[0].path).toContain('productLines');
  });
});

describe('BE-073-QA If-Match and versioned settings', () => {
  it('PATCH /v1/orgs/current: 428 without If-Match, 412 when stale, 200 + new ETag when current', async () => {
    const a = await createCompany(ctx);
    const get = await call(ctx, 'GET', '/v1/orgs/current', { as: a.owner });
    expect(get.headers.etag).toBe('"1"');
    const missing = await call(ctx, 'PATCH', '/v1/orgs/current', {
      as: a.owner,
      body: { displayName: 'Renamed' },
    });
    expect(missing.statusCode).toBe(428);
    expect(missing.json().code).toBe('precondition_required');
    const ok = await call(ctx, 'PATCH', '/v1/orgs/current', {
      as: a.owner,
      body: { displayName: 'Renamed Co' },
      headers: { 'if-match': '"1"' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.json().displayName).toBe('Renamed Co');
    const stale = await call(ctx, 'PATCH', '/v1/orgs/current', {
      as: a.owner,
      body: { displayName: 'Lost update' },
      headers: { 'if-match': '"1"' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('precondition_failed');
    const [audit] = await auditRows(ctx, a.orgId, 'org.updated');
    expect(audit?.before).toMatchObject({ displayName: a.displayName });
    expect(audit?.after).toMatchObject({ displayName: 'Renamed Co' });
    expect(audit?.correlation_id).toBe(ok.headers['x-request-id']);
  });

  it('settings changes write immutable revisions; prior revisions stay readable', async () => {
    const a = await createCompany(ctx);
    const put = await call(ctx, 'PUT', '/v1/orgs/current/settings/estimating', {
      as: a.owner,
      body: { settings: { defaultOverheadRate: '0.12' }, changeReason: 'New overhead study' },
      headers: { 'if-match': '"1"' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().revisionNumber).toBe(2);
    expect(put.json().settings.estimating.defaultOverheadRate).toBe('0.12');
    // Other fields of the section are preserved.
    expect(put.json().settings.estimating.defaultTargetMargin).toBe('0.25');

    const stale = await call(ctx, 'PUT', '/v1/orgs/current/settings/estimating', {
      as: a.owner,
      body: { settings: { defaultOverheadRate: '0.2' } },
      headers: { 'if-match': '"1"' },
    });
    expect(stale.statusCode).toBe(412);

    const invalid = await call(ctx, 'PUT', '/v1/orgs/current/settings/estimating', {
      as: a.owner,
      body: { settings: { defaultOverheadRate: '12%' } },
      headers: { 'if-match': '"2"' },
    });
    expect(invalid.statusCode).toBe(400);

    const history = await call(ctx, 'GET', '/v1/orgs/current/settings/revisions', { as: a.owner });
    expect(history.json().items.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([
      2, 1,
    ]);
    expect(history.json().items[1].settings.estimating.defaultOverheadRate).toBe('0.10');
    // DB-level immutability (FL001) backs this up.
    const err = await ctx.owner
      .client`update org_settings_revisions set change_reason = 'x' where org_id = ${a.orgId}`.catch(
      (e: { code?: string }) => e.code,
    );
    expect(err).toBe('FL001');
  });

  it('onboarding resumes from the last confirmed step (PLT-014 S)', async () => {
    const a = await createCompany(ctx);
    const res = await call(ctx, 'PUT', '/v1/orgs/current/settings/onboarding', {
      as: a.owner,
      body: { settings: { completedSteps: ['company', 'products'], currentStep: 'regions' } },
      headers: { 'if-match': '"1"' },
    });
    expect(res.statusCode).toBe(200);
    const again = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: a.owner });
    expect(again.json().settings.onboarding.currentStep).toBe('regions');
  });
});

describe('PLT-015-QA role matrix (server authoritative)', () => {
  it('an estimator cannot edit (or even read) company payment settings; finance can', async () => {
    const a = await createCompany(ctx, { roles: ['estimator', 'finance'] });
    const denied = await call(ctx, 'PUT', '/v1/orgs/current/settings/billing', {
      as: a.as('estimator'),
      body: { settings: { paymentTermsDays: 15 } },
      headers: { 'if-match': '"1"' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('forbidden');
    expect(denied.json().detail).toMatch(/Estimator/i);
    const view = await call(ctx, 'GET', '/v1/orgs/current/settings', { as: a.as('estimator') });
    expect(view.json().settings.billing).toBeUndefined();
    expect(view.json().settings.estimating).toBeDefined();

    const allowed = await call(ctx, 'PUT', '/v1/orgs/current/settings/billing', {
      as: a.as('finance'),
      body: { settings: { paymentTermsDays: 15 } },
      headers: { 'if-match': '"1"' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().settings.billing.paymentTermsDays).toBe(15);
    // Finance cannot change general settings.
    const general = await call(ctx, 'PUT', '/v1/orgs/current/settings/general', {
      as: a.as('finance'),
      body: { settings: { workRegions: ['North'] } },
      headers: { 'if-match': '"2"' },
    });
    expect(general.statusCode).toBe(403);
  });

  it.each([
    ['PATCH', '/v1/orgs/current', { displayName: 'x' }, { 'if-match': '"1"' }],
    ['POST', '/v1/team/invitations', { email: 'someone@example.test', role: 'estimator' }, {}],
    ['PUT', '/v1/flags/crm.leads', { enabled: false }, {}],
    [
      'PUT',
      '/v1/orgs/current/settings/general',
      { settings: { workRegions: [] } },
      { 'if-match': '"1"' },
    ],
  ] as const)('read_only cannot write: %s %s', async (method, url, body, headers) => {
    const a = await createCompany(ctx, { roles: ['read_only'] });
    const res = await call(ctx, method, url, { as: a.as('read_only'), body, headers });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  it('read_only can still read and manage only their own notification preferences', async () => {
    const a = await createCompany(ctx, { roles: ['read_only'] });
    expect((await call(ctx, 'GET', '/v1/team/members', { as: a.as('read_only') })).statusCode).toBe(
      200,
    );
    const prefs = await call(ctx, 'PUT', '/v1/notifications/preferences', {
      as: a.as('read_only'),
      body: { preferences: [{ category: 'invitation', channel: 'email', enabled: false }] },
    });
    expect(prefs.statusCode).toBe(200);
  });

  it('reviewers cannot invite; admins cannot transfer ownership or change another admin', async () => {
    const a = await createCompany(ctx, { roles: ['reviewer', 'admin'] });
    const second = await createUser(ctx);
    const secondAdmin = await ctx.owner.client<{ id: string }[]>`
      insert into memberships (org_id, user_id, role) values (${a.orgId}, ${second.userId}, 'admin') returning id`;
    expect(
      (
        await call(ctx, 'POST', '/v1/team/invitations', {
          as: a.as('reviewer'),
          body: { email: 'x@example.test', role: 'estimator' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(ctx, 'POST', '/v1/team/transfer-ownership', {
          as: a.as('admin'),
          body: { toMembershipId: a.as('reviewer').membershipId, reason: 'try' },
        })
      ).statusCode,
    ).toBe(403);
    const change = await call(ctx, 'PATCH', `/v1/team/members/${secondAdmin[0]!.id}`, {
      as: a.as('admin'),
      body: { role: 'estimator' },
      headers: { 'if-match': '"1"' },
    });
    expect(change.statusCode).toBe(403);
  });

  it('the owner of record cannot be demoted or removed except by transfer', async () => {
    const a = await createCompany(ctx, { roles: ['admin'] });
    const demote = await call(ctx, 'PATCH', `/v1/team/members/${a.owner.membershipId}`, {
      as: a.owner,
      body: { role: 'admin' },
      headers: { 'if-match': '"1"' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().code).toBe('invalid_transition');
    const remove = await call(ctx, 'POST', `/v1/team/members/${a.owner.membershipId}/deactivate`, {
      as: a.as('admin'),
      body: { reason: 'nope' },
    });
    expect(remove.statusCode).toBe(409);
    const promote = await call(ctx, 'PATCH', `/v1/team/members/${a.as('admin').membershipId}`, {
      as: a.owner,
      body: { role: 'owner' },
      headers: { 'if-match': '"1"' },
    });
    expect(promote.statusCode).toBe(409);
  });
});

describe('PLT-015-QA team management with audit', () => {
  it('role changes are audited with actor, before/after and correlation id; stale If-Match is 412', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    const target = a.as('estimator');
    const res = await call(ctx, 'PATCH', `/v1/team/members/${target.membershipId}`, {
      as: a.owner,
      body: { role: 'reviewer' },
      headers: { 'if-match': '"1"', 'x-request-id': 'test-role-change-0001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('reviewer');
    expect(res.headers.etag).toBe('"2"');
    const [audit] = await auditRows(ctx, a.orgId, 'team.role_changed');
    expect(audit).toMatchObject({
      resource_type: 'membership',
      resource_id: target.membershipId,
      actor_user_id: a.owner.userId,
      before: { role: 'estimator' },
      after: { role: 'reviewer' },
      correlation_id: 'test-role-change-0001',
    });
    const stale = await call(ctx, 'PATCH', `/v1/team/members/${target.membershipId}`, {
      as: a.owner,
      body: { role: 'estimator' },
      headers: { 'if-match': '"1"' },
    });
    expect(stale.statusCode).toBe(412);
    // The new role applies on the member's very next request.
    const me = await call(ctx, 'GET', '/v1/me', { as: target });
    expect(me.json().activeRole).toBe('reviewer');
    expect(me.json().permissions).toContain('review_task:decide');
  });

  it('removing a member takes effect on their next request and queues the work-release job', async () => {
    const a = await createCompany(ctx, { roles: ['reviewer', 'admin'] });
    const reviewer = a.as('reviewer');
    expect((await call(ctx, 'GET', '/v1/team/members', { as: reviewer })).statusCode).toBe(200);
    // An active delegation to the reviewer ends with the membership.
    const delegation = await call(ctx, 'POST', '/v1/team/delegations', {
      as: a.owner,
      body: {
        fromMembershipId: a.owner.membershipId,
        toMembershipId: reviewer.membershipId,
        subjectTypes: ['estimate_revision'],
        endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        reason: 'Vacation cover',
      },
    });
    expect(delegation.statusCode).toBe(201);

    const removed = await call(
      ctx,
      'POST',
      `/v1/team/members/${reviewer.membershipId}/deactivate`,
      {
        as: a.as('admin'),
        body: { reason: 'Left the company' },
      },
    );
    expect(removed.statusCode).toBe(200);
    expect(removed.json().status).toBe('revoked');

    const next = await call(ctx, 'GET', '/v1/team/members', { as: reviewer });
    expect(next.statusCode).toBe(403);
    expect(next.json().code).toBe('membership_revoked');
    const me = await call(ctx, 'GET', '/v1/me', { as: reviewer });
    expect(me.statusCode).toBe(200);
    expect(me.json().activeOrgId).toBeNull();
    expect(me.json().permissions).toEqual([]);

    expect(await graphileJobs(a.orgId, 'membership.revoked')).toBe(1);
    const [del] = await ctx.owner.client<{ revoked_at: Date | null }[]>`
      select revoked_at from approval_delegations where id = ${delegation.json().id}`;
    expect(del?.revoked_at).not.toBeNull();
    const [audit] = await auditRows(ctx, a.orgId, 'team.member_deactivated');
    expect(audit?.reason).toBe('Left the company');
  });

  it('transfers ownership: target becomes owner, previous owner becomes admin, both audited', async () => {
    const a = await createCompany(ctx, { roles: ['admin'] });
    const res = await call(ctx, 'POST', '/v1/team/transfer-ownership', {
      as: a.owner,
      body: { toMembershipId: a.as('admin').membershipId, reason: 'Retiring founder' },
      headers: { 'idempotency-key': `transfer-${crypto.randomUUID()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().owner.role).toBe('owner');
    expect(res.json().previousOwner.role).toBe('admin');
    expect((await auditRows(ctx, a.orgId, 'org.ownership_transferred')).length).toBe(1);
    expect((await auditRows(ctx, a.orgId, 'team.role_changed')).length).toBe(2);
    // The former owner no longer holds owner-only power on the next request.
    const again = await call(ctx, 'POST', '/v1/team/transfer-ownership', {
      as: a.owner,
      body: { toMembershipId: a.as('admin').membershipId, reason: 'again' },
    });
    expect(again.statusCode).toBe(403);
  });
});

describe('PLT-015-QA invitations', () => {
  async function invite(
    company: Awaited<ReturnType<typeof createCompany>>,
    email: string,
    role = 'reviewer',
  ) {
    const res = await call(ctx, 'POST', '/v1/team/invitations', {
      as: company.owner,
      body: { email, role },
    });
    expect(res.statusCode).toBe(201);
    const token = new URL(res.json().acceptUrl).hash.replace('#token=', '');
    return { invitation: res.json(), token };
  }

  it('invite -> outbox email job -> accept by token: joins with the role and opens the company', async () => {
    const a = await createCompany(ctx);
    const { invitation, token } = await invite(a, 'New.Reviewer@example.test');
    expect(invitation.status).toBe('pending');
    expect(invitation.email).toBe('new.reviewer@example.test');
    expect(invitation).not.toHaveProperty('tokenHash');
    expect(await graphileJobs(a.orgId, 'invitation.send')).toBe(1);
    // The job payload carries a sealed token, never the clear token.
    const [job] = await ctx.owner.client<{ payload: Record<string, unknown> }[]>`
      select j.payload from graphile_worker._private_jobs j where j.payload ->> 'orgId' = ${a.orgId}`;
    expect(JSON.stringify(job?.payload)).not.toContain(token);

    const invitee = await createUser(ctx, { email: 'new.reviewer@example.test' });
    const session = await signIn(ctx, invitee.userId, null);
    // Preview before joining: company, role and status only; unknown tokens are 404.
    const preview = await call(ctx, 'POST', '/v1/invitations/preview', {
      as: session,
      body: { token },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ role: 'reviewer', status: 'pending' });
    expect(preview.json()).not.toHaveProperty('email');
    const bogus = await call(ctx, 'POST', '/v1/invitations/preview', {
      as: session,
      body: { token: `${token}x` },
    });
    expect(bogus.statusCode).toBe(404);
    const accepted = await call(ctx, 'POST', '/v1/invitations/accept', {
      as: session,
      body: { token },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ orgId: a.orgId, role: 'reviewer', status: 'active' });
    const me = await call(ctx, 'GET', '/v1/me', { as: session });
    expect(me.json().activeOrgId).toBe(a.orgId);
    expect(me.json().activeRole).toBe('reviewer');
    const actions = (await auditRows(ctx, a.orgId)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'team.invitation_created',
        'team.invitation_accepted',
        'team.member_added',
      ]),
    );
    // Accepting twice is harmless for the same person; a different person cannot reuse it.
    expect(
      (await call(ctx, 'POST', '/v1/invitations/accept', { as: session, body: { token } }))
        .statusCode,
    ).toBe(200);
    const other = await createUser(ctx);
    const otherSession = await signIn(ctx, other.userId, null);
    expect(
      (await call(ctx, 'POST', '/v1/invitations/accept', { as: otherSession, body: { token } }))
        .statusCode,
    ).toBe(404);
  });

  it('expired invitation: accept fails clearly, the inviter is notified, resend issues a fresh working link', async () => {
    const a = await createCompany(ctx);
    const { invitation, token } = await invite(a, 'late@example.test', 'estimator');
    await ctx.owner
      .client`update invitations set expires_at = now() - interval '1 hour' where id = ${invitation.id}`;
    const invitee = await createUser(ctx, { email: 'late@example.test' });
    const session = await signIn(ctx, invitee.userId, null);
    const res = await call(ctx, 'POST', '/v1/invitations/accept', { as: session, body: { token } });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toMatch(/expired/i);
    const inbox = await call(ctx, 'GET', '/v1/notifications', { as: a.owner });
    expect(inbox.json().items[0].title).toContain('late@example.test');
    // Listing shows it as expired; resend recovers.
    const list = await call(ctx, 'GET', '/v1/team/invitations', { as: a.owner });
    expect(list.json().items[0].status).toBe('expired');
    const resent = await call(ctx, 'POST', `/v1/team/invitations/${invitation.id}/resend`, {
      as: a.owner,
    });
    expect(resent.statusCode).toBe(200);
    const fresh = new URL(resent.json().acceptUrl).hash.replace('#token=', '');
    expect(fresh).not.toBe(token);
    expect(
      (await call(ctx, 'POST', '/v1/invitations/accept', { as: session, body: { token } }))
        .statusCode,
    ).toBe(404);
    const ok = await call(ctx, 'POST', '/v1/invitations/accept', {
      as: session,
      body: { token: fresh },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().role).toBe('estimator');
  });

  it('revoked invitations cannot be accepted; duplicates are refused', async () => {
    const a = await createCompany(ctx);
    const { invitation, token } = await invite(a, 'revoke-me@example.test');
    const dup = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { email: 'REVOKE-ME@example.test', role: 'reviewer' },
    });
    expect(dup.statusCode).toBe(409);
    const revoked = await call(ctx, 'POST', `/v1/team/invitations/${invitation.id}/revoke`, {
      as: a.owner,
    });
    expect(revoked.json().status).toBe('revoked');
    const invitee = await createUser(ctx);
    const session = await signIn(ctx, invitee.userId, null);
    expect(
      (await call(ctx, 'POST', '/v1/invitations/accept', { as: session, body: { token } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(ctx, 'POST', `/v1/team/invitations/${invitation.id}/resend`, { as: a.owner }))
        .statusCode,
    ).toBe(409);
  });

  it('only the owner may invite an admin; nobody may invite an owner', async () => {
    const a = await createCompany(ctx, { roles: ['admin'] });
    expect(
      (
        await call(ctx, 'POST', '/v1/team/invitations', {
          as: a.as('admin'),
          body: { email: 'adm@example.test', role: 'admin' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(ctx, 'POST', '/v1/team/invitations', {
          as: a.owner,
          body: { email: 'own@example.test', role: 'owner' },
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('BE-073-QA Idempotency-Key', () => {
  const body = { email: 'idem@example.test', role: 'estimator' };

  it('replays the stored response for the same key + body and creates exactly one record', async () => {
    const a = await createCompany(ctx);
    const key = `invite-${crypto.randomUUID()}`;
    const first = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body,
      headers: { 'idempotency-key': key },
    });
    const second = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body,
      headers: { 'idempotency-key': key },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from invitations where org_id = ${a.orgId}`;
    expect(row?.n).toBe(1);
    expect(await graphileJobs(a.orgId, 'invitation.send')).toBe(1);
  });

  it('same key with a different body is 422 idempotency_key_reused', async () => {
    const a = await createCompany(ctx);
    const key = `invite-${crypto.randomUUID()}`;
    await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body,
      headers: { 'idempotency-key': key },
    });
    const res = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { ...body, role: 'reviewer' },
      headers: { 'idempotency-key': key },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('idempotency_key_reused');
  });

  it('a duplicate while the first request is in flight is 409 with a retry hint', async () => {
    const a = await createCompany(ctx);
    const key = `invite-${crypto.randomUUID()}`;
    await ctx.owner.client`insert into idempotency_keys
      (org_id, key, method, path, request_hash, status, locked_until, expires_at)
      values (${a.orgId}, ${key}, 'POST', '/v1/team/invitations',
              ${requestFingerprint('POST', '/v1/team/invitations', body)}, 'in_progress',
              now() + interval '30 seconds', now() + interval '1 day')`;
    const res = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body,
      headers: { 'idempotency-key': key },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'idempotency_in_progress',
      retryable: true,
      retryAfterSeconds: 2,
    });
    expect(res.headers['retry-after']).toBe('2');
  });

  it('concurrent duplicates never create two records', async () => {
    const a = await createCompany(ctx);
    const key = `invite-${crypto.randomUUID()}`;
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        call(ctx, 'POST', '/v1/team/invitations', {
          as: a.owner,
          body,
          headers: { 'idempotency-key': key },
        }),
      ),
    );
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from invitations where org_id = ${a.orgId}`;
    expect(row?.n).toBe(1);
  });

  it('a failed attempt releases its key so the client can retry', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    const key = `invite-${crypto.randomUUID()}`;
    // Inviting an existing active member fails inside the handler (409 duplicate).
    const fail = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body: { email: a.as('estimator').email, role: 'reviewer' },
      headers: { 'idempotency-key': key },
    });
    expect(fail.statusCode).toBe(409);
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from idempotency_keys where org_id = ${a.orgId} and key = ${key}`;
    expect(row?.n).toBe(0);
  });

  it('rejects a malformed key', async () => {
    const a = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/team/invitations', {
      as: a.owner,
      body,
      headers: { 'idempotency-key': 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PLT-015-QA approval delegations with expiry', () => {
  it('creates, lists (active only by default), expires by time, and revokes', async () => {
    const a = await createCompany(ctx, { roles: ['reviewer'] });
    const tooLong = await call(ctx, 'POST', '/v1/team/delegations', {
      as: a.owner,
      body: {
        fromMembershipId: a.owner.membershipId,
        toMembershipId: a.as('reviewer').membershipId,
        subjectTypes: ['estimate_revision'],
        endsAt: new Date(Date.now() + 120 * 86_400_000).toISOString(),
        reason: 'Too long',
      },
    });
    expect(tooLong.statusCode).toBe(400);
    const created = await call(ctx, 'POST', '/v1/team/delegations', {
      as: a.owner,
      body: {
        fromMembershipId: a.owner.membershipId,
        toMembershipId: a.as('reviewer').membershipId,
        subjectTypes: ['estimate_revision', 'proposal_version'],
        maxAmountMinor: 500000,
        endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        reason: 'Owner traveling',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().maxAmount).toEqual({ amountMinor: 500000, currency: 'USD' });
    let list = await call(ctx, 'GET', '/v1/team/delegations', { as: a.as('reviewer') });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].active).toBe(true);

    await ctx.owner
      .client`update approval_delegations set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 days'
      where id = ${created.json().id}`;
    list = await call(ctx, 'GET', '/v1/team/delegations', { as: a.owner });
    expect(list.json().items).toHaveLength(0);
    list = await call(ctx, 'GET', '/v1/team/delegations?all=true', { as: a.owner });
    expect(list.json().items[0].active).toBe(false);

    const revoked = await call(ctx, 'POST', `/v1/team/delegations/${created.json().id}/revoke`, {
      as: a.owner,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().revokedAt).not.toBeNull();
    expect((await auditRows(ctx, a.orgId, 'team.delegation_created')).length).toBe(1);
    expect((await auditRows(ctx, a.orgId, 'team.delegation_revoked')).length).toBe(1);
  });
});
