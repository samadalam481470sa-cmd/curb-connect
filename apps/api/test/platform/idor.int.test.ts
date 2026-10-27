// BE-078-QA IDOR matrix: company B's owner (full power in B) cannot read or mutate company A's
// records in any module built so far, and every attempt is indistinguishable from a missing record
// (404, never 403). Also proves the restricted runtime role really is filtered by RLS.
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/db/runtime';
import { memberships } from '../../src/db/schema';
import { notify } from '../../src/services/notifications';
import { call, type Company, createCompany, createTestContext, sha256Hex, type TestContext } from '../helpers';

let ctx: TestContext;
let a: Company;
let b: Company;
const ids = {} as {
  invitation: string;
  delegation: string;
  upload: string;
  media: string;
  pendingUpload: string;
  notification: string;
};
let downloadPath = '';
let uploadPath = '';

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createCompany(ctx, { roles: ['reviewer', 'admin'] });
  b = await createCompany(ctx, { roles: ['admin'] });

  const inv = await call(ctx, 'POST', '/v1/team/invitations', {
    as: a.owner,
    body: { email: 'a-invitee@example.test', role: 'estimator' },
  });
  ids.invitation = inv.json().id;
  const del = await call(ctx, 'POST', '/v1/team/delegations', {
    as: a.owner,
    body: {
      fromMembershipId: a.owner.membershipId,
      toMembershipId: a.as('reviewer').membershipId,
      subjectTypes: ['estimate_revision'],
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: 'cover',
    },
  });
  ids.delegation = del.json().id;

  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#336699' } }).png().toBuffer();
  const intent = await call(ctx, 'POST', '/v1/media/uploads', {
    as: a.owner,
    body: {
      ownerType: 'organization',
      ownerId: a.orgId,
      fileName: 'a.png',
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
    },
  });
  ids.upload = intent.json().uploadId;
  ids.media = intent.json().mediaAssetId;
  uploadPath = new URL(intent.json().uploadUrl as string).pathname;
  await ctx.app.inject({
    method: 'PUT',
    url: uploadPath,
    headers: { cookie: a.owner.cookie, 'content-type': 'image/png' },
    payload: bytes,
  });
  const done = await call(ctx, 'POST', `/v1/media/uploads/${ids.upload}/complete`, { as: a.owner });
  downloadPath = new URL(done.json().viewUrl as string).pathname;
  // A second, still-pending upload in A.
  const pendingBytes = Buffer.concat([bytes, Buffer.from([0])]);
  const pending = await call(ctx, 'POST', '/v1/media/uploads', {
    as: a.owner,
    body: {
      ownerType: 'organization',
      ownerId: a.orgId,
      fileName: 'b.png',
      mimeType: 'image/png',
      sizeBytes: pendingBytes.length,
      sha256: sha256Hex(pendingBytes),
    },
  });
  ids.pendingUpload = pending.json().uploadId;
  uploadPath = new URL(pending.json().uploadUrl as string).pathname;

  const created = await withTenant(ctx.appDb.db, { orgId: a.orgId, userId: a.owner.userId }, (tx) =>
    notify(tx, {
      orgId: a.orgId,
      recipientMembershipId: a.owner.membershipId,
      category: 'system',
      title: 'For A only',
      dedupeKey: `idor-${crypto.randomUUID()}`,
      channels: ['in_app'],
    }),
  );
  ids.notification = created.created[0]!.id;
  await ctx.owner.client`update notifications set delivery_status = 'failed' where id = ${ids.notification}`;
});

afterAll(() => ctx?.close());

const as = () => b.owner;

describe('BE-078-QA company B cannot touch company A (404, not 403)', () => {
  const cases: [string, () => Promise<{ statusCode: number; json: () => { code?: string } }>][] = [
    ['GET member', () => call(ctx, 'GET', `/v1/team/members/${a.as('reviewer').membershipId}`, { as: as() })],
    [
      'PATCH member role',
      () =>
        call(ctx, 'PATCH', `/v1/team/members/${a.as('reviewer').membershipId}`, {
          as: as(),
          body: { role: 'admin' },
          headers: { 'if-match': '"1"' },
        }),
    ],
    [
      'deactivate member',
      () => call(ctx, 'POST', `/v1/team/members/${a.as('reviewer').membershipId}/deactivate`, { as: as(), body: { reason: 'x x x' } }),
    ],
    [
      'transfer ownership to A member',
      () =>
        call(ctx, 'POST', '/v1/team/transfer-ownership', {
          as: as(),
          body: { toMembershipId: a.as('admin').membershipId, reason: 'takeover' },
        }),
    ],
    ['revoke invitation', () => call(ctx, 'POST', `/v1/team/invitations/${ids.invitation}/revoke`, { as: as() })],
    ['resend invitation', () => call(ctx, 'POST', `/v1/team/invitations/${ids.invitation}/resend`, { as: as() })],
    ['revoke delegation', () => call(ctx, 'POST', `/v1/team/delegations/${ids.delegation}/revoke`, { as: as() })],
    [
      'delegate to an A member',
      () =>
        call(ctx, 'POST', '/v1/team/delegations', {
          as: as(),
          body: {
            fromMembershipId: b.owner.membershipId,
            toMembershipId: a.as('reviewer').membershipId,
            subjectTypes: ['estimate_revision'],
            endsAt: new Date(Date.now() + 86_400_000).toISOString(),
            reason: 'cross tenant',
          },
        }),
    ],
    ['GET media', () => call(ctx, 'GET', `/v1/media/${ids.media}`, { as: as() })],
    ['GET media content', () => call(ctx, 'GET', `/v1/media/${ids.media}/content`, { as: as() })],
    ['list media of A', () => call(ctx, 'GET', `/v1/media?ownerType=organization&ownerId=${a.orgId}`, { as: as() })],
    [
      'upload intent for A',
      () =>
        call(ctx, 'POST', '/v1/media/uploads', {
          as: as(),
          body: {
            ownerType: 'organization',
            ownerId: a.orgId,
            fileName: 'x.png',
            mimeType: 'image/png',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
          },
        }),
    ],
    ['complete A upload', () => call(ctx, 'POST', `/v1/media/uploads/${ids.pendingUpload}/complete`, { as: as() })],
    ['download A object via signed URL', () => call(ctx, 'GET', downloadPath, { as: as() })],
    [
      'PUT into A key via signed URL',
      () =>
        ctx.app.inject({
          method: 'PUT',
          url: uploadPath,
          headers: { cookie: as().cookie, 'content-type': 'image/png' },
          payload: Buffer.alloc(17),
        }),
    ],
    ['mark A notification read', () => call(ctx, 'POST', `/v1/notifications/${ids.notification}/read`, { as: as() })],
    [
      'retry A delivery failure',
      () => call(ctx, 'POST', `/v1/notifications/delivery-failures/${ids.notification}/retry`, { as: as() }),
    ],
    ['switch workspace to A', () => call(ctx, 'POST', '/v1/session/active-org', { as: as(), body: { orgId: a.orgId } })],
  ];

  it.each(cases)('%s -> 404', async (_label, run) => {
    const res = await run();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('A records are untouched after the attempts', async () => {
    const [m] = await ctx.owner.client<{ role: string; status: string }[]>`
      select role, status from memberships where id = ${a.as('reviewer').membershipId}`;
    expect(m).toEqual({ role: 'reviewer', status: 'active' });
    const [inv] = await ctx.owner.client<{ status: string }[]>`select status from invitations where id = ${ids.invitation}`;
    expect(inv?.status).toBe('pending');
    const [d] = await ctx.owner.client<{ revoked_at: Date | null }[]>`
      select revoked_at from approval_delegations where id = ${ids.delegation}`;
    expect(d?.revoked_at).toBeNull();
    const [n] = await ctx.owner.client<{ read_at: Date | null; delivery_status: string }[]>`
      select read_at, delivery_status from notifications where id = ${ids.notification}`;
    expect(n).toEqual({ read_at: null, delivery_status: 'failed' });
  });

  it('lists only show the caller company', async () => {
    const members = await call(ctx, 'GET', '/v1/team/members', { as: as() });
    const orgIds = new Set((members.json().items as { orgId: string }[]).map((m) => m.orgId));
    expect([...orgIds]).toEqual([b.orgId]);
    const invitations = await call(ctx, 'GET', '/v1/team/invitations', { as: as() });
    expect(invitations.json().items).toEqual([]);
    const audit = await call(ctx, 'GET', `/v1/audit-events?resourceId=${a.as('reviewer').membershipId}`, { as: as() });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().items).toEqual([]);
    const failures = await call(ctx, 'GET', '/v1/notifications/delivery-failures', { as: as() });
    expect(failures.json().items.map((f: { id: string }) => f.id)).not.toContain(ids.notification);
    const orgs = await call(ctx, 'GET', '/v1/orgs', { as: as() });
    expect(orgs.json().items.map((o: { id: string }) => o.id)).toEqual([b.orgId]);
  });

  it('A sees its own records (the matrix is not passing because everything is broken)', async () => {
    expect((await call(ctx, 'GET', `/v1/team/members/${a.as('reviewer').membershipId}`, { as: a.owner })).statusCode).toBe(200);
    expect((await call(ctx, 'GET', `/v1/media/${ids.media}`, { as: a.owner })).statusCode).toBe(200);
    expect((await call(ctx, 'GET', downloadPath, { as: a.owner })).statusCode).toBe(200);
  });
});

describe('BINDING DB ROLE RULE: the runtime connection is filtered by RLS', () => {
  it('the app connection is neither superuser nor BYPASSRLS', async () => {
    const [role] = await ctx.appDb.client<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(role).toEqual({ rolname: 'fieldline_app', rolsuper: false, rolbypassrls: false });
  });

  it('with app.org_id = B, an RLS-protected table returns zero rows of A even when asked by id', async () => {
    const rows = await withTenant(ctx.appDb.db, { orgId: b.orgId, userId: b.owner.userId }, async (tx) => {
      const { eq } = await import('drizzle-orm');
      return tx.select().from(memberships).where(eq(memberships.orgId, a.orgId));
    });
    expect(rows).toEqual([]);
    const own = await withTenant(ctx.appDb.db, { orgId: b.orgId, userId: b.owner.userId }, async (tx) => {
      const { eq } = await import('drizzle-orm');
      return tx.select().from(memberships).where(eq(memberships.orgId, b.orgId));
    });
    expect(own.length).toBe(2);
  });

  it('without any org context, tenant tables are empty', async () => {
    const rows = await withTenant(ctx.appDb.db, { orgId: null, userId: null }, (tx) => tx.select().from(memberships));
    expect(rows).toEqual([]);
  });

  it('a write into another org is rejected by the database', async () => {
    const err = await withTenant(ctx.appDb.db, { orgId: b.orgId, userId: b.owner.userId }, (tx) =>
      tx.insert(memberships).values({ orgId: a.orgId, userId: b.owner.userId, role: 'owner' }),
    ).catch((e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code);
    expect(err).toBe('42501');
  });
});
