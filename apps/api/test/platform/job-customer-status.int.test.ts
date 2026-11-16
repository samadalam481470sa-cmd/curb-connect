// Customer job-status links: the contractor shares a secret link, posts updates, and the customer
// reads the job without an account. Runs against real RLS (restricted app role).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';

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

type Person = Awaited<ReturnType<typeof createCompany>>['owner'];

async function makeJob(as: Person, title = 'Roof replacement - 12 Oak St') {
  const res = await call(ctx, 'POST', '/v1/jobs', {
    as,
    body: { title, productLine: 'roof', estimatedValueMinor: 1_850_000 },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; number: string };
}

async function share(as: Person, jobId: string, body: Record<string, unknown> = {}) {
  const res = await call(ctx, 'POST', `/v1/jobs/${jobId}/customer-links`, { as, body });
  expect(res.statusCode).toBe(201);
  const json = res.json() as { url: string; link: { id: string; state: string } };
  const token = new URL(json.url).hash.replace(/^#t=/, '');
  return { ...json, token };
}

const view = (token: string) => call(ctx, 'POST', '/v1/portal/job-status', { body: { token } });

describe('Customer job-status links', () => {
  it('shares a link, posts updates and shows the customer only safe fields', async () => {
    const company = await createCompany(ctx, { displayName: 'Lone Star Roofing (test)' });
    const job = await makeJob(company.owner);
    const link = await share(company.owner, job.id, {
      recipientName: 'Dana',
      recipientEmail: 'Dana@Example.com',
    });
    expect(link.url).toMatch(/\/track#t=[A-Za-z0-9_-]{43}$/);
    expect(link.link.state).toBe('active');

    const first = await view(link.token);
    expect(first.statusCode).toBe(200);
    const status = first.json() as Record<string, unknown> & {
      company: { name: string };
      job: { stage: string; stageLabel: string; number: string; completed: boolean };
      updates: unknown[];
      recipientName: string | null;
    };
    expect(status.company.name).toBe('Lone Star Roofing (test)');
    expect(status.job).toMatchObject({
      stage: 'intake',
      stageLabel: 'Request received',
      number: job.number,
      completed: false,
    });
    expect(status.updates).toEqual([]);
    expect(status.recipientName).toBe('Dana');
    // Nothing internal: no ids of the job or company, no money, no contact email.
    const raw = first.body;
    expect(raw).not.toContain(job.id);
    expect(raw).not.toContain(company.orgId);
    expect(raw).not.toContain('1850000');
    expect(raw.toLowerCase()).not.toContain('dana@example.com');
    expect(first.headers['cache-control']).toContain('no-store');

    const posted = await call(ctx, 'POST', `/v1/jobs/${job.id}/customer-updates`, {
      as: company.owner,
      body: { message: 'Materials ordered. Crew starts Monday at 8am.', stage: 'scheduled' },
    });
    expect(posted.statusCode).toBe(201);
    expect((posted.json() as { job: { stage: string } }).job.stage).toBe('scheduled');
    await call(ctx, 'POST', `/v1/jobs/${job.id}/customer-updates`, {
      as: company.owner,
      body: { message: 'Tear-off finished, new decking going on.', stage: 'in_progress' },
    });

    const second = (await view(link.token)).json() as {
      job: { stage: string; stageLabel: string };
      updates: { stage: string; message: string }[];
    };
    expect(second.job).toMatchObject({ stage: 'in_progress', stageLabel: 'Work in progress' });
    expect(second.updates.map((u) => [u.stage, u.message])).toEqual([
      ['in_progress', 'Tear-off finished, new decking going on.'],
      ['scheduled', 'Materials ordered. Crew starts Monday at 8am.'],
    ]);

    // The stage moves are in the job timeline like any other stage change.
    const events = await ctx.owner.client<{ event_type: string; to_stage: string | null }[]>`
      select event_type, to_stage from job_events where job_id = ${job.id}::uuid order by occurred_at, id`;
    expect(events.map((e) => e.to_stage)).toEqual(['intake', 'scheduled', 'in_progress']);

    // Owner view lists the link with its view count, never the token.
    const owner = await call(ctx, 'GET', `/v1/jobs/${job.id}/customer-status`, {
      as: company.owner,
    });
    expect(owner.statusCode).toBe(200);
    const ownerJson = owner.json() as {
      links: { id: string; viewCount: number; recipientEmail: string; state: string }[];
      updates: unknown[];
      emailEnabled: boolean;
    };
    expect(ownerJson.updates).toHaveLength(2);
    expect(ownerJson.links).toHaveLength(1);
    expect(ownerJson.links[0]).toMatchObject({
      viewCount: 2,
      recipientEmail: 'dana@example.com',
      state: 'active',
    });
    expect(owner.body).not.toContain(link.token);
    const [stored] = await ctx.owner.client<{ token_hash: string; sealed_token: string }[]>`
      select token_hash, sealed_token from portal_tokens where id = ${link.link.id}::uuid`;
    expect(stored?.token_hash).not.toContain(link.token);
    expect(stored?.sealed_token).not.toContain(link.token);
  });

  it('turns a link off immediately when revoked, and rejects unknown or expired links alike', async () => {
    const company = await createCompany(ctx);
    const job = await makeJob(company.owner);
    const link = await share(company.owner, job.id);
    expect((await view(link.token)).statusCode).toBe(200);

    const revoked = await call(
      ctx,
      'POST',
      `/v1/jobs/${job.id}/customer-links/${link.link.id}/revoke`,
      {
        as: company.owner,
      },
    );
    expect(revoked.statusCode).toBe(200);
    expect((revoked.json() as { link: { state: string } }).link.state).toBe('revoked');
    expect((await view(link.token)).statusCode).toBe(404);
    const again = await call(
      ctx,
      'POST',
      `/v1/jobs/${job.id}/customer-links/${link.link.id}/revoke`,
      {
        as: company.owner,
      },
    );
    expect(again.statusCode).toBe(404);

    const unknown = await view('x'.repeat(43));
    expect(unknown.statusCode).toBe(404);

    const expiring = await share(company.owner, job.id, { expiresInDays: 1 });
    await ctx.owner.client`update portal_tokens set expires_at = now() - interval '1 minute'
      where id = ${expiring.link.id}::uuid`;
    expect((await view(expiring.token)).statusCode).toBe(404);
  });

  it('keeps every company to its own jobs and respects roles', async () => {
    const a = await createCompany(ctx, { roles: ['read_only'] });
    const b = await createCompany(ctx);
    const job = await makeJob(a.owner);

    // Another company cannot read, update or share company A's job (404, not 403).
    for (const [method, url, body] of [
      ['GET', `/v1/jobs/${job.id}/customer-status`, undefined],
      ['POST', `/v1/jobs/${job.id}/customer-updates`, { message: 'hijack' }],
      ['POST', `/v1/jobs/${job.id}/customer-links`, {}],
    ] as const) {
      const res = await call(ctx, method, url, { as: b.owner, ...(body && { body }) });
      expect(res.statusCode).toBe(404);
    }

    // A read-only member may look but not post updates or share links.
    const viewer = a.as('read_only');
    expect(
      (await call(ctx, 'GET', `/v1/jobs/${job.id}/customer-status`, { as: viewer })).statusCode,
    ).toBe(200);
    expect(
      (
        await call(ctx, 'POST', `/v1/jobs/${job.id}/customer-updates`, {
          as: viewer,
          body: { message: 'hi' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(ctx, 'POST', `/v1/jobs/${job.id}/customer-links`, { as: viewer, body: {} }))
        .statusCode,
    ).toBe(403);

    // Signed out: owner routes need a session; the customer route does not.
    expect((await call(ctx, 'GET', `/v1/jobs/${job.id}/customer-status`)).statusCode).toBe(401);
  });

  it('validates input', async () => {
    const company = await createCompany(ctx);
    const job = await makeJob(company.owner);
    const bad = [
      ['/customer-updates', { message: '' }],
      ['/customer-updates', { message: 'ok', stage: 'demolished' }],
      ['/customer-updates', { message: 'x'.repeat(2001) }],
      ['/customer-links', { recipientEmail: 'not-an-email' }],
      ['/customer-links', { expiresInDays: 0 }],
      ['/customer-links', { expiresInDays: 400 }],
    ] as const;
    for (const [path, body] of bad) {
      const res = await call(ctx, 'POST', `/v1/jobs/${job.id}${path}`, { as: company.owner, body });
      expect(res.statusCode, `${path} ${JSON.stringify(body).slice(0, 60)}`).toBe(400);
    }
    expect(
      (await call(ctx, 'POST', '/v1/portal/job-status', { body: { token: 'short' } })).statusCode,
    ).toBe(400);
  });
});
