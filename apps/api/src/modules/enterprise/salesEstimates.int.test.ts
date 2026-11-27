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
  type TestSession,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';

let ctx: TestContext;
const leads = '/v1/enterprise/sales/leads';
const estimateTemplates = '/v1/enterprise/sales/estimate-templates';
const revision = (value: number) => ({ 'if-match': '"' + value + '"' });

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_estimate_drafts where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_estimate_template_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_stage_events where org_id = any(${orgIds}::uuid[])`;
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

it('pins approved estimate inputs and reports a live lot hold without reserving inventory', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator'] });
  const outside = await createCompany(ctx);
  const rep = company.as('salesperson');
  const owner = company.owner;
  for (const tenant of [company, outside]) {
    const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
  }
  async function create(
    path: string,
    body: object,
    as: TestSession = owner,
    expected = 201,
    rev?: number,
  ) {
    const result = await call(ctx, 'POST', path, {
      as,
      body,
      headers: rev === undefined ? undefined : revision(rev),
    });
    expect(result.statusCode, result.body).toBe(expected);
    return result.json();
  }
  const source = await create(leads + '/sources', { name: 'Builder consultation' });
  const community = await create('/v1/land-management/communities', { name: 'Fixture Prairie' });
  const lot = await create('/v1/land-management/communities/' + community.id + '/lots', {
    lotNumber: 'E-17',
    priceMinor: 4_500_000,
  });
  const otherCommunity = await create(
    '/v1/land-management/communities',
    { name: 'Other company' },
    outside.owner,
  );
  const otherLot = await create(
    '/v1/land-management/communities/' + otherCommunity.id + '/lots',
    { lotNumber: 'N-89' },
    outside.owner,
  );
  const plan = await create('/v1/studio-houses', {
    name: 'Prairie Ranch',
    source: 'ai',
    brief: 'Three bedroom ranch',
    spec: {
      lengthFt: 52,
      widthFt: 34,
      stories: 1,
      bedrooms: 3,
      bathrooms: 2,
      garage: 'two_car',
      wallHeightFt: 9,
      roofPitch: 6,
    },
    settings: {},
  });
  const option = await create('/v1/home-sales/options', {
    name: 'Quartz selection',
    category: 'finish',
    priceMinor: 125_000,
  });
  const unpriced = await create('/v1/home-sales/options', {
    name: 'Custom elevation',
    category: 'elevation',
  });
  const baseTemplate = await create('/v1/estimate-templates', {
    name: 'Fixture preconstruction',
    budgetLines: [{ costCode: '06', label: 'Framing', budgetMinor: 400_000 }],
    questionnaire: [{ key: 'finish', prompt: 'Which finish?' }],
  });
  const approvalInput = {
    sourceTemplateId: baseTemplate.id,
    laborAssumptions: 'Two-person crew on framing.',
    reason: 'Approved by estimating.',
    clientRequestId: randomUUID(),
  };
  expect(
    (
      await call(ctx, 'POST', estimateTemplates + '/approval', {
        as: rep,
        body: approvalInput,
        headers: revision(0),
      })
    ).statusCode,
  ).toBe(403);
  const template = await create(estimateTemplates + '/approval', approvalInput, owner, 201, 0);
  expect((await create(estimateTemplates + '/approval', approvalInput, owner, 200, 0)).id).toBe(
    template.id,
  );
  const replaced = await call(ctx, 'PATCH', '/v1/estimate-templates/' + baseTemplate.id, {
    as: owner,
    body: { budgetLines: [{ costCode: '06', label: 'Future framing', budgetMinor: 900_000 }] },
  });
  expect(replaced.statusCode, replaced.body).toBe(200);

  // The catalog module has no mutation API. Seed the existing tables with a revision
  // and production rate, then approve it before using the normal Sales endpoints.
  const [book] = await ctx.owner.client`insert into public.price_books (org_id, name, product_line)
    values (${company.orgId}, 'Approved building catalog', 'commercial') returning id`;
  if (!book) throw new Error('The fixture price book was not created.');
  const bookId = book.id;
  async function catalogRevision(revisionNumber: number, rate: string) {
    const [catalog] = await ctx.owner
      .client`insert into public.price_book_revisions (org_id, price_book_id, revision_number, effective_from)
      values (${company.orgId}, ${bookId}, ${revisionNumber}, '2025-01-01') returning id`;
    if (!catalog) throw new Error('The fixture catalog revision was not created.');
    await ctx.owner
      .client`insert into public.production_rates (org_id, price_book_revision_id, code, label, unit, units_per_hour, crew_size)
      values (${company.orgId}, ${catalog.id}, 'FR-06', 'Framing crew', 'sq_ft', ${rate}, 2)`;
    await ctx.owner
      .client`update public.price_book_revisions set status = 'approved', approved_at = now(), approved_by_user_id = ${owner.userId}
      where id = ${catalog.id}`;
    return catalog.id as string;
  }
  const pricedCatalog = await catalogRevision(1, '12.5');

  const input = {
    name: 'Buyer in Prairie',
    contactMethod: 'email',
    consent: {},
    sourceId: source.id,
    communityId: community.id,
  };
  const preview = await create(leads + '/preview', input, rep, 200);
  const lead = await create(
    leads,
    { ...input, clientRequestId: randomUUID(), previewFingerprint: preview.previewFingerprint },
    rep,
    201,
    0,
  );
  const opportunity = '/v1/enterprise/sales/opportunities/' + lead.id;
  const estimate = opportunity + '/estimate';
  const draftBody = {
    title: 'Prairie ranch scope',
    currency: 'USD',
    planId: plan.id,
    lotId: lot.id,
    templateRevisionId: template.id,
    catalogRevisionId: pricedCatalog,
    optionIds: [option.id, unpriced.id],
    questionnaire: {
      requirements: 'Quartz and an accessible entry.',
      targetBudgetMinor: 36_000_000,
      preferredMoveOn: '2099-01-01',
    },
    clientRequestId: randomUUID(),
  };
  expect(
    (await call(ctx, 'POST', estimate, { as: rep, headers: revision(1), body: draftBody }))
      .statusCode,
  ).toBe(409);
  await create(
    leads + '/' + lead.id + '/interactions',
    {
      channel: 'meeting',
      outcome: 'contacted',
      notes: 'Buyer confirmed draft requirements.',
      occurredAt: new Date(Date.now() - 65_000).toISOString(),
      clientRequestId: randomUUID(),
    },
    rep,
    201,
    1,
  );
  await create(
    opportunity + '/stage',
    {
      targetStageId: SALES_PIPELINE_STAGES.find(({ key }) => key === 'qualified')?.id,
      clientRequestId: randomUUID(),
    },
    rep,
    201,
    2,
  );
  expect((await call(ctx, 'GET', estimate + '/options', { as: outside.owner })).statusCode).toBe(
    404,
  );
  expect(
    (await call(ctx, 'GET', estimate + '/options', { as: company.as('estimator') })).statusCode,
  ).toBe(403);
  const available = await call(ctx, 'GET', estimate + '/options', { as: rep });
  expect(available.statusCode, available.body).toBe(200);
  expect(available.json()).toMatchObject({
    canCreate: true,
    revision: 3,
    plans: [{ id: plan.id }],
    lots: [{ id: lot.id, status: 'held' }],
    approvedTemplates: [{ id: template.id }],
    catalogs: [{ revisionId: pricedCatalog }],
  });
  expect(
    (
      await call(ctx, 'POST', estimate, {
        as: rep,
        headers: revision(3),
        body: { ...draftBody, lotId: otherLot.id },
      })
    ).statusCode,
  ).toBe(404);
  const saved = await create(estimate, draftBody, rep, 201, 3);
  expect(saved).toMatchObject({
    opportunityId: lead.id,
    revision: 4,
    status: 'draft',
    currentLotStatus: 'held',
    lotHold: true,
    knownOptionSubtotalMinor: '125000',
    unpricedOptionIds: [unpriced.id],
    snapshot: {
      buyerName: 'Buyer in Prairie',
      pricingAsOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      plan: { id: plan.id, revision: 1 },
      lot: { id: lot.id, lotNumber: 'E-17', status: 'held' },
      defaultLaborRates: [{ code: 'FR-06', unitsPerHour: '12.500000', crewSize: 2 }],
      template: {
        id: template.id,
        laborAssumptions: approvalInput.laborAssumptions,
        lines: [{ label: 'Framing', budgetMinor: 400_000 }],
      },
      catalog: { revisionId: pricedCatalog, revisionNumber: 1 },
      questionnaire: draftBody.questionnaire,
    },
  });
  expect(
    await create(
      estimate,
      { ...draftBody, optionIds: [...draftBody.optionIds].reverse() },
      rep,
      200,
      3,
    ),
  ).toEqual(saved);
  const unchangedLot = await call(ctx, 'GET', '/v1/land-management/lots/' + lot.id, { as: owner });
  expect(unchangedLot.json()).toMatchObject({ lot: { status: 'held', contractId: null } });
  const released = await call(ctx, 'PATCH', '/v1/land-management/lots/' + lot.id, {
    as: owner,
    body: { status: 'available' },
  });
  expect(released.statusCode, released.body).toBe(200);
  const optionUpdated = await call(ctx, 'PATCH', '/v1/home-sales/options/' + option.id, {
    as: owner,
    body: { priceMinor: 300_000 },
  });
  expect(optionUpdated.statusCode, optionUpdated.body).toBe(200);
  const nextCatalog = await catalogRevision(2, '26');
  expect(nextCatalog).not.toBe(pricedCatalog);
  const reopened = await call(ctx, 'GET', estimate, { as: rep });
  expect(reopened.statusCode, reopened.body).toBe(200);
  expect(reopened.json()).toEqual({ ...saved, currentLotStatus: 'available', lotHold: false });
  await create(
    opportunity + '/stage',
    {
      targetStageId: SALES_PIPELINE_STAGES.find(({ key }) => key === 'estimating')?.id,
      clientRequestId: randomUUID(),
    },
    rep,
    201,
    4,
  );
  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: { 'sales.estimate_created': taskList['sales.estimate_created']! },
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  const notifications = await ctx.owner
    .client`select recipient_membership_id, channel from public.notifications
    where org_id = ${company.orgId} and dedupe_key = ${'sales.estimate_created:' + saved.id + ':in_app'}`;
  expect(notifications).toEqual([{ recipient_membership_id: rep.membershipId, channel: 'in_app' }]);
}, 60_000);
