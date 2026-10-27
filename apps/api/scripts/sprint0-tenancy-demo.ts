// Sprint 0 tenancy walk-through over real HTTP (no browser, no database access).
//
//   npm run demo:sprint0 -w @fieldline/api
//
// Needs the running stack: API (API_URL, default http://localhost:4000) and the dev IdP
// (http://localhost:4100), with the demo seed applied. Every identity is a fictional seeded test
// identity of the local stand-in IdP; nothing here talks to a real sign-in provider.
//
// Story (PLT-011/012/013/015, BE-078):
//   1. Company A owner signs in through the dev IdP (authorization code + PKCE, driven by the API).
//   2. Owner creates a new company and invites a reviewer.
//   3. Reviewer signs in, previews and accepts the invitation, and lands in that company.
//   4. Company B owner signs in and cannot list or fetch any of that company's resources (404s).
//   5. Owner revokes the reviewer; the reviewer's very next request is denied.
// Exits non-zero on the first broken expectation.
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:4000';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3000';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}
function fatal(message: string): never {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

/** Minimal per-origin cookie jar: name=value only, enough for the session and OIDC cookies. */
class Jar {
  private readonly cookies = new Map<string, Map<string, string>>();
  store(origin: string, res: Response): void {
    const bag = this.cookies.get(origin) ?? new Map<string, string>();
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (value === '' || /max-age=0/i.test(line)) bag.delete(name);
      else bag.set(name, value);
    }
    this.cookies.set(origin, bag);
  }
  header(origin: string): string {
    return [...(this.cookies.get(origin) ?? new Map()).entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

interface Person {
  label: string;
  jar: Jar;
}

async function signIn(sub: string, label: string): Promise<Person> {
  const jar = new Jar();
  const apiOrigin = new URL(API).origin;
  let res = await fetch(`${API}/v1/auth/login/dev?returnTo=%2F`, { redirect: 'manual' });
  jar.store(apiOrigin, res);
  if (res.status !== 302) fatal(`${label}: login start returned ${res.status}`);
  let next = new URL(res.headers.get('location')!);
  const idpOrigin = next.origin;
  // Authorization endpoint -> interaction (login screen).
  for (let hop = 0; hop < 5 && !next.pathname.startsWith('/interaction/'); hop += 1) {
    res = await fetch(next, { headers: { cookie: jar.header(idpOrigin) }, redirect: 'manual' });
    jar.store(idpOrigin, res);
    next = new URL(res.headers.get('location')!, idpOrigin);
  }
  if (!next.pathname.startsWith('/interaction/'))
    fatal(`${label}: dev IdP did not show a login screen`);
  res = await fetch(`${next.href.replace(/\/$/, '')}/login`, {
    method: 'POST',
    headers: { cookie: jar.header(idpOrigin), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub }),
    redirect: 'manual',
  });
  jar.store(idpOrigin, res);
  next = new URL(res.headers.get('location')!, idpOrigin);
  for (let hop = 0; hop < 6 && next.origin === idpOrigin; hop += 1) {
    res = await fetch(next, { headers: { cookie: jar.header(idpOrigin) }, redirect: 'manual' });
    jar.store(idpOrigin, res);
    next = new URL(res.headers.get('location')!, idpOrigin);
  }
  if (next.origin !== apiOrigin)
    fatal(`${label}: IdP redirected to ${next.origin}, expected the API callback`);
  res = await fetch(next, { headers: { cookie: jar.header(apiOrigin) }, redirect: 'manual' });
  jar.store(apiOrigin, res);
  if (res.status !== 302 || !jar.header(apiOrigin).includes('fl_session=')) {
    fatal(`${label}: callback returned ${res.status} without a session (${await res.text()})`);
  }
  return { label, jar };
}

interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function call(
  who: Person,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const origin = new URL(API).origin;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie: who.jar.header(origin),
      origin: APP_ORIGIN,
      'x-request-id': randomUUID(),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: parsed };
}

const describe = (r: Reply) => `${r.status}${r.body?.code ? ` ${r.body.code}` : ''}`;

async function main(): Promise<void> {
  const health = await fetch(`${API}/v1/health`).catch(() => null);
  if (!health?.ok) fatal(`API not reachable at ${API} (start it with npm run dev:api)`);

  console.log('== 1. Company A owner signs in through the dev IdP');
  const ownerA = await signIn('demo-roof-owner', 'Company A owner');
  const meA = await call(ownerA, 'GET', '/v1/me');
  check('owner A /v1/me', meA.status === 200, `${meA.body.user?.email}`);

  console.log('== 2. Owner creates a company and invites a reviewer');
  const created = await call(
    ownerA,
    'POST',
    '/v1/orgs',
    {
      legalName: 'Sprint Zero Demo Roofing (Demo) LLC',
      displayName: 'Sprint Zero Demo Roofing (Demo)',
      productLines: ['roof'],
      timezone: 'America/Chicago',
      currency: 'USD',
      measurementSystem: 'imperial',
    },
    { 'idempotency-key': randomUUID() },
  );
  check('create organization', created.status === 201 || created.status === 200, describe(created));
  const orgId: string = created.body.id;
  const meAfter = await call(ownerA, 'GET', '/v1/me');
  check('new company is the active workspace', meAfter.body.activeOrgId === orgId, orgId);
  check('creator is its owner', meAfter.body.activeRole === 'owner', meAfter.body.activeRole);

  const invite = await call(
    ownerA,
    'POST',
    '/v1/team/invitations',
    { email: 'demo-roof-reviewer@example.test', role: 'reviewer' },
    { 'idempotency-key': randomUUID() },
  );
  check('invite reviewer', invite.status === 201, describe(invite));
  const invitationId: string = invite.body.id;
  const token = new URL(invite.body.acceptUrl).hash.replace('#token=', '');
  check('invitation response has no token hash', !('tokenHash' in invite.body));

  console.log('== 3. Reviewer signs in, previews and accepts');
  const reviewer = await signIn('demo-roof-reviewer', 'Reviewer');
  const preview = await call(reviewer, 'POST', '/v1/invitations/preview', { token });
  check(
    'preview shows company and role',
    preview.status === 200 && preview.body.role === 'reviewer',
    describe(preview),
  );
  const accepted = await call(
    reviewer,
    'POST',
    '/v1/invitations/accept',
    { token },
    { 'idempotency-key': randomUUID() },
  );
  check(
    'accept invitation',
    accepted.status === 200 && accepted.body.orgId === orgId,
    describe(accepted),
  );
  const reviewerMembershipId: string = accepted.body.membershipId;
  const meR = await call(reviewer, 'GET', '/v1/me');
  check(
    'reviewer active in the new company',
    meR.body.activeOrgId === orgId && meR.body.activeRole === 'reviewer',
  );
  const orgR = await call(reviewer, 'GET', '/v1/orgs/current');
  check('reviewer can read the company', orgR.status === 200, describe(orgR));

  console.log('== 4. Company B owner cannot see any of it');
  const ownerB = await signIn('demo-curb-owner', 'Company B owner');
  const meB = await call(ownerB, 'GET', '/v1/me');
  check(
    'owner B signed in to their own company',
    meB.status === 200 && meB.body.activeOrgId !== orgId,
    meB.body.activeOrgId,
  );
  check(
    'owner B has no membership in the new company',
    !(meB.body.memberships ?? []).some((m: { orgId: string }) => m.orgId === orgId),
  );
  const switchB = await call(ownerB, 'POST', '/v1/session/active-org', { orgId });
  check('B cannot switch into the company (404)', switchB.status === 404, describe(switchB));
  const memberB = await call(ownerB, 'GET', `/v1/team/members/${reviewerMembershipId}`);
  check("B fetch of A's member (404)", memberB.status === 404, describe(memberB));
  const patchB = await call(
    ownerB,
    'PATCH',
    `/v1/team/members/${reviewerMembershipId}`,
    { role: 'estimator' },
    { 'if-match': '"1"' },
  );
  check("B update of A's member (404)", patchB.status === 404, describe(patchB));
  const revokeInvB = await call(ownerB, 'POST', `/v1/team/invitations/${invitationId}/revoke`);
  check("B revoke of A's invitation (404)", revokeInvB.status === 404, describe(revokeInvB));
  const deactB = await call(ownerB, 'POST', `/v1/team/members/${reviewerMembershipId}/deactivate`, {
    reason: 'probe',
  });
  check("B deactivate of A's member (404)", deactB.status === 404, describe(deactB));
  const listB = await call(ownerB, 'GET', '/v1/team/members?limit=100');
  check(
    'B member list contains no A rows',
    listB.status === 200 &&
      !listB.body.items.some((m: { id: string }) => m.id === reviewerMembershipId),
    `${listB.body.items?.length} rows`,
  );
  const invListB = await call(ownerB, 'GET', '/v1/team/invitations?limit=100');
  check(
    'B invitation list contains no A rows',
    invListB.status === 200 &&
      !invListB.body.items.some((i: { id: string }) => i.id === invitationId),
  );
  const orgsB = await call(ownerB, 'GET', '/v1/orgs');
  const orgItems: { id: string }[] = orgsB.body.items ?? orgsB.body ?? [];
  check(
    'B company list excludes the new company',
    orgsB.status === 200 && !orgItems.some((o) => o.id === orgId),
  );

  console.log('== 5. Owner revokes the reviewer; next request is denied');
  const revoke = await call(ownerA, 'POST', `/v1/team/members/${reviewerMembershipId}/deactivate`, {
    reason: 'Sprint 0 tenancy demo',
  });
  check(
    'owner revokes reviewer',
    revoke.status === 200 && revoke.body.status === 'revoked',
    describe(revoke),
  );
  const denied = await call(reviewer, 'GET', '/v1/orgs/current');
  check(
    "reviewer's next request is denied",
    denied.status === 403 || denied.status === 401,
    describe(denied),
  );
  const switchBack = await call(reviewer, 'POST', '/v1/session/active-org', { orgId });
  check(
    'reviewer cannot re-enter the company',
    switchBack.status === 403 || switchBack.status === 404,
    describe(switchBack),
  );

  console.log(
    failures === 0
      ? '\nSprint 0 tenancy demo: all checks passed'
      : `\nSprint 0 tenancy demo: ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
