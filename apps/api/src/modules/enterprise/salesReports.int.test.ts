import { createHash, randomUUID } from 'node:crypto';
import { HOME_SALES_PIPELINE_ID } from '@fieldline/contracts';
import { Logger, runOnce } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  platformTestUrl,
  type TestContext,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';

let ctx: TestContext;
const leads = '/v1/enterprise/sales/leads';
const reports = '/v1/enterprise/sales/reports';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_report_runs where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_activities where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_leads where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_sources where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});
afterAll(async () => ctx?.close());

it('exports the exact pipeline view and rechecks permission and recorded channel consent', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'admin'] });
  const foreign = await createCompany(ctx);
  for (const tenant of [company, foreign]) {
    const suite = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(suite.statusCode, suite.body).toBe(200);
  }
  const source = await call(ctx, 'POST', leads + '/sources', {
    as: company.owner,
    body: { name: 'Export fixture' },
  });
  expect(source.statusCode, source.body).toBe(201);
  const sourceId = source.json().id as string;
  async function add(name: string, email: string, phone: string, marketing: object) {
    const input = {
      name,
      email,
      phone,
      sourceId,
      contactMethod: 'email',
      consent: { marketing, inquiry: { email: 'granted', phone: 'granted' } },
    };
    const preview = await call(ctx, 'POST', leads + '/preview', { as: company.owner, body: input });
    expect(preview.statusCode, preview.body).toBe(200);
    const created = await call(ctx, 'POST', leads, {
      as: company.owner,
      headers: { 'if-match': '"0"' },
      body: {
        ...input,
        previewFingerprint: preview.json().previewFingerprint,
        clientRequestId: randomUUID(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  }
  const allowedId = await add('=Export 10% included', 'granted@buyer.example', '4025550100', {
    email: 'granted',
    phone: 'declined',
  });
  await add('Export 10% anonymous', 'declined@buyer.example', '4025550101', { email: 'declined' });
  await add('Export 100 other', 'other@buyer.example', '4025550102', {
    email: 'granted',
    phone: 'granted',
  });
  const board = await call(
    ctx,
    'GET',
    '/v1/enterprise/sales/pipeline?stage=new&sourceId=' + sourceId + '&search=10%25',
    { as: company.owner },
  );
  expect(board.statusCode, board.body).toBe(200);
  expect(board.json().counts).toMatchObject([{ stage: { key: 'new' }, count: 2 }]);
  const base =
    '/v1/enterprise/sales/pipeline?stage=new&sourceId=' + sourceId + '&search=10%25&limit=1';
  const sorted = async (sort: string, cursor?: string) =>
    call(
      ctx,
      'GET',
      base + '&sort=' + sort + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      { as: company.owner },
    );
  const ascending = await sorted('name_asc');
  expect(ascending.statusCode, ascending.body).toBe(200);
  expect(ascending.json()).toMatchObject({
    items: [{ id: allowedId, name: '=Export 10% included' }],
    counts: [{ stage: { key: 'new' }, count: 2 }],
    nextCursor: expect.any(String),
  });
  const following = await sorted('name_asc', ascending.json().nextCursor);
  expect(following.statusCode, following.body).toBe(200);
  expect(following.json()).toMatchObject({
    items: [{ name: 'Export 10% anonymous' }],
    nextCursor: null,
  });
  expect((await sorted('name_desc', ascending.json().nextCursor)).statusCode).toBe(400);
  expect((await sorted('made_up')).statusCode).toBe(400);
  const nullSort = await sorted('probability_asc');
  expect(nullSort.statusCode, nullSort.body).toBe(200);
  const nextNull = await sorted('probability_asc', nullSort.json().nextCursor);
  expect(nextNull.statusCode, nextNull.body).toBe(200);
  expect(nextNull.json()).toMatchObject({
    items: [{ probabilityBasisPoints: null }],
    nextCursor: null,
  });
  expect(nextNull.json().items[0].id).not.toBe(nullSort.json().items[0].id);

  const request = {
    pipelineId: HOME_SALES_PIPELINE_ID,
    filters: { stage: 'new', sourceId, search: '10%' },
    columns: ['lead_name', 'stage', 'converted', 'email', 'phone'],
    format: 'csv',
    contactPurpose: 'marketing',
  };
  const review = (body = request, as = company.owner) =>
    call(ctx, 'POST', reports + '/preview', { as, body });
  const queue = (body: object, as = company.owner) => call(ctx, 'POST', reports, { as, body });
  expect((await review(request, company.as('salesperson'))).statusCode).toBe(403);
  expect((await review({ ...request, pipelineId: randomUUID() })).statusCode).toBe(400);
  const preview = await review();
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.json()).toMatchObject({
    rowCount: 2,
    includedColumns: request.columns,
    omittedColumns: [],
  });
  expect(preview.body).not.toContain('buyer.example');
  const command = {
    ...request,
    clientRequestId: randomUUID(),
    viewFingerprint: preview.json().viewFingerprint,
  };
  expect((await queue({ ...command, filters: { stage: 'attempting_contact' } })).statusCode).toBe(
    409,
  );
  const first = await queue(command);
  expect(first.statusCode, first.body).toBe(201);
  const id = first.json().id as string;
  const replay = await queue(command);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json().id).toBe(id);
  expect(
    (await call(ctx, 'GET', reports + '/' + id + '/file', { as: company.owner })).statusCode,
  ).toBe(409);
  expect(
    (await call(ctx, 'GET', reports + '/' + id + '/file', { as: foreign.owner })).statusCode,
  ).toBe(404);
  expect(
    (await call(ctx, 'GET', reports + '/' + id + '/file', { as: company.as('admin') })).statusCode,
  ).toBe(404);

  const admin = company.as('admin');
  await ctx.owner
    .client`insert into public.permission_overrides (org_id, membership_id, action, effect)
    values (${company.orgId}, ${admin.membershipId}, 'enterprise_sales:export_contacts', 'deny')`;
  const jsonRequest = {
    ...request,
    format: 'json',
    filters: { ...request.filters, sort: 'name_asc' },
  };
  const jsonPreview = await review(jsonRequest, admin);
  expect(jsonPreview.statusCode, jsonPreview.body).toBe(200);
  expect(jsonPreview.json()).toMatchObject({
    includedColumns: ['lead_name', 'stage', 'converted'],
    omittedColumns: ['email', 'phone'],
    rowCount: 2,
  });
  const redacted = await queue(
    {
      ...jsonRequest,
      viewFingerprint: jsonPreview.json().viewFingerprint,
      clientRequestId: randomUUID(),
    },
    admin,
  );
  expect(redacted.statusCode, redacted.body).toBe(201);

  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: { 'sales.report_export': taskList['sales.report_export']! },
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  const download = (reportId: string, as = company.owner) =>
    call(ctx, 'GET', reports + '/' + reportId + '/file', { as });
  const csv = await download(id);
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.body.split('\r\n').filter(Boolean)).toEqual([
    'lead_name,stage,converted,email,phone',
    'Export 10% anonymous,new,false,,',
    "'=Export 10% included,new,false,granted@buyer.example,",
  ]);
  expect(csv.headers.etag).toBe('"' + createHash('sha256').update(csv.body).digest('hex') + '"');
  expect(csv.headers['cache-control']).toBe('private, no-store');
  const json = await download(redacted.json().id, admin);
  expect(json.statusCode, json.body).toBe(200);
  expect(json.json()).toMatchObject({
    columns: ['lead_name', 'stage', 'converted'],
    rows: [
      { lead_name: '=Export 10% included', stage: 'new', converted: false },
      { lead_name: 'Export 10% anonymous', stage: 'new', converted: false },
    ],
  });
  expect(json.body).not.toMatch(/buyer\.example|email|phone|402555/);
  const trail = await ctx.owner
    .client`select resource_id, after from public.audit_events where org_id = ${company.orgId} and action = 'sales.report_export_queued'`;
  expect(trail).toHaveLength(2);
  expect(JSON.stringify(trail)).not.toMatch(/buyer\.example|402555|10%/);
  await ctx.owner
    .client`update enterprise_suite.sales_leads set consent = jsonb_set(consent, '{marketing,email}', '"declined"') where id = ${allowedId}`;
  expect((await download(id)).statusCode).toBe(409);
  expect((await download(redacted.json().id, admin)).statusCode).toBe(200);
}, 60_000);
