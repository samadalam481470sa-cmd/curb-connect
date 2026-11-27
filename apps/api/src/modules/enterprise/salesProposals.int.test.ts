import { createHash, randomUUID } from 'node:crypto';
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
import { withPlanDocument } from '../../services/plan-pdf';

let ctx: TestContext;
const leads = '/v1/enterprise/sales/leads';
const templates = '/v1/enterprise/sales/proposal-templates';
const revision = (value: number) => ({ 'if-match': '"' + value + '"' });

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_proposal_issues where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_proposal_template_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_estimate_pricing_approvals where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_estimate_drafts where org_id = any(${orgIds}::uuid[])`;
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

it('locks the approved sell total into one customer-safe proposal PDF', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator', 'read_only'] });
  const other = await createCompany(ctx);
  const owner = company.owner;
  const rep = company.as('salesperson');
  for (const tenant of [company, other]) {
    const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
  }

  async function post(
    path: string,
    body: object,
    expected: number,
    as: TestSession = owner,
    base?: number,
  ) {
    const result = await call(ctx, 'POST', path, {
      as,
      body,
      headers: base === undefined ? undefined : revision(base),
    });
    expect(result.statusCode, result.body).toBe(expected);
    return result.json();
  }
  const buyer = await post(
    '/v1/customers',
    { kind: 'person', displayName: 'Proposal fixture buyer' },
    201,
  );
  const contact = await post(
    '/v1/customers/' + buyer.id + '/contacts',
    {
      displayName: 'Proposal fixture buyer',
      email: 'proposal-fixture@example.test',
    },
    201,
  );
  const unrelated = await post(
    '/v1/customers/' + buyer.id + '/contacts',
    {
      displayName: 'Unrelated contact',
      email: 'different@example.test',
    },
    201,
  );
  const source = await post(leads + '/sources', { name: 'Proposal fixture lead source' }, 201);
  const selection = await post(
    '/v1/home-sales/options',
    { name: 'Accessible entry', category: 'structural' },
    201,
  );
  const proposalTemplate = await post(
    templates + '/approval',
    {
      name: 'Approved proposal terms',
      terms: ['Changes require a signed amendment.'],
      paymentTerms: ['Invoice on completion.'],
      taxTreatment: 'Tax shown as a separate line.',
      reason: 'Approved customer wording.',
      clientRequestId: randomUUID(),
    },
    201,
    owner,
    0,
  );
  const intake = {
    name: 'Proposal fixture buyer',
    email: 'proposal-fixture@example.test',
    sourceId: source.id,
    contactMethod: 'email',
    consent: {},
  };
  const leadPreview = await post(leads + '/preview', intake, 200, rep);
  const lead = await post(
    leads,
    {
      ...intake,
      clientRequestId: randomUUID(),
      previewFingerprint: leadPreview.previewFingerprint,
    },
    201,
    rep,
    0,
  );
  const record = '/v1/enterprise/sales/opportunities/' + lead.id;
  const estimate = record + '/estimate';
  const proposal = record + '/proposals';
  await post(
    leads + '/' + lead.id + '/interactions',
    {
      channel: 'meeting',
      outcome: 'contacted',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      notes: 'Private buyer notes must remain internal.',
      clientRequestId: randomUUID(),
    },
    201,
    rep,
    1,
  );
  await post(
    record + '/stage',
    {
      targetStageId: SALES_PIPELINE_STAGES.find(({ key }) => key === 'qualified')?.id,
      clientRequestId: randomUUID(),
    },
    201,
    rep,
    2,
  );
  await post(
    estimate,
    {
      title: 'Proposed renovation scope',
      currency: 'USD',
      optionIds: [selection.id],
      questionnaire: { requirements: 'Internal budget limits stay private.' },
      clientRequestId: randomUUID(),
    },
    201,
    rep,
    3,
  );
  await post(
    record + '/stage',
    {
      targetStageId: SALES_PIPELINE_STAGES.find(({ key }) => key === 'estimating')?.id,
      clientRequestId: randomUUID(),
    },
    201,
    rep,
    4,
  );
  const template = {
    estimateRevisionId: randomUUID(),
    templateRevisionId: proposalTemplate.id,
    contactId: contact.id,
    validUntil: '2099-04-01',
    clientRequestId: randomUUID(),
  };
  await post(proposal, template, 412, rep, 5);
  const pricing = {
    baseSellMinor: 24_000_000,
    taxMinor: 10_000,
    includedScope: ['Install accessible entry and framing.'],
    excludedScope: ['Site landscaping excluded.'],
    allowances: [{ description: 'Fixtures', amountMinor: 350_000 }],
  };
  const incomplete = await post(estimate + '/pricing/review', pricing, 200, owner);
  expect(incomplete.readyForApproval).toBe(false);
  await post(
    estimate + '/pricing/approval',
    {
      ...pricing,
      priceReview: incomplete.priceReview,
      reason: 'Checked current scope.',
      clientRequestId: randomUUID(),
    },
    409,
    owner,
    5,
  );
  const priced = { ...pricing, optionPricing: [{ optionId: selection.id, amountMinor: 550_000 }] };
  const reviewed = await post(estimate + '/pricing/review', priced, 200, owner);
  expect(reviewed).toMatchObject({
    optionsMinor: 550_000,
    allowancesMinor: 350_000,
    subtotalMinor: 24_900_000,
    totalMinor: 24_910_000,
    readyForApproval: true,
  });
  await post(
    estimate + '/pricing/approval',
    {
      ...priced,
      priceReview: incomplete.priceReview,
      reason: 'Checked current scope.',
      clientRequestId: randomUUID(),
    },
    412,
    owner,
    5,
  );
  const choice = {
    ...priced,
    priceReview: reviewed.priceReview,
    reason: 'Checked approved buyer scope.',
    clientRequestId: randomUUID(),
  };
  await post(estimate + '/pricing/approval', choice, 403, rep, 5);
  const approved = await post(estimate + '/pricing/approval', choice, 201, owner, 5);
  expect(await post(estimate + '/pricing/approval', choice, 200, owner, 5)).toEqual(approved);
  const generating = { ...template, estimateRevisionId: approved.id };
  await post(proposal, { ...generating, contactId: unrelated.id }, 404, rep, 6);
  await post(proposal, { ...generating, validUntil: '2000-01-01' }, 400, rep, 6);
  const generated = await post(proposal, generating, 201, rep, 6);
  expect(generated).toMatchObject({
    estimateRevisionId: approved.id,
    totalMinor: 24_910_000,
    currency: 'USD',
    revision: 7,
  });
  expect(await post(proposal, generating, 200, rep, 6)).toEqual(generated);
  await post(proposal, { ...generating, validUntil: '2099-05-01' }, 409, rep, 6);

  const pdf = await call(ctx, 'GET', proposal + '/pdf', { as: rep });
  expect(pdf.statusCode, pdf.body.slice(0, 100)).toBe(200);
  expect(pdf.headers['content-type']).toMatch(/^application\/pdf/);
  expect(pdf.headers['cache-control']).toBe('private, no-store');
  expect(createHash('sha256').update(pdf.rawPayload).digest('hex')).toBe(generated.pdfSha256);
  await withPlanDocument(new Uint8Array(pdf.rawPayload), 10_000, true, async (document) => {
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      pages.push(
        (await page.getTextContent()).items
          .flatMap((item) => ('str' in item ? [item.str] : []))
          .join(' '),
      );
    }
    const text = pages.join(' ');
    expect(text).toContain('$249,100.00');
    expect(text).toContain('Proposal fixture buyer');
    expect(text).toContain('Install accessible entry and framing.');
    expect(text).toContain('Site landscaping excluded.');
    expect(text).toContain('Fixtures');
    expect(text).toContain('Changes require a signed amendment.');
    expect(text).not.toContain('Internal budget limits');
    expect(text).not.toContain('Private buyer notes');
  });
  expect((await call(ctx, 'GET', proposal + '/pdf', { as: other.owner })).statusCode).toBe(404);
  const linked = '/v1/proposals/' + generated.proposalId;
  const native = await call(ctx, 'GET', linked, { as: owner });
  expect(native.statusCode, native.body).toBe(200);
  expect(native.json()).toMatchObject({
    status: 'draft',
    currentVersion: { total: { amountMinor: approved.totalMinor, currency: 'USD' } },
  });
  const oldRole = company.as('read_only');
  expect((await call(ctx, 'GET', linked, { as: oldRole })).statusCode).toBe(404);
  const list = await call(ctx, 'GET', '/v1/proposals', { as: oldRole });
  expect(list.json().items).toEqual([]);
  await post(linked + '/versions', {}, 409, owner);
  expect(
    (
      await call(ctx, 'PATCH', linked + '/versions/' + generated.proposalVersionId, {
        as: owner,
        body: { taxMinor: 0 },
      })
    ).statusCode,
  ).toBe(409);

  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  const mailSent = ctx.mail.sent.length;
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: {
      'sales.estimate_pricing_approved': taskList['sales.estimate_pricing_approved']!,
      'sales.proposal_generated': taskList['sales.proposal_generated']!,
    },
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  expect(ctx.mail.sent).toHaveLength(mailSent);
  const notifications = await ctx.owner
    .client`select recipient_membership_id, channel from public.notifications
    where org_id = ${company.orgId} and dedupe_key = ${'sales.proposal_generated:' + generated.id + ':in_app'}`;
  expect(notifications).toEqual([{ recipient_membership_id: rep.membershipId, channel: 'in_app' }]);
}, 60_000);
