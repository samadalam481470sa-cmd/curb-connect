import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JOBSITE_PHOTO_CHUNK_BYTES, type JobsitePhotoAnnotation } from '@fieldline/contracts';
import { Logger, runOnce } from 'graphile-worker';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  call,
  createCompany,
  createTestContext,
  createUser,
  platformTestUrl,
  signIn,
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
      await sql`delete from enterprise_suite.media_customer_photo_approvals where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_customer_photo_previews where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_evidence_review_decisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_evidence_review_tasks where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_evidence_submissions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_evidence_assignments where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_photo_annotation_revisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_task_links where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_caption_revisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_video_derivatives where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_assets where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_upload_parts where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_upload_sessions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.media_project_grants where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_tasks where org_id = any(${orgIds}::uuid[])`;
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

describe('Enterprise jobsite media links', () => {
  it('links one private photo to two project tasks without duplicating the asset', async () => {
    const company = await createCompany(ctx, { roles: ['crew_manager', 'reviewer'] });
    const path = await project(company, 'Jobsite task evidence');
    const unrelatedPath = await project(company, 'Unrelated schedule');
    await enable(company);
    const crew = company.as('crew_manager');
    const reviewer = company.as('reviewer');
    const crewGrant = await call(ctx, 'PUT', path + '/grants/' + crew.membershipId, {
      as: company.owner,
      headers: revision(0),
      body: {
        active: true,
        reason: 'Assign evidence to this project.',
        clientRequestId: randomUUID(),
      },
    });
    expect(crewGrant.statusCode, crewGrant.body).toBe(200);

    async function task(mediaPath: string, title: string) {
      const scheduled = await call(ctx, 'POST', mediaPath.replace(/\/media$/, '/schedule/tasks'), {
        as: company.owner,
        body: {
          title,
          phase: 'Quality',
          startsOn: '2026-12-07',
          endsOn: '2026-12-08',
          predecessorId: null,
          lagDays: 0,
          progressPercent: 0,
          clientRequestId: randomUUID(),
        },
      });
      expect(scheduled.statusCode, scheduled.body).toBe(201);
      return scheduled.json().id as string;
    }
    const one = await task(path, 'Opening check');
    const two = await task(path, 'Frame inspection');
    const outside = await task(unrelatedPath, 'Private outside task');

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
    const list = path + '/' + id + '/task-links';
    const get = () => call(ctx, 'GET', list, { as: crew });
    const link = (
      body: { taskId: string; evidenceType: string; clientRequestId: string },
      expected = 0,
      as: TestSession = crew,
    ) =>
      call(ctx, 'POST', list, {
        as,
        headers: revision(expected),
        body,
      });
    const first = { taskId: one, evidenceType: 'reference', clientRequestId: randomUUID() };
    expect((await get()).json()).toEqual({ revision: 0, items: [] });
    expect((await link(first, 0, reviewer)).statusCode).toBe(403);
    expect((await link({ ...first, taskId: outside })).statusCode).toBe(404);

    const [accepted, retry] = await Promise.all([link(first), link(first)]);
    expect([accepted.statusCode, retry.statusCode].sort()).toEqual([200, 201]);
    expect(accepted.json()).toEqual(retry.json());
    expect(accepted.json()).toMatchObject({
      revision: 1,
      link: { assetId: id, taskId: one, taskTitle: 'Opening check', evidenceType: 'reference' },
    });
    const duplicate = await link({ ...first, clientRequestId: randomUUID() });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(accepted.json());
    const second = {
      taskId: two,
      evidenceType: 'completion_evidence',
      clientRequestId: randomUUID(),
    };
    expect((await link({ ...second, clientRequestId: first.clientRequestId }, 1)).statusCode).toBe(
      409,
    );
    expect((await link(second)).statusCode).toBe(412);
    const attached = await link(second, 1);
    expect(attached.statusCode, attached.body).toBe(201);
    const links = await get();
    expect(links.headers.etag).toBe('"2"');
    expect(links.json()).toMatchObject({
      revision: 2,
      items: [
        { assetId: id, taskId: one, evidenceType: 'reference' },
        { assetId: id, taskId: two, evidenceType: 'completion_evidence' },
      ],
    });
    const persisted = await call(ctx, 'GET', path, { as: company.owner });
    expect(persisted.json().items).toMatchObject([{ id, sha256: input.sha256 }]);
    const schedule = await call(ctx, 'GET', path.replace(/\/media$/, '/schedule'), {
      as: company.owner,
    });
    expect(schedule.statusCode, schedule.body).toBe(200);
    expect(schedule.json().items).toHaveLength(2);
    expect(schedule.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: one, progressPercent: 0 }),
        expect.objectContaining({ id: two, progressPercent: 0 }),
      ]),
    );
    const audit = await ctx.owner.client`
      select resource_id from public.audit_events
      where org_id = ${company.orgId} and resource_id = ${id} and action = 'media.task_linked'
    `;
    expect(audit).toEqual([{ resource_id: id }, { resource_id: id }]);
  }, 60_000);
});

describe('Enterprise jobsite photo annotations', () => {
  it('renders inspector annotations into immutable private revisions while preserving the original SHA-256', async () => {
    const company = await createCompany(ctx, { roles: ['crew_manager', 'reviewer'] });
    const outside = await createCompany(ctx);
    const path = await project(company, 'Inspector photos');
    await project(outside, 'Outside inspection');
    await enable(company);
    await enable(outside);
    const reviewer = company.as('reviewer');
    const crew = company.as('crew_manager');
    async function grant(membershipId: string, active: boolean, current: number) {
      const response = await call(ctx, 'PUT', path + '/grants/' + membershipId, {
        as: company.owner,
        headers: revision(current),
        body: { active, reason: 'Inspection assignment.', clientRequestId: randomUUID() },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    await grant(crew.membershipId, true, 0);
    const width = 640;
    const height = 384;
    const bytes = await sharp({
      create: { width, height, channels: 3, background: '#17465C' },
    })
      .png()
      .toBuffer();
    const input = manifest(bytes);
    const created = await call(ctx, 'POST', path + '/upload-sessions', {
      as: company.owner,
      headers: revision(0),
      body: input,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const session = path + '/upload-sessions/' + id;
    expect((await part(session, 0, bytes, 1, company.owner)).statusCode).toBe(200);
    const finalized = await call(ctx, 'POST', session + '/finalize', {
      as: company.owner,
      headers: revision(2),
      body: { clientRequestId: randomUUID() },
    });
    expect(finalized.statusCode, finalized.body).toBe(201);
    const original = path + '/' + id + '/original';
    const url = path + '/' + id + '/annotations';
    const geometry: JobsitePhotoAnnotation[] = [
      { kind: 'arrow', from: { x: 0.1, y: 0.24 }, to: { x: 0.55, y: 0.24 } },
      { kind: 'box', from: { x: 0.12, y: 0.36 }, to: { x: 0.35, y: 0.46 } },
      { kind: 'redaction', from: { x: 0.4, y: 0.4 }, to: { x: 0.6, y: 0.65 } },
      { kind: 'note', at: { x: 0.05, y: 0.72 }, text: '<check> & confirm' },
    ];
    function save(
      as: TestSession,
      expected: number,
      annotations = geometry,
      clientRequestId = randomUUID(),
    ) {
      return call(ctx, 'POST', url, {
        as,
        headers: revision(expected),
        body: { annotations, baseDerivativeVersion: expected, clientRequestId },
      });
    }
    expect((await save(reviewer, 0)).statusCode).toBe(404);
    await grant(reviewer.membershipId, true, 0);
    expect((await save(reviewer, 0)).statusCode).toBe(409);
    await drainScans({ name: 'fixture', scan: async () => 'clean' });
    const originalBefore = await call(ctx, 'GET', original, { as: reviewer });
    expect(originalBefore.statusCode).toBe(200);
    expect(sha256Hex(originalBefore.rawPayload)).toBe(input.sha256);
    expect((await save(crew, 0)).statusCode).toBe(403);
    expect((await save(outside.owner, 0)).statusCode).toBe(404);

    const preview = await call(ctx, 'GET', url + '/source', { as: reviewer });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('image/png');
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect((await call(ctx, 'GET', url + '/source', { as: outside.owner })).statusCode).toBe(404);
    const empty = await call(ctx, 'GET', url, { as: reviewer });
    expect(empty.json()).toEqual({ revision: 0, current: null, history: [] });
    const invalid = await save(reviewer, 0, [
      { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 1.1, y: 0 } },
    ]);
    expect(invalid.statusCode).toBe(400);

    const requestId = randomUUID();
    const [first, replay] = await Promise.all([
      save(reviewer, 0, geometry, requestId),
      save(reviewer, 0, geometry, requestId),
    ]);
    expect([first.statusCode, replay.statusCode].sort(), first.body).toEqual([200, 201]);
    expect(replay.json()).toEqual(first.json());
    expect(first.headers.etag).toBe('"1"');
    expect(first.json()).toMatchObject({
      revision: 1,
      annotations: geometry,
      sourceSha256: input.sha256,
      width,
      height,
      createdByUserId: reviewer.userId,
    });
    const secondGeometry: JobsitePhotoAnnotation[] = [
      { kind: 'box', from: { x: 0.05, y: 0.05 }, to: { x: 0.28, y: 0.27 } },
    ];
    expect((await save(reviewer, 0, secondGeometry, requestId)).statusCode).toBe(409);
    expect((await save(reviewer, 0, secondGeometry)).statusCode).toBe(412);

    const imagePath = url + '/1/image';
    const image = await call(ctx, 'GET', imagePath, { as: crew });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('private, no-store');
    expect(sha256Hex(image.rawPayload)).toBe(first.json().sha256);
    expect(first.json().sha256).not.toBe(input.sha256);
    const raster = await sharp(image.rawPayload).ensureAlpha().raw().toBuffer();
    function pixel(x: number, y: number) {
      const offset = (Math.round(y * (height - 1)) * width + Math.round(x * (width - 1))) * 4;
      return Array.from(raster.subarray(offset, offset + 4));
    }
    expect(pixel(0.5, 0.5)).toEqual([0, 0, 0, 255]);
    expect(pixel(0.2, 0.24)).toEqual([255, 177, 55, 255]);
    expect(pixel(0.25, 0.36)).toEqual([255, 177, 55, 255]);
    expect(pixel(0.05, 0.72)).toEqual([255, 241, 181, 255]);
    expect(pixel(0.95, 0.95)).toEqual([23, 70, 92, 255]);
    expect((await call(ctx, 'GET', imagePath, { as: outside.owner })).statusCode).toBe(404);

    const second = await save(reviewer, 1, secondGeometry);
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().sha256).not.toBe(first.json().sha256);
    const history = await call(ctx, 'GET', url, { as: reviewer });
    expect(history.json()).toEqual({
      revision: 2,
      current: second.json(),
      history: [second.json(), first.json()],
    });
    expect((await call(ctx, 'GET', imagePath, { as: reviewer })).rawPayload).toEqual(
      image.rawPayload,
    );
    const originalAfter = await call(ctx, 'GET', original, { as: reviewer });
    expect(originalAfter.rawPayload).toEqual(originalBefore.rawPayload);
    await grant(reviewer.membershipId, false, 1);
    expect((await call(ctx, 'GET', imagePath, { as: reviewer })).statusCode).toBe(404);
    const events = await ctx.owner.client`
      select action from public.audit_events where org_id = ${company.orgId} and resource_id = ${id}
      and action = 'media.photo_annotated'
    `;
    expect(events).toHaveLength(2);
  }, 60_000);
});

describe('Enterprise jobsite evidence submissions', () => {
  it('freezes clean task evidence and creates one assigned review on concurrent retries', async () => {
    const company = await createCompany(ctx, { roles: ['crew_manager', 'reviewer', 'admin'] });
    const outsider = await createCompany(ctx);
    const path = await project(company, 'North frame evidence');
    const outsidePath = await project(outsider, 'An unrelated project');
    await enable(company);
    await enable(outsider);
    const contractor = company.as('crew_manager');
    const inspector = company.as('reviewer');
    async function grant(membershipId: string) {
      const result = await call(ctx, 'PUT', path + '/grants/' + membershipId, {
        as: company.owner,
        headers: revision(0),
        body: { active: true, reason: 'Inspect the north frame.', clientRequestId: randomUUID() },
      });
      expect(result.statusCode, result.body).toBe(200);
    }
    await grant(contractor.membershipId);
    const task = await call(ctx, 'POST', path.replace(/\/media$/, '/schedule/tasks'), {
      as: company.owner,
      body: {
        title: 'Inspect north frame',
        phase: 'Quality',
        startsOn: '2026-12-07',
        endsOn: '2026-12-08',
        predecessorId: null,
        lagDays: 0,
        progressPercent: 0,
        clientRequestId: randomUUID(),
      },
    });
    expect(task.statusCode, task.body).toBe(201);
    const taskId = task.json().id as string;
    const evidence = path + '/evidence/tasks/' + taskId;
    const assignment = {
      active: true,
      minimumMedia: 1,
      clientRequestId: randomUUID(),
      contractorMembershipId: contractor.membershipId,
      reviewerMembershipId: inspector.membershipId,
    };
    function assign(as: TestSession = company.owner, base = 0) {
      return call(ctx, 'PUT', evidence + '/assignment', {
        as,
        headers: revision(base),
        body: assignment,
      });
    }
    expect((await assign(contractor)).statusCode).toBe(403);
    const missingProjectGrant = await assign();
    expect(missingProjectGrant.statusCode).toBe(400);
    expect(missingProjectGrant.json().code).toBe('validation_failed');
    await grant(inspector.membershipId);
    const assigned = await assign();
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.headers.etag).toBe('"1"');
    expect((await assign()).json()).toEqual(assigned.json());

    const collection = path + '/evidence/tasks';
    const contractorTasks = await call(ctx, 'GET', collection, { as: contractor });
    expect(contractorTasks.statusCode, contractorTasks.body).toBe(200);
    expect(contractorTasks.json().items).toEqual([{ id: taskId, title: 'Inspect north frame' }]);
    const reviewerTasksBefore = await call(ctx, 'GET', collection, { as: inspector });
    expect(reviewerTasksBefore.statusCode).toBe(200);
    expect(reviewerTasksBefore.json().items).toEqual([]);

    async function linkPhoto(background: string) {
      const bytes = await sharp({
        create: { width: 640, height: 384, channels: 3, background },
      })
        .png()
        .toBuffer();
      const input = manifest(bytes);
      const created = await call(ctx, 'POST', path + '/upload-sessions', {
        as: contractor,
        headers: revision(0),
        body: input,
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id as string;
      const session = path + '/upload-sessions/' + id;
      expect((await part(session, 0, bytes, 1, contractor)).statusCode).toBe(200);
      const finalized = await call(ctx, 'POST', session + '/finalize', {
        as: contractor,
        headers: revision(2),
        body: { clientRequestId: randomUUID() },
      });
      expect(finalized.statusCode, finalized.body).toBe(201);
      const asset = path + '/' + id;
      const link = await call(ctx, 'POST', asset + '/task-links', {
        as: contractor,
        headers: revision(0),
        body: { taskId, evidenceType: 'completion_evidence', clientRequestId: randomUUID() },
      });
      expect(link.statusCode, link.body).toBe(201);
      return { id, asset, sha256: input.sha256 };
    }

    const { id, asset, sha256 } = await linkPhoto('#506a9f');
    const rejected = await linkPhoto('#239178');

    function updateCaption(caption: string, base: number) {
      return call(ctx, 'PUT', asset + '/caption', {
        as: contractor,
        headers: revision(base),
        body: { caption, tags: ['framing'], clientRequestId: randomUUID() },
      });
    }
    const initialCaption = await updateCaption('North frame before inspection', 0);
    expect(initialCaption.statusCode, initialCaption.body).toBe(200);
    const payload = {
      mediaRevisionIds: [id],
      note: 'Ready for inspector.',
      clientRequestId: randomUUID(),
    };
    function submit(body = payload, as: TestSession = contractor, base = 0, target = evidence) {
      return call(ctx, 'POST', target + '/submissions', {
        as,
        headers: revision(base),
        body,
      });
    }
    expect((await submit(payload, company.as('admin'))).statusCode).toBe(404);
    expect((await submit(payload, inspector)).statusCode).toBe(403);
    expect(
      (await submit(payload, outsider.owner, 0, outsidePath + '/evidence/tasks/' + taskId))
        .statusCode,
    ).toBe(404);
    expect((await submit()).statusCode).toBe(409);
    const pending = await call(ctx, 'GET', evidence, { as: contractor });
    expect(pending.statusCode, pending.body).toBe(200);
    expect(pending.json()).toMatchObject({
      canSubmit: true,
      candidates: expect.arrayContaining([
        expect.objectContaining({ assetId: id, ready: false, availability: 'pending' }),
      ]),
      submission: null,
    });

    await drainScans({
      name: 'fixture',
      scan: async (bytes) => (sha256Hex(bytes) === rejected.sha256 ? 'infected' : 'clean'),
    });
    expect((await submit({ ...payload, mediaRevisionIds: [rejected.id] })).statusCode).toBe(409);
    const afterScan = await call(ctx, 'GET', evidence, { as: contractor });
    expect(afterScan.json().candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: rejected.id,
          ready: false,
          availability: 'unavailable',
        }),
      ]),
    );
    const annotations = await call(ctx, 'POST', asset + '/annotations', {
      as: inspector,
      headers: revision(0),
      body: {
        baseDerivativeVersion: 0,
        clientRequestId: randomUUID(),
        annotations: [{ kind: 'arrow', from: { x: 0.1, y: 0.4 }, to: { x: 0.4, y: 0.4 } }],
      },
    });
    expect(annotations.statusCode, annotations.body).toBe(201);
    const outdatedSelection = await submit();
    expect(outdatedSelection.statusCode).toBe(400);
    expect(outdatedSelection.json().code).toBe('validation_failed');
    payload.mediaRevisionIds = [annotations.json().id];
    const [first, repeat] = await Promise.all([submit(), submit()]);
    expect([first.statusCode, repeat.statusCode].sort(), first.body).toEqual([200, 201]);
    expect(first.json()).toEqual(repeat.json());
    const accepted = first.json();
    expect(accepted).toMatchObject({
      revision: 1,
      taskId,
      assignmentId: assigned.json().id,
      review: { reviewerMembershipId: inspector.membershipId },
      media: [
        {
          originalSha256: sha256,
          assetId: id,
          mediaRevisionId: annotations.json().id,
          caption: { revision: 1, text: 'North frame before inspection' },
          annotation: { revision: 1, sha256: annotations.json().sha256 },
        },
      ],
    });
    expect((await submit({ ...payload, note: 'Changed note.' })).statusCode).toBe(409);
    expect(
      (await submit({ ...payload, clientRequestId: randomUUID() }, contractor, 1)).statusCode,
    ).toBe(409);
    expect((await updateCaption('Caption was edited after submission', 1)).statusCode).toBe(200);
    const reviewed = await call(ctx, 'GET', evidence, { as: inspector });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json().submission).toEqual(accepted);
    expect(reviewed.json().candidates).toEqual([]);
    const reviewerTasksAfter = await call(ctx, 'GET', collection, { as: inspector });
    expect(reviewerTasksAfter.statusCode).toBe(200);
    expect(reviewerTasksAfter.json().items).toEqual([{ id: taskId, title: 'Inspect north frame' }]);

    await drainScans({ name: 'fixture', scan: async () => 'clean' });
    const records = await ctx.owner.client`
      select id from enterprise_suite.media_evidence_review_tasks
      where org_id = ${company.orgId} and task_id = ${taskId}
    `;
    expect(records).toEqual([{ id: accepted.review.id }]);
    const events = await ctx.owner.client`
      select status from public.domain_events where org_id = ${company.orgId}
      and aggregate_id = ${accepted.review.id} and event_type = 'enterprise_media.evidence_review'
    `;
    expect(events).toEqual([{ status: 'dispatched' }]);
    const notices = await ctx.owner.client`
      select recipient_membership_id, channel from public.notifications
      where org_id = ${company.orgId}
        and dedupe_key = ${'enterprise-media-evidence-review:' + accepted.review.id + ':in_app'}
    `;
    expect(notices).toEqual([
      { recipient_membership_id: inspector.membershipId, channel: 'in_app' },
    ]);
    const schedule = await call(ctx, 'GET', path.replace(/\/media$/, '/schedule'), {
      as: company.owner,
    });
    expect(schedule.json().items).toMatchObject([{ id: taskId, progressPercent: 0 }]);
  }, 60_000);
});

describe('Enterprise jobsite evidence decisions', () => {
  it('keeps completion blocked after rejection and releases only the schedule gate after revised evidence passes', async () => {
    const company = await createCompany(ctx, { roles: ['crew_manager', 'reviewer'] });
    const path = await project(company, 'Field inspection completion gate');
    const outsidePath = await project(company, 'A separate project in the same company');
    await enable(company);
    const contractor = company.as('crew_manager');
    const reviewer = company.as('reviewer');
    const otherAccount = await createUser(ctx, { displayName: 'Second inspector' });
    const otherMembership = await addMember(ctx, {
      orgId: company.orgId,
      userId: otherAccount.userId,
      role: 'reviewer',
    });
    const otherReviewer = await signIn(ctx, otherAccount.userId, company.orgId);

    for (const id of [contractor.membershipId, reviewer.membershipId, otherMembership]) {
      const granted = await call(ctx, 'PUT', path + '/grants/' + id, {
        as: company.owner,
        headers: revision(0),
        body: {
          active: true,
          reason: 'Testing task evidence reviews.',
          clientRequestId: randomUUID(),
        },
      });
      expect(granted.statusCode, granted.body).toBe(200);
    }

    const taskInput = {
      title: 'Release north frame',
      phase: 'Quality',
      startsOn: '2026-12-07',
      endsOn: '2026-12-08',
      predecessorId: null,
      lagDays: 0,
      progressPercent: 0,
    };
    const schedule = path.replace(/\/media$/, '/schedule');
    async function createTask(title: string) {
      const result = await call(ctx, 'POST', schedule + '/tasks', {
        as: company.owner,
        body: { ...taskInput, title, clientRequestId: randomUUID() },
      });
      expect(result.statusCode, result.body).toBe(201);
      return result.json().id as string;
    }
    const taskId = await createTask(taskInput.title);
    const oldTaskId = await createTask('Existing task without evidence requirement');
    const evidence = path + '/evidence/tasks/' + taskId;
    const assigned = await call(ctx, 'PUT', evidence + '/assignment', {
      as: company.owner,
      headers: revision(0),
      body: {
        contractorMembershipId: contractor.membershipId,
        reviewerMembershipId: reviewer.membershipId,
        active: true,
        minimumMedia: 1,
        clientRequestId: randomUUID(),
      },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);

    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#274372' },
    })
      .png()
      .toBuffer();
    const upload = await call(ctx, 'POST', path + '/upload-sessions', {
      as: contractor,
      headers: revision(0),
      body: manifest(bytes),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const id = upload.json().id as string;
    const session = path + '/upload-sessions/' + id;
    expect((await part(session, 0, bytes, 1, contractor)).statusCode).toBe(200);
    const uploaded = await call(ctx, 'POST', session + '/finalize', {
      as: contractor,
      headers: revision(2),
      body: { clientRequestId: randomUUID() },
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    await drainScans({ name: 'fixture', scan: async () => 'clean' });
    const linked = await call(ctx, 'POST', path + '/' + id + '/task-links', {
      as: contractor,
      headers: revision(0),
      body: { taskId, evidenceType: 'completion_evidence', clientRequestId: randomUUID() },
    });
    expect(linked.statusCode, linked.body).toBe(201);

    function submit(base: number, note: string) {
      return call(ctx, 'POST', evidence + '/submissions', {
        as: contractor,
        headers: revision(base),
        body: { mediaRevisionIds: [id], note, clientRequestId: randomUUID() },
      });
    }
    function decide(
      reviewId: string,
      expected: number,
      payload: { decision: string; findings: string; clientRequestId: string },
      actor: TestSession = reviewer,
      target = evidence,
    ) {
      return call(ctx, 'POST', target + '/reviews/' + reviewId + '/decision', {
        as: actor,
        headers: revision(expected),
        body: payload,
      });
    }
    async function complete(id: string, title: string) {
      const task = { ...taskInput, title, progressPercent: 100 };
      const current = schedule + '/tasks/' + id;
      const preview = await call(ctx, 'POST', current + '/preview', {
        as: company.owner,
        headers: revision(1),
        body: task,
      });
      expect(preview.statusCode, preview.body).toBe(200);
      return call(ctx, 'PATCH', current, {
        as: company.owner,
        headers: revision(1),
        body: { task, previewToken: preview.json().token, reason: 'Field completion check.' },
      });
    }

    const [fixtureInvoice] = await ctx.owner.client`
      insert into public.invoices (org_id, number, kind, status, subtotal_minor, total_minor)
      values (${company.orgId}, 'EVIDENCE-CHECK-1', 'progress', 'pending_approval', 75000, 75000)
      returning id
    `;
    async function financialState() {
      return ctx.owner.client`
        select id, status, revision, amount_paid_minor, approved_at from public.invoices
        where org_id = ${company.orgId} and id = ${fixtureInvoice!.id}
      `;
    }
    const before = await financialState();
    expect(before).toHaveLength(1);
    expect(
      (await complete(oldTaskId, 'Existing task without evidence requirement')).statusCode,
    ).toBe(200);
    expect((await complete(taskId, taskInput.title)).statusCode).toBe(409);

    const first = await submit(0, 'First evidence revision.');
    expect(first.statusCode, first.body).toBe(201);
    const firstReview = first.json().review.id;
    const rejection = {
      decision: 'rejected',
      findings: 'Submit the corrected frame evidence.',
      clientRequestId: randomUUID(),
    };
    expect((await decide(firstReview, 1, rejection, otherReviewer)).statusCode).toBe(404);
    expect((await decide(firstReview, 1, rejection, company.owner)).statusCode).toBe(404);
    expect(
      (await decide(firstReview, 1, rejection, reviewer, outsidePath + '/evidence/tasks/' + taskId))
        .statusCode,
    ).toBe(404);
    expect((await decide(firstReview, 0, rejection)).statusCode).toBe(412);
    const [rejected, replay] = await Promise.all([
      decide(firstReview, 1, rejection),
      decide(firstReview, 1, rejection),
    ]);
    expect([rejected.statusCode, replay.statusCode].sort(), rejected.body).toEqual([200, 201]);
    expect(rejected.json()).toEqual(replay.json());
    expect(rejected.json()).toMatchObject({
      reviewId: firstReview,
      decision: 'rejected',
      reviewerUserId: reviewer.userId,
    });
    expect((await complete(taskId, taskInput.title)).statusCode).toBe(409);
    const blocked = await call(ctx, 'GET', evidence, { as: contractor });
    expect(blocked.json()).toMatchObject({
      canSubmit: true,
      completionEligible: false,
      reviewOutcome: { decision: 'rejected' },
    });

    const next = await submit(1, 'Corrected evidence revision.');
    expect(next.statusCode, next.body).toBe(201);
    expect(next.json().revision).toBe(2);
    expect(next.json().review.id).not.toBe(firstReview);
    expect(
      (await decide(firstReview, 1, { ...rejection, clientRequestId: randomUUID() })).statusCode,
    ).toBe(412);
    expect((await decide(firstReview, 1, rejection)).json()).toEqual(rejected.json());
    const approved = await decide(next.json().review.id, 2, {
      decision: 'approved',
      findings: 'Corrected evidence meets the field checklist.',
      clientRequestId: randomUUID(),
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const gate = await call(ctx, 'GET', evidence, { as: reviewer });
    expect(gate.json()).toMatchObject({
      canDecide: false,
      completionEligible: true,
      reviewOutcome: { decision: 'approved' },
    });
    const stillIncomplete = await call(ctx, 'GET', schedule, { as: company.owner });
    expect(stillIncomplete.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: taskId, progressPercent: 0, actualFinishOn: null }),
      ]),
    );
    const completed = await complete(taskId, taskInput.title);
    expect(completed.statusCode, completed.body).toBe(200);
    const finished = await call(ctx, 'GET', schedule, { as: company.owner });
    expect(finished.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: taskId,
          progressPercent: 100,
          actualFinishOn: expect.any(String),
        }),
      ]),
    );
    expect(await financialState()).toEqual(before);
    const paymentRecords = await ctx.owner
      .client`select id from public.payments where org_id = ${company.orgId}`;
    expect(paymentRecords).toEqual([]);
  }, 60_000);
});

describe('Enterprise jobsite customer photo previews', () => {
  it('approves only the current redaction preview and strips EXIF and private markup from the PNG', async () => {
    const company = await createCompany(ctx, { roles: ['reviewer', 'crew_manager'] });
    const other = await createCompany(ctx);
    const path = await project(company, 'Customer preview test project');
    const wrong = await project(company, 'A separate project');
    await project(other, 'Outside company project');
    await enable(company);
    await enable(other);
    const reviewer = company.as('reviewer');
    const grant = await call(ctx, 'PUT', path + '/grants/' + reviewer.membershipId, {
      as: company.owner,
      headers: revision(0),
      body: { active: true, reason: 'Inspect the private photo.', clientRequestId: randomUUID() },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    const width = 640;
    const height = 384;
    const bytes = await sharp({
      create: { width, height, channels: 3, background: '#295E76' },
    })
      .withExif({ IFD0: { ImageDescription: 'Private test location' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const input = { ...manifest(bytes), filename: 'private-address.jpg', mimeType: 'image/jpeg' };
    const created = await call(ctx, 'POST', path + '/upload-sessions', {
      as: company.owner,
      headers: revision(0),
      body: input,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const upload = path + '/upload-sessions/' + id;
    expect((await part(upload, 0, bytes, 1, company.owner)).statusCode).toBe(200);
    const finalized = await call(ctx, 'POST', upload + '/finalize', {
      as: company.owner,
      headers: revision(2),
      body: { clientRequestId: randomUUID() },
    });
    expect(finalized.statusCode, finalized.body).toBe(201);
    const asset = path + '/' + id;
    const url = asset + '/customer-preview';

    function prepare(base: number, annotation: number, requestId = randomUUID()) {
      return call(ctx, 'POST', url, {
        as: company.owner,
        headers: revision(base),
        body: { baseAnnotationRevision: annotation, clientRequestId: requestId },
      });
    }
    function approve(previewId: string, expected: number, requestId = randomUUID()) {
      return call(ctx, 'POST', url + '/' + previewId + '/approve', {
        as: company.owner,
        headers: revision(expected),
        body: {
          confirmedCustomerSafe: true,
          reason: 'Approved the exact homeowner crop.',
          clientRequestId: requestId,
        },
      });
    }
    expect((await prepare(0, 0)).statusCode).toBe(409);
    await drainScans({ name: 'fixture', scan: async () => 'clean' });
    expect((await call(ctx, 'GET', url, { as: reviewer })).statusCode).toBe(403);
    expect((await call(ctx, 'GET', url, { as: other.owner })).statusCode).toBe(404);
    expect(
      (await call(ctx, 'GET', wrong + '/' + id + '/customer-preview', { as: company.owner }))
        .statusCode,
    ).toBe(404);

    const geometry: JobsitePhotoAnnotation[] = [
      { kind: 'arrow', from: { x: 0.1, y: 0.2 }, to: { x: 0.45, y: 0.2 } },
      { kind: 'box', from: { x: 0.12, y: 0.3 }, to: { x: 0.32, y: 0.46 } },
      { kind: 'note', at: { x: 0.06, y: 0.72 }, text: 'Private repair notes' },
      { kind: 'redaction', from: { x: 0.4, y: 0.4 }, to: { x: 0.64, y: 0.7 } },
    ];
    function annotate(base: number, values = geometry) {
      return call(ctx, 'POST', asset + '/annotations', {
        as: reviewer,
        headers: revision(base),
        body: { baseDerivativeVersion: base, annotations: values, clientRequestId: randomUUID() },
      });
    }
    const firstAnnotation = await annotate(0);
    expect(firstAnnotation.statusCode, firstAnnotation.body).toBe(201);
    const prepareId = randomUUID();
    const [first, firstReplay] = await Promise.all([
      prepare(0, 1, prepareId),
      prepare(0, 1, prepareId),
    ]);
    expect([first.statusCode, firstReplay.statusCode].sort(), first.body).toEqual([200, 201]);
    expect(first.json()).toEqual(firstReplay.json());
    expect(first.json()).toMatchObject({
      revision: 1,
      sourceAnnotationRevision: 1,
      redactionCount: 1,
      sourceSha256: input.sha256,
    });
    const stalePreviewId = first.json().id as string;

    const nextAnnotation = await annotate(1, [
      ...geometry,
      { kind: 'redaction', from: { x: 0.7, y: 0.16 }, to: { x: 0.9, y: 0.42 } },
    ]);
    expect(nextAnnotation.statusCode, nextAnnotation.body).toBe(201);
    expect((await approve(stalePreviewId, 1)).statusCode).toBe(412);
    const stale = await call(ctx, 'GET', url, { as: company.owner });
    expect(stale.json()).toMatchObject({ current: false, approval: null, annotationRevision: 2 });
    const next = await prepare(1, 2);
    expect(next.statusCode, next.body).toBe(201);
    expect(next.json()).toMatchObject({
      revision: 2,
      redactionCount: 2,
      sourceAnnotationRevision: 2,
    });
    const nextId = next.json().id as string;
    const receipt = randomUUID();
    const [approved, approvedAgain] = await Promise.all([
      approve(nextId, 2, receipt),
      approve(nextId, 2, receipt),
    ]);
    expect([approved.statusCode, approvedAgain.statusCode].sort(), approved.body).toEqual([
      200, 201,
    ]);
    expect(approved.json()).toEqual(approvedAgain.json());
    expect(approved.json()).toMatchObject({
      previewId: nextId,
      approvedByUserId: company.owner.userId,
    });
    const current = await call(ctx, 'GET', url, { as: company.owner });
    expect(current.json()).toMatchObject({
      current: true,
      approval: approved.json(),
      preview: next.json(),
    });

    const preview = await call(ctx, 'GET', url + '/' + nextId + '/image', { as: company.owner });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(sha256Hex(preview.rawPayload)).toBe(next.json().sha256);
    const imageInfo = await sharp(preview.rawPayload).metadata();
    expect(imageInfo).toMatchObject({ format: 'png', width, height });
    expect(imageInfo.exif).toBeUndefined();
    expect(imageInfo.xmp).toBeUndefined();
    expect(
      (await call(ctx, 'GET', url + '/' + nextId + '/image', { as: reviewer })).statusCode,
    ).toBe(403);
    expect(
      (await call(ctx, 'GET', url + '/' + nextId + '/image', { as: other.owner })).statusCode,
    ).toBe(404);
    const [safePixels, sourcePixels, privatePixels] = await Promise.all([
      sharp(preview.rawPayload).ensureAlpha().raw().toBuffer(),
      sharp(bytes).ensureAlpha().raw().toBuffer(),
      call(ctx, 'GET', asset + '/annotations/2/image', { as: reviewer }).then((image) =>
        sharp(image.rawPayload).ensureAlpha().raw().toBuffer(),
      ),
    ]);
    function pixel(raster: Buffer, x: number, y: number) {
      const offset = (Math.round(y * (height - 1)) * width + Math.round(x * (width - 1))) * 4;
      return Array.from(raster.subarray(offset, offset + 4));
    }
    expect(pixel(safePixels, 0.5, 0.5)).toEqual([0, 0, 0, 255]);
    expect(pixel(safePixels, 0.8, 0.3)).toEqual([0, 0, 0, 255]);
    for (const [x, y] of [
      [0.22, 0.2],
      [0.22, 0.3],
      [0.06, 0.72],
    ] as const) {
      expect(pixel(safePixels, x, y)).toEqual(pixel(sourcePixels, x, y));
      expect(pixel(privatePixels, x, y)).not.toEqual(pixel(safePixels, x, y));
    }
    const original = await call(ctx, 'GET', asset + '/original', { as: reviewer });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload).toEqual(bytes);

    const approvals = await ctx.owner.client`
      select preview_id from enterprise_suite.media_customer_photo_approvals
      where org_id = ${company.orgId} and asset_id = ${id}
    `;
    expect(approvals).toEqual([{ preview_id: nextId }]);
  }, 60_000);
});
