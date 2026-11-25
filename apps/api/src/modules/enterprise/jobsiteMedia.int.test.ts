import { randomBytes, randomUUID } from 'node:crypto';
import { JOBSITE_PHOTO_CHUNK_BYTES } from '@fieldline/contracts';
import { Logger, runOnce } from 'graphile-worker';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  platformTestUrl,
  type Company,
  type TestContext,
  type TestSession,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';
import { sha256Hex, type MalwareScanner } from '../media/processing';

const chunkBytes = JOBSITE_PHOTO_CHUNK_BYTES;
const silent = new Logger(() => () => {});
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`delete from enterprise_suite.media_assets where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_upload_parts where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_upload_sessions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_project_grants where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.projects where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});
afterAll(async () => ctx?.close());

async function project(company: Company, label: string) {
  expect(
    (
      await call(ctx, 'PUT', '/v1/enterprise/status', {
        as: company.owner,
        body: { enabled: true },
      })
    ).statusCode,
  ).toBe(200);
  const result = await call(ctx, 'POST', '/v1/enterprise/projects', {
    as: company.owner,
    body: { name: label, originalContractMinor: 0 },
  });
  expect(result.statusCode, result.body).toBe(201);
  return '/v1/enterprise/projects/' + result.json().id + '/media';
}

async function enable(company: Company) {
  const response = await call(ctx, 'PUT', '/v1/flags/enterprise.jobsite_media', {
    as: company.owner,
    body: { enabled: true, rolloutNote: 'Private test tenant.' },
  });
  expect(response.statusCode, response.body).toBe(200);
}

const revision = (value: number) => ({ 'if-match': '"' + value + '"' });

function manifest(bytes: Buffer) {
  return {
    localCaptureId: randomUUID(),
    filename: 'jobsite-original.png',
    mimeType: 'image/png',
    byteSize: bytes.length,
    sha256: sha256Hex(bytes),
    capturedAt: '2026-11-20T15:00:00.000Z',
  };
}

function part(path: string, index: number, bytes: Buffer, expected: number, as: TestSession) {
  return call(ctx, 'PUT', path + '/parts/' + index, {
    as,
    headers: revision(expected),
    body: { sha256: sha256Hex(bytes), contentBase64: bytes.toString('base64') },
  });
}

async function drainScans(scanner: MalwareScanner | null) {
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: buildTaskList({
      platformDb: ctx.platformDb.db,
      mail: ctx.mail,
      mailer: createMailerClient(null),
      config: ctx.config,
      jobsiteMedia: { storage: ctx.storage, scanner },
    }),
    noHandleSignals: true,
    logger: silent,
  });
}

describe('Enterprise jobsite photo uploads', () => {
  it('resumes an interrupted project photo upload and publishes one scanned original', async () => {
    const company = await createCompany(ctx, { roles: ['crew_manager', 'reviewer'] });
    const outsider = await createCompany(ctx);
    const path = await project(company, 'Assigned project');
    const otherPath = await project(company, 'Unassigned project');
    await project(outsider, 'Other company project');
    await enable(outsider);
    const disabled = await call(ctx, 'GET', path, { as: company.owner });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json().code).toBe('feature_unavailable');
    await enable(company);
    const field = company.as('crew_manager');
    const reviewer = company.as('reviewer');
    const grantPath = path + '/grants/' + field.membershipId;
    const uploadPath = path + '/upload-sessions';
    const bytes = await sharp(randomBytes(768 * 768 * 3), {
      raw: { width: 768, height: 768, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(bytes.length).toBeGreaterThan(chunkBytes);
    const input = manifest(bytes);
    const start = (as: TestSession, route = uploadPath, body = input) =>
      call(ctx, 'POST', route, {
        as,
        headers: revision(0),
        body,
      });

    expect((await start(field)).statusCode).toBe(404);
    expect((await start(reviewer)).statusCode).toBe(403);
    expect((await start(outsider.owner)).statusCode).toBe(404);
    const grantBody = {
      active: true,
      reason: 'Assign this supervisor to the jobsite.',
      clientRequestId: randomUUID(),
    };
    expect(
      (
        await call(ctx, 'PUT', grantPath, {
          as: field,
          headers: revision(0),
          body: grantBody,
        })
      ).statusCode,
    ).toBe(403);
    const setGrant = (body: typeof grantBody, expected: number) =>
      call(ctx, 'PUT', grantPath, {
        as: company.owner,
        headers: revision(expected),
        body,
      });
    const grant = await setGrant(grantBody, 0);
    expect(grant.statusCode, grant.body).toBe(200);
    expect((await setGrant(grantBody, 0)).json()).toEqual(grant.json());
    expect((await setGrant({ ...grantBody, clientRequestId: randomUUID() }, 0)).statusCode).toBe(
      412,
    );
    expect((await start(field, otherPath + '/upload-sessions')).statusCode).toBe(404);

    const created = await start(field);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ revision: 1, totalParts: 2, receivedParts: [] });
    const id = created.json().id as string;
    const session = uploadPath + '/' + id;
    expect((await start(field)).json().id).toBe(id);
    expect((await start(field, undefined, { ...input, filename: 'changed.png' })).statusCode).toBe(
      409,
    );
    expect((await call(ctx, 'GET', session, { as: company.owner })).statusCode).toBe(404);

    const firstBytes = bytes.subarray(0, chunkBytes);
    const secondBytes = bytes.subarray(chunkBytes);
    const first = await part(session, 0, firstBytes, 1, field);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ id, revision: 2, receivedParts: [0] });
    const resumed = await call(ctx, 'GET', session, { as: field });
    expect(resumed.json()).toEqual(first.json());
    expect((await part(session, 0, firstBytes, 1, field)).json()).toEqual(resumed.json());
    expect((await part(session, 0, Buffer.alloc(firstBytes.length), 2, field)).statusCode).toBe(
      409,
    );
    expect((await part(session, 1, secondBytes, 1, field)).statusCode).toBe(412);

    const finish = (expected: number, clientRequestId: string) =>
      call(ctx, 'POST', session + '/finalize', {
        as: field,
        headers: revision(expected),
        body: { clientRequestId },
      });
    const finishId = randomUUID();
    expect((await finish(2, finishId)).statusCode).toBe(409);
    const second = await part(session, 1, secondBytes, 2, field);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ revision: 3, receivedParts: [0, 1] });
    const [firstFinish, repeatedFinish] = await Promise.all([
      finish(3, finishId),
      finish(3, finishId),
    ]);
    expect([firstFinish.statusCode, repeatedFinish.statusCode].sort()).toEqual([200, 201]);
    expect(firstFinish.json()).toMatchObject({ id, scanState: 'pending', sha256: input.sha256 });
    expect(repeatedFinish.json()).toEqual(firstFinish.json());

    const original = path + '/' + id + '/original';
    expect((await call(ctx, 'GET', original, { as: field })).statusCode).toBe(409);
    const scanned: string[] = [];
    await drainScans({
      name: 'fixture',
      async scan(data) {
        scanned.push(sha256Hex(data));
        return 'clean';
      },
    });
    expect(scanned).toEqual([input.sha256]);

    const read = await call(ctx, 'GET', original, { as: field });
    expect(read.statusCode, read.body.slice(0, 200)).toBe(200);
    expect(read.rawPayload).toEqual(bytes);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect((await call(ctx, 'GET', original, { as: outsider.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'GET', original, { as: reviewer })).statusCode).toBe(404);
    const list = await call(ctx, 'GET', path, { as: company.owner });
    expect(list.json().items).toEqual([
      expect.objectContaining({
        id,
        sha256: input.sha256,
        scanState: 'clean',
        uploaderUserId: field.userId,
      }),
    ]);
    const events = await ctx.owner.client`
      select status from public.domain_events
      where org_id = ${company.orgId} and aggregate_id = ${id} and event_type = 'enterprise_media.scan'
    `;
    expect(events).toEqual([{ status: 'dispatched' }]);
    const decisions = await ctx.owner.client`
      select action from public.audit_events where org_id = ${company.orgId} and resource_id = ${id}
      and action in ('media.capture_registered', 'media.upload_completed', 'media.scan_completed')
      order by action
    `;
    expect(decisions.map(({ action }) => action)).toEqual([
      'media.capture_registered',
      'media.scan_completed',
      'media.upload_completed',
    ]);

    const revoke = await setGrant(
      {
        active: false,
        reason: 'Finish the project assignment.',
        clientRequestId: randomUUID(),
      },
      1,
    );
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect((await call(ctx, 'GET', original, { as: field })).statusCode).toBe(404);
    expect((await call(ctx, 'GET', session, { as: field })).statusCode).toBe(404);
    expect((await call(ctx, 'GET', original, { as: company.owner })).rawPayload).toEqual(bytes);
  }, 60_000);

  it('withholds a finalized photo when no scanner is configured', async () => {
    const company = await createCompany(ctx);
    const path = await project(company, 'Scanner unavailable project');
    await enable(company);
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const started = await call(ctx, 'POST', path + '/upload-sessions', {
      as: company.owner,
      headers: revision(0),
      body: manifest(bytes),
    });
    expect(started.statusCode, started.body).toBe(201);
    const id = started.json().id as string;
    const upload = path + '/upload-sessions/' + id;
    expect((await part(upload, 0, bytes, 1, company.owner)).statusCode).toBe(200);
    const final = await call(ctx, 'POST', upload + '/finalize', {
      as: company.owner,
      headers: revision(2),
      body: { clientRequestId: randomUUID() },
    });
    expect(final.statusCode, final.body).toBe(201);
    await drainScans(null);
    const listed = await call(ctx, 'GET', path, { as: company.owner });
    expect(listed.json().items).toMatchObject([{ id, scanState: 'scan_failed' }]);
    expect(
      (await call(ctx, 'GET', path + '/' + id + '/original', { as: company.owner })).statusCode,
    ).toBe(409);
  }, 30_000);
});
