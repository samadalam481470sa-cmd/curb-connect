import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const videoFixture = process.env.FIELDPRO_TEST_JOBSITE_VIDEO;
const visionUrl = process.env.FIELDPRO_TEST_VISION_URL;
const visionToken = process.env.VISION_SERVICE_TOKEN;
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext(
    visionUrl && visionToken
      ? { env: { VISION_URL: visionUrl, VISION_SERVICE_TOKEN: visionToken } }
      : {},
  );
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`delete from enterprise_suite.media_caption_revisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_video_derivatives where org_id = any(${orgIds}::uuid[])`;
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

describe('Enterprise jobsite video uploads', () => {
  it.skipIf(!videoFixture || !visionUrl || !visionToken)(
    'resumes a real video and serves one verified playback revision from the private worker',
    async () => {
      const company = await createCompany(ctx, { roles: ['reviewer'] });
      const path = await project(company, 'Resumable video jobsite');
      await enable(company);
      if (!videoFixture) throw new Error('The source video fixture is missing.');
      const bytes = await readFile(videoFixture);
      expect(bytes.length).toBeGreaterThan(2 * chunkBytes);
      const input = {
        ...manifest(bytes),
        filename: 'source-video.mp4',
        mimeType: 'video/mp4',
        durationMs: 2400,
      };
      const start = (body = input) =>
        call(ctx, 'POST', path + '/upload-sessions', {
          as: company.owner,
          headers: revision(0),
          body,
        });
      expect((await start({ ...input, durationMs: 60_001 })).statusCode).toBe(400);
      const registered = await start();
      expect(registered.statusCode, registered.body).toBe(201);
      const id = registered.json().id as string;
      const upload = path + '/upload-sessions/' + id;
      expect(
        (await part(upload, 0, bytes.subarray(0, chunkBytes), 1, company.owner)).statusCode,
      ).toBe(200);
      const recovered = await start();
      expect(recovered.statusCode, recovered.body).toBe(200);
      expect(recovered.json()).toMatchObject({
        id,
        revision: 2,
        receivedParts: [0],
        totalParts: 3,
      });
      let current = recovered.json().revision as number;
      for (const index of [1, 2]) {
        const response = await part(
          upload,
          index,
          bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes),
          current,
          company.owner,
        );
        expect(response.statusCode, response.body).toBe(200);
        current = response.json().revision;
      }
      const finishId = randomUUID();
      const finalize = () =>
        call(ctx, 'POST', upload + '/finalize', {
          as: company.owner,
          headers: revision(current),
          body: { clientRequestId: finishId },
        });
      const finalized = await finalize();
      expect(finalized.statusCode, finalized.body).toBe(201);
      expect(finalized.json()).toMatchObject({
        id,
        scanState: 'pending',
        videoState: 'queued',
        playback: null,
        sha256: input.sha256,
      });
      expect((await finalize()).json()).toEqual(finalized.json());
      const playbackPath = path + '/' + id + '/playback';
      expect((await call(ctx, 'GET', playbackPath, { as: company.owner })).statusCode).toBe(409);
      expect(
        (await call(ctx, 'GET', playbackPath, { as: company.as('reviewer') })).statusCode,
      ).toBe(404);

      const observed: string[] = [];
      await drainScans({
        name: 'fixture',
        async scan(content) {
          observed.push(sha256Hex(content));
          return 'clean';
        },
      });
      const library = await call(ctx, 'GET', path, { as: company.owner });
      expect(library.statusCode, library.body).toBe(200);
      const items = library.json().items;
      expect(observed).toEqual([input.sha256]);
      expect(items).toMatchObject([
        {
          id,
          scanState: 'clean',
          videoState: 'ready',
          declaredDurationMs: 2400,
          sha256: input.sha256,
          playback: { version: 1, durationMs: 2400, width: 960, height: 540 },
        },
      ]);
      expect(items[0].playback.sha256).not.toBe(input.sha256);

      const stream = await call(ctx, 'GET', playbackPath, { as: company.owner });
      expect(stream.statusCode).toBe(200);
      expect(stream.headers['content-type']).toBe('video/mp4');
      expect(sha256Hex(stream.rawPayload)).toBe(items[0].playback.sha256);
      const range = await call(ctx, 'GET', playbackPath, {
        as: company.owner,
        headers: { range: 'bytes=12-49' },
      });
      expect(range.statusCode).toBe(206);
      expect(range.headers['content-range']).toBe('bytes 12-49/' + stream.rawPayload.length);
      expect(range.rawPayload).toEqual(stream.rawPayload.subarray(12, 50));
      const invalidRange = await call(ctx, 'GET', playbackPath, {
        as: company.owner,
        headers: { range: 'bytes=-0' },
      });
      expect(invalidRange.statusCode).toBe(416);
      const original = await call(ctx, 'GET', path + '/' + id + '/original', { as: company.owner });
      expect(original.statusCode).toBe(200);
      expect(original.rawPayload).toEqual(bytes);

      const derivatives = await ctx.owner.client`
        select source_sha256, sha256, version from enterprise_suite.media_video_derivatives
        where org_id = ${company.orgId} and asset_id = ${id}
      `;
      expect(derivatives).toEqual([
        {
          source_sha256: input.sha256,
          sha256: items[0].playback.sha256,
          version: 1,
        },
      ]);
      const events = await ctx.owner.client`
        select event_type, status from public.domain_events
        where org_id = ${company.orgId} and aggregate_id = ${id} order by event_type
      `;
      expect(events).toEqual([
        { event_type: 'enterprise_media.scan', status: 'dispatched' },
        { event_type: 'enterprise_media.transcode', status: 'dispatched' },
      ]);
    },
    90_000,
  );
});

describe('Enterprise jobsite media captions', () => {
  it('versions the uploader caption, preserves literal markup and searches the current tags', async () => {
    const company = await createCompany(ctx, { roles: ['crew_manager'] });
    const other = await createCompany(ctx);
    const path = await project(company, 'Private caption project');
    await project(other, 'Outside caption project');
    await enable(company);
    await enable(other);
    const crew = company.as('crew_manager');
    const granted = await call(ctx, 'PUT', path + '/grants/' + crew.membershipId, {
      as: company.owner,
      headers: revision(0),
      body: {
        active: true,
        reason: 'Assign supervision to this project.',
        clientRequestId: randomUUID(),
      },
    });
    expect(granted.statusCode, granted.body).toBe(200);

    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#17465C' },
    })
      .png()
      .toBuffer();
    const input = manifest(bytes);
    const started = await call(ctx, 'POST', path + '/upload-sessions', {
      as: company.owner,
      headers: revision(0),
      body: input,
    });
    expect(started.statusCode, started.body).toBe(201);
    const id = started.json().id as string;
    const session = path + '/upload-sessions/' + id;
    expect((await part(session, 0, bytes, 1, company.owner)).statusCode).toBe(200);
    const finalized = await call(ctx, 'POST', session + '/finalize', {
      as: company.owner,
      headers: revision(2),
      body: { clientRequestId: randomUUID() },
    });
    expect(finalized.statusCode, finalized.body).toBe(201);
    expect(finalized.json().caption).toEqual({
      revision: 0,
      caption: '',
      tags: [],
      createdAt: null,
      createdByUserId: null,
    });
    const captionPath = path + '/' + id + '/caption';
    const save = (
      as: TestSession,
      expected: number,
      body: { caption: string; tags: string[]; clientRequestId: string },
    ) => call(ctx, 'PUT', captionPath, { as, headers: revision(expected), body });
    const material = {
      caption: ' <em>Check the west opening.</em> ',
      tags: [' Safety ', 'FRAME', 'safety'],
      clientRequestId: randomUUID(),
    };
    expect((await save(crew, 0, material)).statusCode).toBe(403);
    expect((await save(other.owner, 0, material)).statusCode).toBe(404);
    const [first, repeat] = await Promise.all([
      save(company.owner, 0, material),
      save(company.owner, 0, material),
    ]);
    expect(first.statusCode, first.body).toBe(200);
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(first.headers.etag).toBe('"1"');
    expect(first.json()).toMatchObject({
      revision: 1,
      caption: '<em>Check the west opening.</em>',
      tags: ['safety', 'frame'],
      createdByUserId: company.owner.userId,
    });
    expect(repeat.json()).toEqual(first.json());
    expect(
      (await save(company.owner, 0, { ...material, caption: 'Different input.' })).statusCode,
    ).toBe(409);
    expect(
      (await save(company.owner, 0, { ...material, clientRequestId: randomUUID() })).statusCode,
    ).toBe(412);
    const scopedRead = await call(ctx, 'GET', captionPath, { as: crew });
    expect(scopedRead.json()).toEqual(first.json());
    expect((await call(ctx, 'GET', captionPath, { as: other.owner })).statusCode).toBe(404);

    const search = (term: string) =>
      call(ctx, 'GET', path + '?search=' + encodeURIComponent(term), { as: crew });
    expect((await search('SAFETY')).json().items).toMatchObject([{ id, caption: first.json() }]);
    expect((await search('west opening')).json().items).toMatchObject([{ id }]);
    expect((await search('east opening')).json().items).toEqual([]);
    const second = await save(company.owner, 1, {
      caption: 'North stair frame',
      tags: ['stair'],
      clientRequestId: randomUUID(),
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({
      revision: 2,
      caption: 'North stair frame',
      tags: ['stair'],
    });
    expect((await search('safety')).json().items).toEqual([]);
    expect((await search('stair')).json().items).toMatchObject([
      { id, sha256: input.sha256, caption: second.json() },
    ]);

    const history = await ctx.owner.client`
      select revision, caption from enterprise_suite.media_caption_revisions
      where org_id = ${company.orgId} and asset_id = ${id}
      order by revision
    `;
    expect(history).toEqual([
      { revision: 1, caption: '<em>Check the west opening.</em>' },
      { revision: 2, caption: 'North stair frame' },
    ]);
    const audit = await ctx.owner.client`
      select action from public.audit_events
      where org_id = ${company.orgId} and resource_id = ${id} and action = 'media.caption_changed'
    `;
    expect(audit).toHaveLength(2);
  }, 60_000);
});
