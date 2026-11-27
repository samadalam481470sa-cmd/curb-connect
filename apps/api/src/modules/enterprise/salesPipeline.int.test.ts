import { randomUUID } from 'node:crypto';
import { SALES_PIPELINE_STAGES } from '@fieldline/contracts';
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
const pipeline = '/v1/enterprise/sales/pipeline';
const revision = (value: number) => ({ 'if-match': '"' + value + '"' });
type Stage = (typeof SALES_PIPELINE_STAGES)[number]['key'];

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_stage_events where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_follow_ups where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_interactions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_activities where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_leads where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_sources where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});
afterAll(async () => ctx?.close());

it('requires next activity, records exact stage duration and updates the scoped pipeline once', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator'] });
  const foreign = await createCompany(ctx);
  const rep = company.as('salesperson');
  for (const tenant of [company, foreign]) {
    const suite = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(suite.statusCode, suite.body).toBe(200);
  }
  const source = await call(ctx, 'POST', leads + '/sources', {
    as: company.owner,
    body: { name: 'Pipeline fixture source' },
  });
  expect(source.statusCode, source.body).toBe(201);
  const input = {
    name: 'Pipeline prospect',
    sourceId: source.json().id,
    contactMethod: 'none',
    consent: {},
  };
  const preview = await call(ctx, 'POST', leads + '/preview', { as: rep, body: input });
  expect(preview.statusCode, preview.body).toBe(200);
  const lead = await call(ctx, 'POST', leads, {
    as: rep,
    headers: revision(0),
    body: {
      ...input,
      clientRequestId: randomUUID(),
      previewFingerprint: preview.json().previewFingerprint,
    },
  });
  expect(lead.statusCode, lead.body).toBe(201);
  const leadId = lead.json().id as string;
  const opportunity = '/v1/enterprise/sales/opportunities/' + leadId;
  const initial = await call(ctx, 'GET', opportunity, { as: rep });
  expect(initial.statusCode, initial.body).toBe(200);
  expect(initial.json()).toMatchObject({
    stage: { key: 'new' },
    revision: 1,
    history: [],
    nextActivityAt: null,
    possibleTransitions: expect.arrayContaining([
      expect.objectContaining({
        stage: expect.objectContaining({ key: 'attempting_contact' }),
        blockedReason: 'Schedule a future next activity before advancing.',
      }),
    ]),
  });
  expect((await call(ctx, 'GET', opportunity, { as: foreign.owner })).statusCode).toBe(404);
  expect((await call(ctx, 'GET', pipeline, { as: company.as('estimator') })).statusCode).toBe(403);
  const body = (target: Stage) => ({
    targetStageId: SALES_PIPELINE_STAGES.find(({ key }) => key === target)?.id,
    clientRequestId: randomUUID(),
  });
  const advance = (command: object, base: number, as = rep) =>
    call(ctx, 'POST', opportunity + '/stage', { as, headers: revision(base), body: command });
  const attempting = body('attempting_contact');
  expect((await advance(attempting, 1)).statusCode).toBe(409);
  expect((await advance(attempting, 1, foreign.owner)).statusCode).toBe(404);
  const unsigned = await advance(body('contract_signed'), 1);
  expect(unsigned.statusCode).toBe(409);
  expect(unsigned.body).toContain('A verified signed contract is required.');
  expect((await advance(body('lost'), 1)).statusCode).toBe(400);
  const before = await call(ctx, 'GET', pipeline + '?stage=new', { as: rep });
  expect(before.json()).toMatchObject({
    items: [{ id: leadId }],
    counts: [{ stage: { key: 'new' }, count: 1 }],
  });

  const now = Date.now();
  const nextActivityAt = new Date(now + 86_400_000).toISOString();
  const task = await call(ctx, 'POST', leads + '/' + leadId + '/interactions', {
    as: rep,
    headers: revision(1),
    body: {
      channel: 'call',
      outcome: 'contacted',
      notes: 'Private call evidence',
      clientRequestId: randomUUID(),
      occurredAt: new Date(now - 60_000).toISOString(),
      nextAt: nextActivityAt,
    },
  });
  expect(task.statusCode, task.body).toBe(201);
  expect((await advance(attempting, 1)).statusCode).toBe(412);
  const stageEntry = await advance(attempting, 2);
  expect(stageEntry.statusCode, stageEntry.body).toBe(201);
  const transition = stageEntry.json();
  expect(transition).toMatchObject({
    from: { key: 'new' },
    to: { key: 'attempting_contact' },
    revision: 3,
  });
  expect(transition.previousStageDurationMs).toBe(
    Date.parse(transition.recordedAt) - Date.parse(initial.json().stageEnteredAt),
  );
  expect((await advance(attempting, 2)).json()).toEqual(transition);
  const qualified = await advance(body('qualified'), 3);
  expect(qualified.statusCode, qualified.body).toBe(201);
  const moved = qualified.json();
  expect(moved.previousStageDurationMs).toBe(
    Date.parse(moved.recordedAt) - Date.parse(transition.recordedAt),
  );
  const detail = await call(ctx, 'GET', opportunity, { as: rep });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json()).toMatchObject({
    stage: { key: 'qualified' },
    history: [{ id: moved.id }, { id: transition.id }],
    nextActivityAt,
    possibleTransitions: expect.arrayContaining([
      expect.objectContaining({
        stage: expect.objectContaining({ key: 'estimating' }),
        blockedReason: 'Create an estimate from this opportunity before advancing.',
      }),
    ]),
  });
  expect(detail.body).not.toContain('Private call evidence');
  const filtered = await call(ctx, 'GET', pipeline + '?stage=qualified', { as: rep });
  expect(filtered.json()).toMatchObject({
    items: [{ id: leadId, stage: { key: 'qualified' } }],
    counts: [{ stage: { key: 'qualified' }, count: 1 }],
  });
  expect((await call(ctx, 'GET', pipeline + '?stage=new', { as: rep })).json()).toMatchObject({
    items: [],
    counts: [],
  });

  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: { 'sales.stage_changed': taskList['sales.stage_changed']! },
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  const notifications = await ctx.owner
    .client`select recipient_membership_id, channel from public.notifications
    where org_id = ${company.orgId} and dedupe_key like 'sales.stage_changed:%'`;
  expect(notifications).toEqual([
    { recipient_membership_id: rep.membershipId, channel: 'in_app' },
    { recipient_membership_id: rep.membershipId, channel: 'in_app' },
  ]);
}, 60_000);
