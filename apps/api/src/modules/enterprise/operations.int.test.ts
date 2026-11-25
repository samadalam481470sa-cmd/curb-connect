import { randomUUID } from 'node:crypto';
import { sha256Hex } from '@fieldline/pdf';
import { withPlanDocument } from '../../services/plan-pdf';
import { pdfFromContent, pdfFromPages } from '../../../test/fixtures/plan-pdf';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  type Company,
  type TestContext,
  type TestSession,
} from '../../../test/helpers';

let ctx: TestContext;
const queue = '/v1/enterprise/change-orders';
const projectRoute = '/v1/enterprise/projects';

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.change_pricing_revisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.change_orders where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.punch_items where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.purchase_orders where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.purchase_cost_codes where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.bid_quote_reviews where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.bid_quotes where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.bid_packages where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.daily_logs where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_template_applications where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_templates where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_baselines where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_tasks where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.document_reviews where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_markup_exports where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_comparison_notes where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.project_estimate_line_edits where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.project_estimate_transfer_mappings where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.project_estimate_transfers where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.project_estimate_lines where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.project_estimate_revisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.project_estimates where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_measurement_reviews where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_condition_assignments where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_conditions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_count_markers where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_count_sets where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_areas where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_lengths where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_categories where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_calibration_change_requests where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_calibration_lock_revisions where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_calibrations where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_plan_sheets where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.takeoff_plan_sets where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.documents where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.document_sets where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.projects where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => {
  await ctx?.close();
});

async function project(company: Company, name: string): Promise<string> {
  const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
    as: company.owner,
    body: { enabled: true },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const created = await call(ctx, 'POST', projectRoute, {
    as: company.owner,
    body: { name, originalContractMinor: 100_000 },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().id;
}

async function approveScaleChange(
  path: string,
  input: object,
  revision: number,
  estimator: TestSession,
  lead: TestSession,
) {
  const request = await call(ctx, 'POST', path + '/change-requests', {
    as: estimator,
    headers: { 'if-match': '"' + revision + '"' },
    body: {
      input,
      reason: 'Update the checked reference dimension.',
      clientRequestId: randomUUID(),
    },
  });
  expect(request.statusCode, request.body).toBe(201);
  const decision = await call(
    ctx,
    'POST',
    path + '/change-requests/' + request.json().id + '/decide',
    {
      as: lead,
      headers: { 'if-match': '"1"' },
      body: { decision: 'approved', reason: 'Reviewed the proposed scale.' },
    },
  );
  expect(decision.statusCode, decision.body).toBe(200);
  return decision.json().appliedCalibrationId;
}

async function createOrder(company: Company, projectId: string, title: string): Promise<string> {
  const reply = await call(ctx, 'POST', projectRoute + '/' + projectId + '/change-orders', {
    as: company.owner,
    body: { number: 'PCO-01', title, description: 'New fixture scope', amountDeltaMinor: 24_000 },
  });
  expect(reply.statusCode, reply.body).toBe(201);
  return reply.json().id;
}

describe('Enterprise change orders', () => {
  it('paginates and filters tenant records and refuses cross-company links', async () => {
    const a = await createCompany(ctx);
    const b = await createCompany(ctx);
    const projectA = await project(a, 'North project');
    const secondProjectA = await project(a, 'South project');
    const projectB = await project(b, 'Private project');
    const first = await createOrder(a, projectA, 'Fixture walls');
    const second = await createOrder(a, secondProjectA, 'Fixture trim');
    const privateOrder = await createOrder(b, projectB, 'Private change');

    const page1 = await call(ctx, 'GET', queue + '?limit=1', { as: a.owner });
    expect(page1.statusCode, page1.body).toBe(200);
    const { items, nextCursor } = page1.json();
    expect(items).toHaveLength(1);
    expect(typeof nextCursor).toBe('string');
    const page2 = await call(ctx, 'GET', queue + '?limit=1&cursor=' + nextCursor, { as: a.owner });
    expect(page2.statusCode, page2.body).toBe(200);
    expect(page2.json().nextCursor).toBeNull();
    expect(new Set([items[0].order.id, page2.json().items[0].order.id])).toEqual(
      new Set([first, second]),
    );

    const filtered = await call(
      ctx,
      'GET',
      queue + '?projectId=' + projectA + '&search=NORTH&status=pco_draft',
      { as: a.owner },
    );
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().items).toMatchObject([
      { order: { id: first }, projectName: 'North project' },
    ]);
    expect((await call(ctx, 'GET', queue + '?search=%25', { as: a.owner })).json().items).toEqual(
      [],
    );
    expect((await call(ctx, 'GET', queue + '/' + privateOrder, { as: a.owner })).statusCode).toBe(
      404,
    );
    expect(
      (await call(ctx, 'GET', queue + '?projectId=' + projectB, { as: a.owner })).statusCode,
    ).toBe(404);
  });

  it('shows immutable decision history and counts the approved amount once', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    const projectId = await project(company, 'Change history project');
    const id = await createOrder(company, projectId, 'Fixture update');
    const details = queue + '/' + id;
    const statusUrl = details + '/status';
    const stages = ['pricing_requested', 'priced', 'submitted_to_owner'];
    for (const [index, status] of stages.entries()) {
      const reply = await call(ctx, 'PATCH', statusUrl, {
        as: company.owner,
        headers: { 'if-match': '"' + (index + 1) + '"' },
        body: { status },
      });
      expect(reply.statusCode, reply.body).toBe(200);
    }
    const decision = { headers: { 'if-match': '"4"' }, body: { status: 'approved' } };
    expect(
      (await call(ctx, 'PATCH', statusUrl, { as: company.as('estimator'), ...decision }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(ctx, 'PATCH', statusUrl, { as: company.owner, ...decision })).statusCode,
    ).toBe(200);
    expect(
      (await call(ctx, 'PATCH', statusUrl, { as: company.owner, ...decision })).statusCode,
    ).toBe(412);

    const detail = await call(ctx, 'GET', details, { as: company.owner });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().order).toMatchObject({ status: 'approved', revision: 5 });
    expect(detail.json().history).toMatchObject([
      {
        previousStatus: 'submitted_to_owner',
        status: 'approved',
        revision: 5,
        actorUserId: company.owner.userId,
      },
      { previousStatus: 'priced', status: 'submitted_to_owner', revision: 4 },
      { previousStatus: 'pricing_requested', status: 'priced', revision: 3 },
      { previousStatus: 'pco_draft', status: 'pricing_requested', revision: 2 },
      { action: 'pco.created', previousStatus: null, status: 'pco_draft', revision: 1 },
    ]);
    const record = await call(ctx, 'GET', projectRoute + '/' + projectId + '/records', {
      as: company.owner,
    });
    expect(record.json().summary).toMatchObject({
      approvedChangeMinor: 24_000,
      revisedContractMinor: 124_000,
    });
  });
});

describe('Enterprise punch items', () => {
  it('keeps the punch list scoped to its project and deduplicates concurrent creates', async () => {
    const company = await createCompany(ctx);
    const outside = await createCompany(ctx);
    const projectId = await project(company, 'Room finish work');
    const outsideProject = await project(outside, 'Outside checklist');
    const url = projectRoute + '/' + projectId + '/punch-items';
    const payload = {
      title: 'Touch up finish',
      description: 'Repair wall finish beside the outlet',
      location: 'Kitchen',
      dueDate: '2026-12-15',
      clientRequestId: randomUUID(),
    };
    const [first, second] = await Promise.all([
      call(ctx, 'POST', url, { as: company.owner, body: payload }),
      call(ctx, 'POST', url, { as: company.owner, body: payload }),
    ]);
    expect([first.statusCode, second.statusCode].sort(), first.body + second.body).toEqual([
      200, 201,
    ]);
    expect(first.json().id).toBe(second.json().id);
    expect(first.json()).toMatchObject({ status: 'open', revision: 1, dueDate: '2026-12-15' });
    const list = await call(ctx, 'GET', url, { as: company.owner });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(
      (await call(ctx, 'GET', url + '?status=closed', { as: company.owner })).json().items,
    ).toEqual([]);
    expect(
      (
        await call(ctx, 'GET', projectRoute + '/' + outsideProject + '/punch-items', {
          as: company.owner,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(ctx, 'PATCH', '/v1/enterprise/punch-items/' + first.json().id + '/status', {
          as: outside.owner,
          headers: { 'if-match': '"1"' },
          body: { status: 'in_progress' },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('requires a reviewer and a current revision to verify completed work', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const projectId = await project(company, 'Finish verification');
    const create = await call(ctx, 'POST', projectRoute + '/' + projectId + '/punch-items', {
      as: company.owner,
      body: {
        title: 'Replace trim',
        description: 'Replace the trim at the jamb',
        location: 'Hall',
        clientRequestId: randomUUID(),
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const url = '/v1/enterprise/punch-items/' + create.json().id + '/status';
    const start = await call(ctx, 'PATCH', url, {
      as: company.as('estimator'),
      headers: { 'if-match': '"1"' },
      body: { status: 'in_progress' },
    });
    expect(start.statusCode, start.body).toBe(200);
    const review = await call(ctx, 'PATCH', url, {
      as: company.as('estimator'),
      headers: { 'if-match': '"2"' },
      body: { status: 'ready_for_review' },
    });
    expect(review.statusCode, review.body).toBe(200);
    const close = { status: 'closed', reviewNote: 'Trim checked against the scope.' };
    expect(
      (
        await call(ctx, 'PATCH', url, {
          as: company.as('estimator'),
          headers: { 'if-match': '"3"' },
          body: close,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(ctx, 'PATCH', url, {
          as: company.as('reviewer'),
          headers: { 'if-match': '"2"' },
          body: close,
        })
      ).statusCode,
    ).toBe(412);
    expect(
      (
        await call(ctx, 'PATCH', url, {
          as: company.as('reviewer'),
          headers: { 'if-match': '"3"' },
          body: { status: 'closed' },
        })
      ).statusCode,
    ).toBe(400);
    const closed = await call(ctx, 'PATCH', url, {
      as: company.as('reviewer'),
      headers: { 'if-match': '"3"' },
      body: close,
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({
      status: 'closed',
      revision: 4,
      reviewNote: close.reviewNote,
    });
    const [audit] = await ctx.owner.client<{ total: number }[]>`
      select count(*)::int as total from enterprise_suite.audit_events
      where org_id = ${company.orgId}::uuid and object_id = ${create.json().id}::uuid
    `;
    expect(audit?.total).toBe(4);
  });
});

describe('Enterprise construction scheduling', () => {
  it('previews downstream work, rejects stale previews and cycles, and preserves the baseline', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Other company');
    const projectId = await project(company, 'Construction schedule');
    const base = projectRoute + '/' + projectId + '/schedule';
    const as = company.owner;
    const excavation = {
      title: 'Excavate',
      phase: 'Site',
      startsOn: '2027-01-04',
      endsOn: '2027-01-08',
      predecessorId: null,
      lagDays: 0,
      progressPercent: 0,
    };
    const create = async (task: object) => {
      const request = { as, body: { ...task, clientRequestId: randomUUID() } };
      const reply = await call(ctx, 'POST', base + '/tasks', request);
      expect(reply.statusCode, reply.body).toBe(201);
      const retry = await call(ctx, 'POST', base + '/tasks', request);
      expect(retry.statusCode, retry.body).toBe(200);
      expect(retry.json().id).toBe(reply.json().id);
      return reply.json().id as string;
    };
    const id = await create(excavation);
    const framing = {
      ...excavation,
      title: 'Set forms',
      phase: 'Foundation',
      startsOn: '2027-01-05',
      endsOn: '2027-01-07',
      predecessorId: id,
      lagDays: 1,
    };
    const successor = await create(framing);
    const savedTemplate = await call(ctx, 'POST', base + '/templates', {
      as,
      body: { label: 'Slab and foundation', clientRequestId: randomUUID() },
    });
    expect(savedTemplate.statusCode, savedTemplate.body).toBe(201);
    const templates = await call(ctx, 'GET', '/v1/enterprise/schedule/templates', { as });
    expect(templates.json().items).toMatchObject([{ id: savedTemplate.json().id, taskCount: 2 }]);
    const copiedProject = await project(company, 'Template project');
    const copiedSchedule = projectRoute + '/' + copiedProject + '/schedule';
    const placement = { templateId: savedTemplate.json().id, startsOn: '2027-02-01' };
    const templatePreview = await call(ctx, 'POST', copiedSchedule + '/templates/preview', {
      as,
      body: placement,
    });
    expect(templatePreview.statusCode, templatePreview.body).toBe(200);
    expect(templatePreview.json().items).toMatchObject([
      { title: 'Excavate', startOn: '2027-02-01', endOn: '2027-02-05' },
      { title: 'Set forms', startOn: '2027-02-07', endOn: '2027-02-09' },
    ]);
    const applyTemplate = {
      as,
      body: {
        ...placement,
        previewToken: templatePreview.json().token,
        clientRequestId: randomUUID(),
      },
    };
    expect(
      (await call(ctx, 'POST', copiedSchedule + '/templates/apply', applyTemplate)).statusCode,
    ).toBe(201);
    expect(
      (await call(ctx, 'POST', copiedSchedule + '/templates/apply', applyTemplate)).statusCode,
    ).toBe(200);
    const copied = await call(ctx, 'GET', copiedSchedule, { as });
    const [parent, child] = copied.json().items;
    expect(copied.json().items).toHaveLength(2);
    expect(parent.id).not.toBe(id);
    expect(child.predecessorId).toBe(parent.id);
    expect(child.progressPercent).toBe(0);
    const baselineOptions = { body: { label: 'Approved plan', clientRequestId: randomUUID() } };
    expect(
      (
        await call(ctx, 'POST', base + '/baselines', {
          ...baselineOptions,
          as: company.as('estimator'),
        })
      ).statusCode,
    ).toBe(403);
    const baseline = await call(ctx, 'POST', base + '/baselines', { ...baselineOptions, as });
    expect(baseline.statusCode, baseline.body).toBe(201);
    expect((await call(ctx, 'GET', base, { as: outsider.owner })).statusCode).toBe(404);
    const change = { ...excavation, endsOn: '2027-01-11' };
    const target = base + '/tasks/' + id;
    const headers = { 'if-match': '"1"' };
    const preview = await call(ctx, 'POST', target + '/preview', { as, headers, body: change });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().affected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: successor,
          beforeStartOn: '2027-01-10',
          afterStartOn: '2027-01-13',
        }),
      ]),
    );
    const cycle = await call(ctx, 'POST', target + '/preview', {
      as,
      headers,
      body: { ...change, predecessorId: successor },
    });
    expect(cycle.statusCode, cycle.body).toBe(409);

    const apply = (previewToken: string) =>
      call(ctx, 'PATCH', target, {
        as,
        headers,
        body: { task: change, previewToken, reason: 'Rain delayed earthwork' },
      });
    await create({ ...excavation, title: 'Separate permit task' });
    expect((await apply(preview.json().token)).statusCode).toBe(409);
    const refreshed = await call(ctx, 'POST', target + '/preview', { as, headers, body: change });
    expect((await apply(refreshed.json().token)).statusCode).toBe(200);
    expect((await apply(refreshed.json().token)).statusCode).toBe(412);
    const schedule = await call(ctx, 'GET', base + '?baselineId=' + baseline.json().id, { as });
    expect(schedule.statusCode, schedule.body).toBe(200);
    expect(schedule.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: successor,
          forecastEndOn: '2027-01-15',
          baselineEndOn: '2027-01-12',
          varianceDays: 3,
        }),
      ]),
    );
  });
});

describe('Enterprise document vault', () => {
  it('stores private PDF versions, preserves old bytes, and checks current reviewer authority', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside project');
    const projectId = await project(company, 'Drawing vault');
    const base = projectRoute + '/' + projectId;
    const docs = base + '/documents';
    const as = company.owner;
    const original = Buffer.from('%PDF-1.4\n% original plan\n%%EOF\n');
    const update = Buffer.from('%PDF-1.4\n% revised plan\n%%EOF\n');
    const request = {
      as,
      body: {
        title: 'Roof and framing plans',
        category: 'plans',
        filename: 'plans.pdf',
        contentBase64: original.toString('base64'),
        clientRequestId: randomUUID(),
      },
    };
    const forged = await call(ctx, 'POST', docs, {
      ...request,
      body: { ...request.body, contentBase64: 'bm90IGEgcGRm' },
    });
    expect(forged.statusCode, forged.body).toBe(415);
    const uploaded = await call(ctx, 'POST', docs, request);
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const first = uploaded.json();
    expect(first).toMatchObject({
      version: 1,
      byteSize: original.length,
      scanStatus: 'not_scanned',
    });
    expect(first).not.toHaveProperty('storageKey');
    const retried = await call(ctx, 'POST', docs, request);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().id).toBe(first.id);

    const versions = docs + '/' + first.documentSetId + '/versions';
    const newFile = {
      as,
      headers: { 'if-match': '"1"' },
      body: {
        filename: 'plans-v2.pdf',
        contentBase64: update.toString('base64'),
        revisionNote: 'Corrected ridge detail',
        clientRequestId: randomUUID(),
      },
    };
    const changed = await call(ctx, 'POST', versions, newFile);
    expect(changed.statusCode, changed.body).toBe(201);
    const second = changed.json();
    expect(second).toMatchObject({ version: 2, revisionNote: 'Corrected ridge detail' });
    expect(
      (
        await call(ctx, 'POST', versions, {
          ...newFile,
          body: { ...newFile.body, clientRequestId: randomUUID() },
        })
      ).statusCode,
    ).toBe(412);
    const review = (id: string) => base + '/document-versions/' + id + '/review';
    const decision = { decision: 'approved', note: 'Signed drawing set reviewed.' };
    expect((await call(ctx, 'POST', review(first.id), { as, body: decision })).statusCode).toBe(
      409,
    );
    expect(
      (await call(ctx, 'POST', review(second.id), { as: company.as('estimator'), body: decision }))
        .statusCode,
    ).toBe(403);
    const approved = await call(ctx, 'POST', review(second.id), {
      as: company.as('reviewer'),
      body: decision,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().review).toMatchObject(decision);

    const detail = await call(ctx, 'GET', docs + '/' + first.documentSetId, { as });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().versions).toMatchObject([
      { id: second.id, review: decision },
      { id: first.id, review: null },
    ]);
    const download = base + '/document-versions/' + first.id + '/download';
    const read = await call(ctx, 'GET', download, { as });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.headers['content-disposition']).toBe('attachment; filename="plans.pdf"');
    expect(read.rawPayload).toEqual(original);
    expect((await call(ctx, 'GET', download, { as: outsider.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'GET', docs, { as: outsider.owner })).statusCode).toBe(404);
  });
});

describe('Enterprise change order pricing', () => {
  it('calculates signed lines, locks submitted pricing, and rolls the approved amount into costing', async () => {
    const company = await createCompany(ctx);
    const projectId = await project(company, 'Change order project');
    const id = await createOrder(company, projectId, 'Additional cabinets');
    const as = company.owner;
    const path = queue + '/' + id;
    const body = {
      scope: 'Add cabinet pull-out and credit the replaced shelving.',
      scheduleImpactDays: 2,
      revisionNote: 'Priced owner selection',
      evidenceVersionId: null,
      clientRequestId: randomUUID(),
      lines: [
        {
          description: 'Install cabinet pull-out',
          unit: 'hour',
          direction: 'add',
          quantityMilli: 1250,
          unitCostMinor: 10005,
          markupBps: 1000,
          taxBps: 825,
        },
        {
          description: 'Shelving credit',
          unit: 'each',
          direction: 'deduct',
          quantityMilli: 2000,
          unitCostMinor: 2500,
          markupBps: 0,
          taxBps: 0,
        },
      ],
    };
    const options = { as, body, headers: { 'if-match': '"1"' } };
    const missingEvidence = await call(ctx, 'POST', path + '/pricing', {
      ...options,
      body: { ...body, evidenceVersionId: randomUUID() },
    });
    expect(missingEvidence.statusCode, missingEvidence.body).toBe(400);
    const pricing = await call(ctx, 'POST', path + '/pricing', options);
    expect(pricing.statusCode, pricing.body).toBe(201);
    expect(pricing.json()).toMatchObject({
      totalMinor: 9892,
      orderRevision: 2,
      scheduleImpactDays: 2,
      lines: [
        { costMinor: 12506, markupMinor: 1251, taxMinor: 1135, totalMinor: 14892 },
        { costMinor: -5000, totalMinor: -5000 },
      ],
    });
    const retry = await call(ctx, 'POST', path + '/pricing', options);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(pricing.json().id);
    expect(
      (
        await call(ctx, 'POST', path + '/pricing', {
          ...options,
          body: { ...body, clientRequestId: randomUUID() },
        })
      ).statusCode,
    ).toBe(412);

    for (const [index, status] of [
      'pricing_requested',
      'priced',
      'submitted_to_owner',
      'approved',
    ].entries()) {
      const result = await call(ctx, 'PATCH', path + '/status', {
        as,
        headers: { 'if-match': '"' + (index + 2) + '"' },
        body: { status },
      });
      expect(result.statusCode, result.body).toBe(200);
    }
    const locked = await call(ctx, 'POST', path + '/pricing', {
      as,
      headers: { 'if-match': '"6"' },
      body: { ...body, clientRequestId: randomUUID() },
    });
    expect(locked.statusCode, locked.body).toBe(409);
    const records = await call(ctx, 'GET', projectRoute + '/' + projectId + '/records', { as });
    expect(records.json().summary).toMatchObject({
      approvedChangeMinor: 9892,
      revisedContractMinor: 109892,
    });
    const history = await call(ctx, 'GET', path + '/pricing', { as });
    expect(history.json().items).toMatchObject([{ id: pricing.json().id, totalMinor: 9892 }]);
  });
});

describe('Enterprise daily site reports', () => {
  it('limits daily reports by project and date and locks the approved revision', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside daily log project');
    const projectId = await project(company, 'Site records');
    const as = company.as('estimator');
    const reviewer = company.as('reviewer');
    const root = projectRoute + '/' + projectId;
    const task = await call(ctx, 'POST', root + '/schedule/tasks', {
      as,
      body: {
        title: 'Site grading',
        phase: 'Site',
        startsOn: '2027-01-05',
        endsOn: '2027-01-06',
        predecessorId: null,
        lagDays: 0,
        progressPercent: 0,
        clientRequestId: randomUUID(),
      },
    });
    expect(task.statusCode, task.body).toBe(201);
    const path = root + '/daily-logs';
    const body = {
      workDate: '2027-01-06',
      weather: 'Light rain',
      crewCount: 2,
      laborMinutes: 900,
      workPerformed: 'Finished the rough grade.',
      safetyAndDelays: 'Stopped for rain after lunch.',
      scheduleTaskId: task.json().id,
    };
    const request = { as, body: { ...body, clientRequestId: randomUUID() } };
    const draft = await call(ctx, 'POST', path, request);
    expect(draft.statusCode, draft.body).toBe(201);
    const log = draft.json();
    expect(log).toMatchObject({ status: 'draft', revision: 1, scheduleTaskId: task.json().id });
    expect((await call(ctx, 'POST', path, request)).statusCode).toBe(200);
    expect(
      (
        await call(ctx, 'POST', path, {
          ...request,
          body: { ...request.body, clientRequestId: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    expect((await call(ctx, 'GET', path, { as: outsider.owner })).statusCode).toBe(404);

    const report = path + '/' + log.id;
    const header = (revision: number) => ({ 'if-match': '"' + revision + '"' });
    const submit = (revision: number) =>
      call(ctx, 'POST', report + '/submit', { as, headers: header(revision) });
    expect((await submit(1)).statusCode).toBe(200);
    const note = { decision: 'changes_requested', note: 'Add rain stoppage time.' };
    expect(
      (await call(ctx, 'POST', report + '/review', { as, headers: header(2), body: note }))
        .statusCode,
    ).toBe(403);
    const returned = await call(ctx, 'POST', report + '/review', {
      as: reviewer,
      headers: header(2),
      body: note,
    });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json()).toMatchObject({ status: 'changes_requested', revision: 3 });
    const correction = { ...body, safetyAndDelays: 'Rain stoppage from 1 pm to 2 pm.' };
    expect(
      (await call(ctx, 'PUT', report, { as, headers: header(2), body: correction })).statusCode,
    ).toBe(412);
    expect(
      (await call(ctx, 'PUT', report, { as, headers: header(3), body: correction })).statusCode,
    ).toBe(200);
    expect((await submit(4)).statusCode).toBe(200);
    const approved = await call(ctx, 'POST', report + '/review', {
      as: reviewer,
      headers: header(5),
      body: { decision: 'approved', note: 'Verified site report.' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', revision: 6 });
    expect(
      (await call(ctx, 'PUT', report, { as, headers: header(6), body: correction })).statusCode,
    ).toBe(409);
    const filtered = await call(ctx, 'GET', path + '?workDate=2027-01-06&status=approved', { as });
    expect(filtered.json().items).toMatchObject([{ id: log.id, status: 'approved' }]);
  });
});

describe('Enterprise vendor bidding', () => {
  it('compares actual quotes, checks stale and expired decisions, and freezes the award', async () => {
    const company = await createCompany(ctx, { roles: ['estimator'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside bidding project');
    const projectId = await project(company, 'Framing bid');
    const buyer = company.as('estimator');
    const as = company.owner;
    const path = projectRoute + '/' + projectId + '/bid-packages';
    const create = {
      as: buyer,
      body: {
        title: 'Rough carpentry',
        scope: 'Install framing per current plan',
        dueOn: '2099-01-10',
        clientRequestId: randomUUID(),
      },
    };
    const packageReply = await call(ctx, 'POST', path, create);
    expect(packageReply.statusCode, packageReply.body).toBe(201);
    expect((await call(ctx, 'POST', path, create)).statusCode).toBe(200);
    const detailPath = path + '/' + packageReply.json().id;
    const append = async (
      revision: number,
      vendorName: string,
      amountMinor: number,
      validThrough: string,
    ) => {
      const options = {
        as: buyer,
        headers: { 'if-match': '"' + revision + '"' },
        body: {
          vendorName,
          amountMinor,
          validThrough,
          qualifications: 'Includes framing fasteners',
          leadDays: 7,
          clientRequestId: randomUUID(),
        },
      };
      const result = await call(ctx, 'POST', detailPath + '/quotes', options);
      expect(result.statusCode, result.body).toBe(201);
      expect((await call(ctx, 'POST', detailPath + '/quotes', options)).statusCode).toBe(200);
      return result.json().id;
    };
    const higher = await append(1, 'North framing', 640000, '2099-02-01');
    const lower = await append(2, 'South framing', 590000, '2099-02-01');
    const expired = await append(3, 'Earlier framing', 510000, '2020-01-02');
    const comparison = await call(ctx, 'GET', detailPath, { as });
    expect(comparison.statusCode, comparison.body).toBe(200);
    expect(comparison.json().quotes.map((quote: { id: string }) => quote.id)).toEqual([
      expired,
      lower,
      higher,
    ]);
    expect((await call(ctx, 'GET', detailPath, { as: outsider.owner })).statusCode).toBe(404);
    const award = (quoteId: string, revision: number, actor = as) =>
      call(ctx, 'POST', detailPath + '/decision', {
        as: actor,
        headers: { 'if-match': '"' + revision + '"' },
        body: { quoteId, note: 'Selected best qualifying bid.' },
      });
    expect((await award(lower, 4, buyer)).statusCode).toBe(403);
    expect((await award(lower, 3)).statusCode).toBe(412);
    expect((await award(expired, 4)).statusCode).toBe(409);
    const decision = await award(lower, 4);
    expect(decision.statusCode, decision.body).toBe(200);
    expect(decision.json()).toMatchObject({
      status: 'awarded',
      awardedQuoteId: lower,
      revision: 5,
    });
    expect((await award(higher, 5)).statusCode).toBe(409);
    const lateQuote = await call(ctx, 'POST', detailPath + '/quotes', {
      as: buyer,
      headers: { 'if-match': '"5"' },
      body: {
        vendorName: 'Late bid',
        amountMinor: 450000,
        validThrough: '2099-03-01',
        qualifications: '',
        leadDays: 6,
        clientRequestId: randomUUID(),
      },
    });
    expect(lateQuote.statusCode).toBe(409);
  });
});

describe('Enterprise purchase orders', () => {
  it('converts an award once, issues against the reviewed revision, and posts committed cost once', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'finance', 'reviewer'] });
    const outsider = await createCompany(ctx);
    const projectId = await project(company, 'Commercial roof replacement');
    const otherProjectId = await project(company, 'Other purchasing project');
    await project(outsider, 'Outside purchasing project');
    const as = company.owner;
    const base = projectRoute + '/' + projectId;
    const packages = base + '/bid-packages';
    const orders = base + '/purchase-orders';
    const created = await call(ctx, 'POST', packages, {
      as,
      body: {
        title: 'Membrane replacement',
        scope: 'Replace membrane per approved drawing A-102',
        dueOn: '2099-08-09',
        clientRequestId: randomUUID(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const bidPackageId = created.json().id;
    const packagePath = packages + '/' + bidPackageId;
    const convertPath = packagePath + '/purchase-order';
    const body = {
      costCode: '07-54',
      deliveryAddress: '220 North Service Road',
      requestedDeliveryOn: null,
    };
    const revision = (value: number) => ({ 'if-match': '"' + value + '"' });
    const convert = (value: number) =>
      call(ctx, 'POST', convertPath, { as, body, headers: revision(value) });
    expect((await convert(1)).statusCode).toBe(409);

    const quote = await call(ctx, 'POST', packagePath + '/quotes', {
      as,
      headers: revision(1),
      body: {
        vendorName: 'Commercial Membranes',
        amountMinor: 460125,
        validThrough: '2099-09-01',
        qualifications: '',
        leadDays: 7,
        clientRequestId: randomUUID(),
      },
    });
    expect(quote.statusCode, quote.body).toBe(201);
    const quoteId = quote.json().id;
    const award = await call(ctx, 'POST', packagePath + '/decision', {
      as,
      headers: revision(2),
      body: { quoteId, note: 'Approved complete base scope.' },
    });
    expect(award.statusCode, award.body).toBe(200);
    expect((await convert(3)).statusCode).toBe(400);

    const code = { code: body.costCode, label: 'Membrane roofing' };
    const addCode = (member = as, target = base, values = code) =>
      call(ctx, 'POST', target + '/purchase-cost-codes', { as: member, body: values });
    expect((await addCode(company.as('estimator'))).statusCode).toBe(403);
    expect((await addCode(as, projectRoute + '/' + otherProjectId)).statusCode).toBe(201);
    expect((await convert(3)).statusCode).toBe(400);
    expect((await addCode()).statusCode).toBe(201);
    expect((await addCode()).statusCode).toBe(200);
    expect((await addCode(as, base, { ...code, label: 'Duplicate label' })).statusCode).toBe(409);
    expect((await convert(2)).statusCode).toBe(412);
    expect(
      (
        await call(ctx, 'POST', convertPath, {
          as: company.as('estimator'),
          body,
          headers: revision(3),
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(ctx, 'GET', convertPath, { as: company.as('finance') })).json()).toEqual({
      order: null,
    });

    const [first, duplicate] = await Promise.all([convert(3), convert(3)]);
    expect([first.statusCode, duplicate.statusCode].sort(), first.body + duplicate.body).toEqual([
      200, 201,
    ]);
    const draft = first.json();
    expect(duplicate.json()).toEqual(draft);
    expect(draft).toMatchObject({
      bidPackageId,
      quoteId,
      title: 'Membrane replacement',
      vendorName: 'Commercial Membranes',
      amountMinor: 460125,
      quoteValidThrough: '2099-09-01',
      status: 'draft',
      revision: 1,
      issuedAt: null,
      ...body,
    });
    expect(first.headers.etag).toBe('"1"');
    const read = async (url = orders) => {
      const response = await call(ctx, 'GET', url, { as: company.as('finance') });
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    expect(await read()).toMatchObject({
      items: [draft],
      committedTotalMinor: '0',
      commitments: [],
    });

    const orderPath = orders + '/' + draft.id;
    const change = {
      ...body,
      deliveryAddress: '221 North Service Road',
      requestedDeliveryOn: '2099-08-20',
    };
    const changeDraft = (value: number, member = as) =>
      call(ctx, 'PATCH', orderPath, { as: member, headers: revision(value), body: change });
    expect((await changeDraft(1, company.as('finance'))).statusCode).toBe(403);
    const edited = await changeDraft(1);
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ ...change, revision: 2, amountMinor: 460125 });
    expect((await changeDraft(1)).statusCode).toBe(412);
    const issue = (value: number, member = as, target = orderPath) =>
      call(ctx, 'POST', target + '/issue', { as: member, headers: revision(value), body: {} });
    expect((await issue(2, company.as('finance'))).statusCode).toBe(403);
    expect((await issue(2, outsider.owner)).statusCode).toBe(404);
    expect(
      (await issue(2, as, projectRoute + '/' + otherProjectId + '/purchase-orders/' + draft.id))
        .statusCode,
    ).toBe(404);
    expect((await call(ctx, 'GET', orders, { as: outsider.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'GET', orders, { as: company.as('reviewer') })).statusCode).toBe(403);
    expect((await issue(1)).statusCode).toBe(412);

    const [issued, retried] = await Promise.all([issue(2), issue(2)]);
    expect(issued.statusCode, issued.body).toBe(200);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(issued.json()).toEqual(retried.json());
    expect(issued.json()).toMatchObject({ id: draft.id, status: 'issued', revision: 3, ...change });
    expect(issued.json().issuedAt).toEqual(expect.any(String));
    expect((await changeDraft(3)).statusCode).toBe(409);
    expect((await convert(3)).json()).toEqual(issued.json());
    const commitment = { costCode: code.code, amountMinor: '460125' };
    expect(await read(orders + '?costCode=07-54')).toMatchObject({
      items: [issued.json()],
      committedTotalMinor: '460125',
      commitments: [commitment],
    });
    expect(await read(orders + '?costCode=00')).toMatchObject({
      items: [],
      committedTotalMinor: '460125',
      commitments: [commitment],
    });
    await expect(
      ctx.owner
        .client`update enterprise_suite.purchase_orders set revision = 4 where id = ${draft.id}`,
    ).rejects.toMatchObject({ code: 'FL001' });
    const events = await ctx.owner.client`
      select action from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${draft.id} and object_type = 'purchase_order'
    `;
    expect(events.map(({ action }) => action).sort()).toEqual([
      'purchase_order.drafted',
      'purchase_order.issued',
      'purchase_order.updated',
    ]);
  });
});

describe('Enterprise vendor bid responsiveness', () => {
  it('requires evidence and an exception for unmet scope, deduplicates reviews, and keeps reviewed quotes unchanged', async () => {
    const company = await createCompany(ctx, { roles: ['admin', 'estimator'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside review project');
    const projectId = await project(company, 'Commercial roofing procurement');
    const as = company.owner;
    const admin = company.as('admin');
    const packages = projectRoute + '/' + projectId + '/bid-packages';
    const created = await call(ctx, 'POST', packages, {
      as,
      body: {
        title: 'Roofing materials for east wing',
        scope: 'Provide membrane, adhesive, and flashing',
        dueOn: '2099-08-09',
        clientRequestId: randomUUID(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const packageId = created.json().id;
    const detailPath = packages + '/' + packageId;
    const revision = (value: number) => ({ 'if-match': '"' + value + '"' });
    const record = async (value: number, vendorName: string, amountMinor: number) => {
      const result = await call(ctx, 'POST', detailPath + '/quotes', {
        as,
        headers: revision(value),
        body: {
          vendorName,
          amountMinor,
          validThrough: '2099-09-01',
          qualifications: '',
          leadDays: 7,
          clientRequestId: randomUUID(),
        },
      });
      expect(result.statusCode, result.body).toBe(201);
      return result.json();
    };
    const low = await record(1, 'Low Price Materials', 382000);
    const high = await record(2, 'Complete Materials', 430000);
    const reviewPath = detailPath + '/quotes/' + low.id + '/reviews';
    const checklist = [
      { criterion: 'scope', result: 'does_not_meet', evidence: 'Flashing is excluded.' },
      { criterion: 'schedule', result: 'meets', evidence: 'Delivery fits the work window.' },
      {
        criterion: 'qualifications',
        result: 'meets',
        evidence: 'Submittals meet specified product criteria.',
      },
    ];
    const attempted = {
      outcome: 'responsive',
      checklist,
      rationale: 'Reviewed quote against package requirements.',
      exceptionNote: null,
      clientRequestId: randomUUID(),
    };
    const review = (value: number, body: unknown, member = admin, path = reviewPath) =>
      call(ctx, 'POST', path, { as: member, headers: revision(value), body });
    expect((await review(3, attempted)).statusCode).toBe(400);
    const rejected = { ...attempted, outcome: 'nonresponsive' };
    expect(
      (await review(3, { ...rejected, checklist: [checklist[0], checklist[1], checklist[1]] }))
        .statusCode,
    ).toBe(400);
    expect((await review(2, rejected)).statusCode).toBe(412);
    expect((await review(3, rejected, company.as('estimator'))).statusCode).toBe(403);
    expect((await review(3, rejected, outsider.owner)).statusCode).toBe(404);
    expect(
      (await review(3, rejected, admin, detailPath + '/quotes/' + randomUUID() + '/reviews'))
        .statusCode,
    ).toBe(404);

    const [first, retry] = await Promise.all([review(3, rejected), review(3, rejected)]);
    expect([first.statusCode, retry.statusCode].sort(), first.body + retry.body).toEqual([
      200, 201,
    ]);
    expect(first.json()).toEqual(retry.json());
    expect(first.json()).toMatchObject({
      quoteId: low.id,
      outcome: 'nonresponsive',
      checklist,
      packageRevision: 4,
    });
    expect(first.headers.etag).toBe('"4"');
    const award = (value: number, quoteId: string) =>
      call(ctx, 'POST', detailPath + '/decision', {
        as,
        headers: revision(value),
        body: { quoteId, note: 'Reviewed scope and documented qualifications.' },
      });
    expect((await award(4, low.id)).statusCode).toBe(409);

    const exception = {
      ...attempted,
      exceptionNote: 'Flashing will be furnished under the approved existing material order.',
      clientRequestId: randomUUID(),
    };
    const accepted = await review(4, exception);
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json()).toMatchObject({
      quoteId: low.id,
      outcome: 'responsive',
      checklist,
      rationale: exception.rationale,
      exceptionNote: exception.exceptionNote,
      packageRevision: 5,
    });
    const collection = await call(ctx, 'GET', detailPath, { as: company.as('estimator') });
    expect(collection.statusCode, collection.body).toBe(200);
    expect(collection.json()).toMatchObject({
      package: { status: 'collecting', revision: 5, awardedQuoteId: null },
      quotes: [low, high],
      reviews: [accepted.json()],
    });
    expect((await award(5, high.id)).statusCode).toBe(200);
    expect((await review(6, { ...rejected, clientRequestId: randomUUID() })).statusCode).toBe(409);
    const audit = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId}
        and object_id = ${packageId}
        and action = 'bid_package.quote_reviewed'
      order by (after_state->>'packageRevision')::int
    `;
    expect(audit).toMatchObject([
      {
        actor_user_id: admin.userId,
        after_state: { id: first.json().id, outcome: 'nonresponsive' },
      },
      {
        actor_user_id: admin.userId,
        after_state: { id: accepted.json().id, outcome: 'responsive' },
      },
    ]);
  });

  it('commits only one winner across simultaneous exclusive award decisions', async () => {
    const company = await createCompany(ctx);
    const projectId = await project(company, 'Exclusive canopy procurement');
    const as = company.owner;
    const url = projectRoute + '/' + projectId + '/bid-packages';
    const opened = await call(ctx, 'POST', url, {
      as,
      body: {
        title: 'Canopy scope',
        scope: 'Supply the complete entrance canopy',
        dueOn: '2099-08-09',
        clientRequestId: randomUUID(),
      },
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const bid = url + '/' + opened.json().id;
    const candidates = [];
    for (const number of [1, 2]) {
      const quote = await call(ctx, 'POST', bid + '/quotes', {
        as,
        headers: { 'if-match': '"' + number + '"' },
        body: {
          vendorName: 'Canopy Vendor ' + number,
          amountMinor: 700000 + number * 10000,
          validThrough: '2099-09-01',
          qualifications: '',
          leadDays: 7,
          clientRequestId: randomUUID(),
        },
      });
      expect(quote.statusCode, quote.body).toBe(201);
      candidates.push(quote.json().id);
    }
    const outcomes = await Promise.all(
      candidates.map((quoteId) =>
        call(ctx, 'POST', bid + '/decision', {
          as,
          headers: { 'if-match': '"3"' },
          body: { quoteId, note: 'Reviewed complete scope and price.' },
        }),
      ),
    );
    expect(
      outcomes.map(({ statusCode }) => statusCode).sort(),
      outcomes.map(({ body }) => body).join(' '),
    ).toEqual([200, 412]);
    const accepted = outcomes.find(({ statusCode }) => statusCode === 200)?.json();
    expect(accepted.status).toBe('awarded');
    const detail = await call(ctx, 'GET', bid, { as });
    expect(detail.json().package).toMatchObject({
      awardedQuoteId: accepted.awardedQuoteId,
      status: 'awarded',
      revision: 4,
    });
    const awards = await ctx.owner.client`
      select id from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${opened.json().id} and action = 'bid_package.awarded'
    `;
    expect(awards).toHaveLength(1);
  });
});

describe('Enterprise Takeoff plan sets', () => {
  it('imports every PDF sheet from the selected vault revisions, preserves prior versions, and deduplicates imports', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside takeoff project');
    const projectId = await project(company, 'Plan takeoff fixture');
    const secondProject = await project(company, 'Separate plans');
    const base = projectRoute + '/' + projectId;
    const as = company.owner;
    const estimator = company.as('estimator');
    const docs = base + '/documents';
    const route = base + '/takeoff/plan-sets';
    const threePages = pdfFromPages([
      { width: 1224, height: 792 },
      { width: 612, height: 792, rotation: 90 },
      { width: 1000, height: 1000 },
    ]);
    const onePage = pdfFromPages([{ width: 600, height: 600 }]);
    const planUpload = {
      title: 'Canopy drawings',
      category: 'plans',
      filename: 'canopy-IFB.pdf',
      contentBase64: Buffer.from(threePages).toString('base64'),
      clientRequestId: randomUUID(),
    };
    const original = await call(ctx, 'POST', docs, { as, body: planUpload });
    expect(original.statusCode, original.body).toBe(201);
    const version1 = original.json();
    const replacement = await call(ctx, 'POST', docs + '/' + version1.documentSetId + '/versions', {
      as,
      headers: { 'if-match': '"1"' },
      body: {
        filename: 'canopy-addendum.pdf',
        contentBase64: Buffer.from(onePage).toString('base64'),
        revisionNote: 'Added revised canopy details.',
        clientRequestId: randomUUID(),
      },
    });
    expect(replacement.statusCode, replacement.body).toBe(201);
    const version2 = replacement.json();
    const unrelated = await call(ctx, 'POST', docs, {
      as,
      body: { ...planUpload, category: 'contract', clientRequestId: randomUUID() },
    });
    expect(unrelated.statusCode, unrelated.body).toBe(201);

    const sources = await call(ctx, 'GET', base + '/takeoff/sources', { as: estimator });
    expect(sources.statusCode, sources.body).toBe(200);
    expect(
      new Set(sources.json().items.map((item: { versionId: string }) => item.versionId)),
    ).toEqual(new Set([version1.id, version2.id]));
    const input = {
      title: 'Entry canopy issued for bid',
      revisionLabel: 'IFB R1',
      versionIds: [version1.id],
      clientRequestId: randomUUID(),
    };
    const submit = (body = input, member = estimator, target = route) =>
      call(ctx, 'POST', target, { as: member, body });
    expect((await submit(input, company.as('reviewer'))).statusCode).toBe(403);
    expect((await submit(input, outsider.owner)).statusCode).toBe(404);
    expect(
      (await submit(input, estimator, projectRoute + '/' + secondProject + '/takeoff/plan-sets'))
        .statusCode,
    ).toBe(404);
    expect((await submit({ ...input, versionIds: [unrelated.json().id] })).statusCode).toBe(404);
    expect((await submit({ ...input, versionIds: [version1.id, version1.id] })).statusCode).toBe(
      400,
    );

    const [first, retry] = await Promise.all([submit(), submit()]);
    expect([first.statusCode, retry.statusCode].sort(), first.body + retry.body).toEqual([
      200, 201,
    ]);
    expect(first.json()).toEqual(retry.json());
    const plan = first.json();
    expect(plan).toMatchObject({
      title: input.title,
      revisionLabel: 'IFB R1',
      sourceCount: 1,
      sheetCount: 3,
    });
    expect((await submit({ ...input, revisionLabel: 'Changed request' })).statusCode).toBe(409);
    const detailPath = route + '/' + plan.id;
    const detail = await call(ctx, 'GET', detailPath, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().plan).toEqual(plan);

    const requestedSheet = detail.json().sheets[1].id;
    const contextPath =
      '/v1/enterprise/takeoff/plan-sets/' + plan.id + '/sheets/' + requestedSheet + '/context';
    const context = await call(ctx, 'GET', contextPath, { as: estimator });
    expect(context.statusCode, context.body).toBe(200);
    expect(context.json()).toEqual({ projectId });
    expect((await call(ctx, 'GET', contextPath, { as: outsider.owner })).statusCode).toBe(404);
    expect(
      (await call(ctx, 'GET', contextPath.replace(plan.id, randomUUID()), { as: estimator }))
        .statusCode,
    ).toBe(404);
    expect((await call(ctx, 'GET', contextPath)).statusCode).toBe(401);
    expect((await call(ctx, 'GET', route, { as: outsider.owner })).statusCode).toBe(404);
    expect(detail.json().sheets).toMatchObject([
      {
        sourceVersionId: version1.id,
        sourceRevision: 1,
        pageNumber: 1,
        pageLabel: '1',
        widthPoints: 1224,
        heightPoints: 792,
        rotation: 0,
      },
      {
        sourceVersionId: version1.id,
        sourceRevision: 1,
        pageNumber: 2,
        pageLabel: '2',
        widthPoints: 612,
        heightPoints: 792,
        rotation: 90,
      },
      {
        sourceVersionId: version1.id,
        sourceRevision: 1,
        pageNumber: 3,
        pageLabel: '3',
        widthPoints: 1000,
        heightPoints: 1000,
        rotation: 0,
      },
    ]);
    expect((await call(ctx, 'GET', detailPath, { as: outsider.owner })).statusCode).toBe(404);
    const combined = await submit({
      ...input,
      revisionLabel: 'Bid and addendum',
      versionIds: [version1.id, version2.id],
      clientRequestId: randomUUID(),
    });
    expect(combined.statusCode, combined.body).toBe(201);
    expect(combined.json()).toMatchObject({ sourceCount: 2, sheetCount: 4 });
    const list = await call(ctx, 'GET', route, { as: estimator });
    expect(list.statusCode, list.body).toBe(200);
    expect(new Set(list.json().items.map((item: { id: string }) => item.id))).toEqual(
      new Set([plan.id, combined.json().id]),
    );
    const events = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${plan.id} and action = 'takeoff_plan_set.imported'
    `;
    expect(events).toMatchObject([
      {
        actor_user_id: estimator.userId,
        after_state: { sheetCount: 3, sourceVersionIds: [version1.id] },
      },
    ]);
  });

  it('rejects an unreadable plan PDF without saving a set or partial sheets', async () => {
    const company = await createCompany(ctx);
    const projectId = await project(company, 'Unreadable PDF fixture');
    const as = company.owner;
    const base = projectRoute + '/' + projectId;
    const register = async (title: string, bytes: Uint8Array) => {
      const upload = await call(ctx, 'POST', base + '/documents', {
        as,
        body: {
          title,
          category: 'plans',
          filename: title + '.pdf',
          contentBase64: Buffer.from(bytes).toString('base64'),
          clientRequestId: randomUUID(),
        },
      });
      expect(upload.statusCode, upload.body).toBe(201);
      return upload.json().id;
    };
    const valid = await register('Canopy detail', pdfFromPages([{ width: 600, height: 600 }]));
    const damaged = await register(
      'Unreadable detail',
      Buffer.from('%PDF-1.7\nBroken catalog\n%%EOF'),
    );
    const route = base + '/takeoff/plan-sets';
    const result = await call(ctx, 'POST', route, {
      as,
      body: {
        title: 'Two sources',
        revisionLabel: 'Draft',
        versionIds: [valid, damaged],
        clientRequestId: randomUUID(),
      },
    });
    expect(result.statusCode, result.body).toBe(400);
    expect(result.json().detail).toMatch(/Could not read the sheets/);
    const list = await call(ctx, 'GET', route, { as });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items).toEqual([]);
    const rows = await ctx.owner.client`
      select id from enterprise_suite.takeoff_plan_sheets
      where org_id = ${company.orgId} and project_id = ${projectId}
    `;
    expect(rows).toEqual([]);
  });
});

describe('Enterprise Takeoff scale calibration', () => {
  it('maps a 100-point reference to 10 feet, verifies a 250-point check at 25 feet, and keeps scale history', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside scale project');
    const projectId = await project(company, 'Scale calibration fixture');
    const base = projectRoute + '/' + projectId;
    const as = company.owner;
    const estimator = company.as('estimator');
    const document = await call(ctx, 'POST', base + '/documents', {
      as,
      body: {
        title: 'Calibration sheet',
        category: 'plans',
        filename: 'scale.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        clientRequestId: randomUUID(),
      },
    });
    expect(document.statusCode, document.body).toBe(201);
    const importPath = base + '/takeoff/plan-sets';
    const plan = await call(ctx, 'POST', importPath, {
      as: estimator,
      body: {
        title: 'Scale check plan',
        revisionLabel: 'A',
        versionIds: [document.json().id],
        clientRequestId: randomUUID(),
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const planPath = importPath + '/' + plan.json().id;
    const detail = await call(ctx, 'GET', planPath, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    const sheetId = detail.json().sheets[0].id;
    const path = planPath + '/sheets/' + sheetId + '/calibration';

    const unset = await call(ctx, 'GET', path, { as: estimator });
    expect(unset.statusCode, unset.body).toBe(200);
    expect(unset.json()).toEqual({ revision: 0, calibration: null });
    expect(unset.headers.etag).toBe('"0"');
    const pointA = { x: 10, y: 15 };
    const pointB = { x: 110, y: 15 };
    const input = {
      pointA,
      pointB,
      knownLength: 10,
      unit: 'ft',
      verification: { pointA, pointB: { x: 260, y: 15 }, knownLength: 25 },
      clientRequestId: randomUUID(),
    };
    const save = (revision: number, body = input, actor = estimator) =>
      call(ctx, 'POST', path, { as: actor, headers: { 'if-match': '"' + revision + '"' }, body });
    expect((await save(0, input, company.as('reviewer'))).statusCode).toBe(403);
    expect((await save(0, input, outsider.owner)).statusCode).toBe(404);
    expect((await call(ctx, 'GET', path, { as: outsider.owner })).statusCode).toBe(404);
    expect((await save(0, { ...input, pointB: pointA })).statusCode).toBe(400);
    expect((await save(0, { ...input, unit: 'unknown' })).statusCode).toBe(400);
    expect((await save(0, { ...input, pointB: { ...pointB, x: 601 } })).statusCode).toBe(400);

    const [created, retried] = await Promise.all([save(0), save(0)]);
    expect([created.statusCode, retried.statusCode].sort(), created.body + retried.body).toEqual([
      200, 201,
    ]);
    expect(created.json()).toEqual(retried.json());
    const first = created.json();
    expect(first).toMatchObject({
      sheetId,
      revision: 1,
      pointA,
      pointB,
      unit: 'ft',
      knownLength: 10,
      drawingLength: 100,
      scale: 0.1,
      verificationResult: { drawingLength: 250, calculatedLength: 25, errorPercent: 0 },
    });
    expect(created.headers.etag).toBe('"1"');
    expect((await save(0, { ...input, knownLength: 20 })).statusCode).toBe(409);
    const nextInput = { ...input, knownLength: 12, clientRequestId: randomUUID() };
    expect((await save(0, nextInput)).statusCode).toBe(412);
    const revised = await save(1, nextInput);
    expect(revised.statusCode, revised.body).toBe(201);
    expect(revised.json()).toMatchObject({
      revision: 2,
      scale: 0.12,
      verificationResult: { drawingLength: 250, calculatedLength: 30, errorPercent: 20 },
    });

    const latest = await call(ctx, 'GET', path, { as: estimator });
    expect(latest.json()).toEqual({ revision: 2, calibration: revised.json() });
    const history = await ctx.owner.client`
      select revision, result from enterprise_suite.takeoff_calibrations
      where org_id = ${company.orgId} and sheet_id = ${sheetId} order by revision
    `;
    expect(history).toMatchObject([
      { revision: 1, result: { scale: 0.1 } },
      { revision: 2, result: { scale: 0.12 } },
    ]);
    const events = await ctx.owner.client`
      select actor_user_id from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${sheetId} and action = 'takeoff_sheet.calibrated'
    `;
    expect(events).toEqual([
      { actor_user_id: estimator.userId },
      { actor_user_id: estimator.userId },
    ]);
  });
});

describe('Enterprise Takeoff length measurements', () => {
  it('saves a calibrated 3-4-5 length once and flags its unchanged quantity after recalibration', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside length project');
    const projectId = await project(company, 'Measure canopy beams');
    const otherProjectId = await project(company, 'Unrelated categories');
    const root = projectRoute + '/' + projectId;
    const as = company.owner;
    const estimator = company.as('estimator');
    const upload = await call(ctx, 'POST', root + '/documents', {
      as,
      body: {
        title: 'Beam plan',
        category: 'plans',
        filename: 'beam.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        clientRequestId: randomUUID(),
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const plans = root + '/takeoff/plan-sets';
    const plan = await call(ctx, 'POST', plans, {
      as: estimator,
      body: {
        title: 'Beam dimension reference',
        revisionLabel: 'A',
        versionIds: [upload.json().id],
        clientRequestId: randomUUID(),
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const planPath = plans + '/' + plan.json().id;
    const detail = await call(ctx, 'GET', planPath, { as: estimator });
    const sheetId = detail.json().sheets[0].id;
    const sheet = planPath + '/sheets/' + sheetId;
    const lengths = sheet + '/lengths';
    const newCategory = (name: string, project = projectId, member = estimator) =>
      call(ctx, 'POST', projectRoute + '/' + project + '/takeoff/categories', {
        as: member,
        body: { name },
      });
    expect((await newCategory('Steel beams', projectId, company.as('reviewer'))).statusCode).toBe(
      403,
    );
    const category = await newCategory('Steel beams');
    expect(category.statusCode, category.body).toBe(201);
    const duplicate = await newCategory('steel beams');
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json()).toEqual(category.json());
    const unrelated = await newCategory('Outside work', otherProjectId);
    expect(unrelated.statusCode, unrelated.body).toBe(201);
    const firstVertex = { x: 80, y: 80 };
    const vertices = [firstVertex, { x: 110, y: 120 }];
    const base = {
      categoryId: category.json().id,
      calibrationId: randomUUID(),
      vertices,
      clientRequestId: randomUUID(),
    };
    const measure = (body = base, member = estimator) =>
      call(ctx, 'POST', lengths, { as: member, body });
    expect((await measure()).statusCode).toBe(409);

    const calibrate = (revision: number, knownLength: number) =>
      call(ctx, 'POST', sheet + '/calibration', {
        as: estimator,
        headers: { 'if-match': '"' + revision + '"' },
        body: {
          pointA: { x: 10, y: 15 },
          pointB: { x: 110, y: 15 },
          knownLength,
          unit: 'ft',
          verification: null,
          clientRequestId: randomUUID(),
        },
      });
    const calibrated = await calibrate(0, 10);
    expect(calibrated.statusCode, calibrated.body).toBe(201);
    const input = { ...base, calibrationId: calibrated.json().id };
    expect((await measure(input, company.as('reviewer'))).statusCode).toBe(403);
    expect((await measure(input, outsider.owner)).statusCode).toBe(404);
    expect((await call(ctx, 'GET', lengths, { as: outsider.owner })).statusCode).toBe(404);
    expect((await measure({ ...input, categoryId: unrelated.json().id })).statusCode).toBe(404);
    expect((await measure({ ...input, vertices: [firstVertex, firstVertex] })).statusCode).toBe(
      400,
    );
    expect(
      (await measure({ ...input, vertices: [firstVertex, { x: 800, y: 10 }] })).statusCode,
    ).toBe(400);

    const [first, retry] = await Promise.all([measure(input), measure(input)]);
    expect([first.statusCode, retry.statusCode].sort(), first.body + retry.body).toEqual([
      200, 201,
    ]);
    const recorded = first.json();
    expect(retry.json()).toEqual(recorded);
    expect(recorded).toMatchObject({
      sheetId,
      vertices,
      categoryId: category.json().id,
      calibrationId: calibrated.json().id,
      drawingLength: 50,
      length: 5,
      unit: 'ft',
      requiresReview: false,
    });
    const list = await call(ctx, 'GET', lengths, { as: estimator });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json()).toEqual({
      items: [recorded],
      categories: [category.json()],
      nextCursor: null,
    });

    const newScale = await calibrate(1, 20);
    expect(newScale.statusCode, newScale.body).toBe(201);
    expect((await measure({ ...input, clientRequestId: randomUUID() })).statusCode).toBe(409);
    const stale = await call(ctx, 'GET', lengths, { as: estimator });
    expect(stale.json().items).toEqual([{ ...recorded, requiresReview: true }]);
    const remeasured = await measure({
      ...input,
      calibrationId: newScale.json().id,
      clientRequestId: randomUUID(),
    });
    expect(remeasured.statusCode, remeasured.body).toBe(201);
    expect(remeasured.json()).toMatchObject({ length: 10, requiresReview: false });
    const audit = await ctx.owner.client`
      select actor_user_id from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${recorded.id} and action = 'takeoff_length.created'
    `;
    expect(audit).toEqual([{ actor_user_id: estimator.userId }]);
  });
});

describe('Enterprise Takeoff area measurements', () => {
  it('persists a calibrated 114 sq ft area with deductions and rejects invalid boundaries', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside area project');
    const projectId = await project(company, 'Measure canopy panels');
    const root = projectRoute + '/' + projectId;
    const as = company.owner;
    const estimator = company.as('estimator');
    const upload = await call(ctx, 'POST', root + '/documents', {
      as,
      body: {
        title: 'Panel plan',
        category: 'plans',
        filename: 'panel.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        clientRequestId: randomUUID(),
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const plan = await call(ctx, 'POST', root + '/takeoff/plan-sets', {
      as: estimator,
      body: {
        title: 'Panel areas',
        revisionLabel: 'A',
        versionIds: [upload.json().id],
        clientRequestId: randomUUID(),
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const planPath = root + '/takeoff/plan-sets/' + plan.json().id;
    const detail = await call(ctx, 'GET', planPath, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    const sheetId = detail.json().sheets[0].id;
    const path = planPath + '/sheets/' + sheetId;
    const areas = path + '/areas';
    const calibrate = (revision: number, knownLength: number) =>
      call(ctx, 'POST', path + '/calibration', {
        as: estimator,
        headers: { 'if-match': '"' + revision + '"' },
        body: {
          pointA: { x: 10, y: 15 },
          pointB: { x: 110, y: 15 },
          knownLength,
          unit: 'ft',
          verification: null,
          clientRequestId: randomUUID(),
        },
      });
    const originalScale = await calibrate(0, 10);
    expect(originalScale.statusCode, originalScale.body).toBe(201);
    const rectangle = (x: number, y: number, width: number, height: number) =>
      [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ] as const;
    const exterior = rectangle(10, 20, 100, 120);
    const holes = [rectangle(30, 40, 20, 30)];
    const input = {
      calibrationId: originalScale.json().id,
      exterior,
      holes,
      clientRequestId: randomUUID(),
    };
    const save = (body = input, member = estimator) =>
      call(ctx, 'POST', areas, { as: member, body });
    expect((await save(input, company.as('reviewer'))).statusCode).toBe(403);
    expect((await save(input, outsider.owner)).statusCode).toBe(404);
    expect((await call(ctx, 'GET', areas, { as: outsider.owner })).statusCode).toBe(404);
    expect(
      (
        await save({
          ...input,
          exterior: [exterior[0], exterior[2], exterior[1], exterior[3]],
        })
      ).statusCode,
    ).toBe(400);
    expect((await save({ ...input, holes: [rectangle(90, 50, 40, 30)] })).statusCode).toBe(400);
    expect(
      (await save({ ...input, holes: [rectangle(30, 40, 40, 40), rectangle(50, 50, 30, 30)] }))
        .statusCode,
    ).toBe(400);
    expect((await save({ ...input, calibrationId: randomUUID() })).statusCode).toBe(409);

    const [stored, retry] = await Promise.all([save(), save()]);
    expect([stored.statusCode, retry.statusCode].sort(), stored.body + retry.body).toEqual([
      200, 201,
    ]);
    expect(stored.json()).toEqual(retry.json());
    const measurement = stored.json();
    expect(measurement).toMatchObject({
      sheetId,
      exterior,
      holes,
      exteriorArea: 120,
      deductedArea: 6,
      netArea: 114,
      exteriorPerimeter: 44,
      deductionPerimeter: 10,
      unit: 'ft',
      requiresReview: false,
    });
    const newScale = await calibrate(1, 20);
    expect(newScale.statusCode, newScale.body).toBe(201);
    const list = await call(ctx, 'GET', areas, { as: estimator });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json()).toEqual({
      items: [{ ...measurement, requiresReview: true }],
      nextCursor: null,
    });
    const events = await ctx.owner.client`
      select actor_user_id from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${measurement.id} and action = 'takeoff_area.created'
    `;
    expect(events).toEqual([{ actor_user_id: estimator.userId }]);
  });
});

describe('Enterprise Takeoff count markers', () => {
  it('retains individual markers and decreases the count exactly once on concurrent removals', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside count project');
    const projectId = await project(company, 'Count canopy fasteners');
    const root = projectRoute + '/' + projectId;
    const as = company.owner;
    const estimator = company.as('estimator');
    const upload = await call(ctx, 'POST', root + '/documents', {
      as,
      body: {
        title: 'Fastener plan',
        category: 'plans',
        filename: 'fasteners.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        clientRequestId: randomUUID(),
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const plan = await call(ctx, 'POST', root + '/takeoff/plan-sets', {
      as: estimator,
      body: {
        title: 'Fastener locations',
        revisionLabel: 'A',
        versionIds: [upload.json().id],
        clientRequestId: randomUUID(),
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const planPath = root + '/takeoff/plan-sets/' + plan.json().id;
    const detail = await call(ctx, 'GET', planPath, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    const sheetId = detail.json().sheets[0].id;
    const counts = planPath + '/sheets/' + sheetId + '/counts';
    const category = await call(ctx, 'POST', root + '/takeoff/categories', {
      as: estimator,
      body: { name: 'Fasteners' },
    });
    expect(category.statusCode, category.body).toBe(201);
    const points = [
      { x: 10, y: 20 },
      { x: 50, y: 25 },
      { x: 80, y: 25 },
    ];
    const input = {
      categoryId: category.json().id,
      symbol: 'triangle',
      points,
      clientRequestId: randomUUID(),
    };
    const save = (body = input, member = estimator) =>
      call(ctx, 'POST', counts, { as: member, body });
    expect((await save({ ...input, symbol: 'unknown' })).statusCode).toBe(400);
    expect((await save({ ...input, points: [{ x: 620, y: 25 }] })).statusCode).toBe(400);
    expect((await save(input, company.as('reviewer'))).statusCode).toBe(403);
    expect((await save(input, outsider.owner)).statusCode).toBe(404);
    expect((await call(ctx, 'GET', counts, { as: outsider.owner })).statusCode).toBe(404);
    const [first, retry] = await Promise.all([save(), save()]);
    expect([first.statusCode, retry.statusCode].sort(), first.body + retry.body).toEqual([
      200, 201,
    ]);
    const count = first.json();
    expect(retry.json()).toEqual(count);
    expect(count).toMatchObject({
      sheetId,
      categoryId: category.json().id,
      symbol: 'triangle',
      total: 3,
      revision: 1,
      markers: points.map((point) => ({ point, removedAt: null })),
    });
    const [marker, another] = count.markers.map(({ id }: { id: string }) => id);
    const remove = (id: string, revision: number, who = estimator) =>
      call(ctx, 'POST', counts + '/' + count.id + '/markers/' + id + '/remove', {
        as: who,
        headers: { 'if-match': '"' + revision + '"' },
        body: {},
      });
    expect((await remove(marker, 1, company.as('reviewer'))).statusCode).toBe(403);
    expect((await remove(marker, 1, outsider.owner)).statusCode).toBe(404);
    expect((await remove(randomUUID(), 1)).statusCode).toBe(404);
    const [removed, repeated] = await Promise.all([remove(marker, 1), remove(marker, 1)]);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json()).toEqual(removed.json());
    expect(removed.json()).toMatchObject({
      id: count.id,
      total: 2,
      revision: 2,
      markers: [
        { id: marker, removedAt: expect.any(String) },
        { id: another, removedAt: null },
        { removedAt: null },
      ],
    });
    expect((await remove(another, 1)).statusCode).toBe(412);
    const list = await call(ctx, 'GET', counts, { as: estimator });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json()).toEqual({
      items: [removed.json()],
      categories: [category.json()],
      nextCursor: null,
    });
    const saved = await ctx.owner.client`
      select active_count, revision from enterprise_suite.takeoff_count_sets where id = ${count.id}
    `;
    expect(saved).toEqual([{ active_count: 2, revision: 2 }]);
    const events = await ctx.owner.client`
      select actor_user_id from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${count.id} and action = 'takeoff_count.marker_removed'
    `;
    expect(events).toEqual([{ actor_user_id: estimator.userId }]);
  });
});

describe('Enterprise Takeoff measurement conditions', () => {
  it('groups only tagged measurements by floor and refuses a room in another project', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside measurement taxonomy');
    const projectId = await project(company, 'Classify canopy measurements');
    const otherProject = await project(company, 'Alternate project taxonomy');
    const root = projectRoute + '/' + projectId;
    const as = company.owner;
    const estimator = company.as('estimator');
    const upload = await call(ctx, 'POST', root + '/documents', {
      as,
      body: {
        title: 'Grouped plan',
        category: 'plans',
        filename: 'grouped.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        clientRequestId: randomUUID(),
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const plan = await call(ctx, 'POST', root + '/takeoff/plan-sets', {
      as: estimator,
      body: {
        title: 'Grouped quantities',
        revisionLabel: 'A',
        versionIds: [upload.json().id],
        clientRequestId: randomUUID(),
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const path = root + '/takeoff/plan-sets/' + plan.json().id;
    const detail = await call(ctx, 'GET', path, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    const sheet = path + '/sheets/' + detail.json().sheets[0].id;
    const cond = sheet + '/conditions';
    const taxonomy = (body: object, target = projectId, who = estimator) =>
      call(ctx, 'POST', projectRoute + '/' + target + '/takeoff/conditions', { as: who, body });
    const newFloor = async (name: string, target = projectId) => {
      const result = await taxonomy({ kind: 'floor', name, parentFloorId: null }, target);
      expect(result.statusCode, result.body).toBe(201);
      return result.json().id;
    };
    const north = await newFloor('North floor');
    const south = await newFloor('South floor');
    const outside = await newFloor('Outside floor', otherProject);
    const lobby = { kind: 'room', name: 'Lobby', parentFloorId: north };
    const room = await taxonomy(lobby);
    expect(room.statusCode, room.body).toBe(201);
    const sameRoom = await taxonomy({ ...lobby, name: 'lobby' });
    expect(sameRoom.statusCode, sameRoom.body).toBe(200);
    expect(sameRoom.json()).toEqual(room.json());
    const outsideRoom = await taxonomy({ ...lobby, parentFloorId: outside }, otherProject);
    expect(outsideRoom.statusCode, outsideRoom.body).toBe(201);
    const material = { kind: 'material', name: 'Steel', parentFloorId: null };
    expect((await taxonomy(material, projectId, company.as('reviewer'))).statusCode).toBe(403);
    expect((await taxonomy({ ...lobby, parentFloorId: outside })).statusCode).toBe(404);
    const made = await taxonomy(material);
    expect(made.statusCode, made.body).toBe(201);

    for (const kind of ['phase', 'trade', 'alternate']) {
      const option = await taxonomy({ kind, name: 'Project ' + kind, parentFloorId: null });
      expect(option.statusCode, option.body).toBe(201);
      expect(option.json()).toMatchObject({ kind, name: 'Project ' + kind });
    }

    const category = await call(ctx, 'POST', root + '/takeoff/categories', {
      as: estimator,
      body: { name: 'Posts' },
    });
    expect(category.statusCode, category.body).toBe(201);
    async function count(points: { x: number; y: number }[]) {
      const result = await call(ctx, 'POST', sheet + '/counts', {
        as: estimator,
        body: {
          categoryId: category.json().id,
          symbol: 'square',
          points,
          clientRequestId: randomUUID(),
        },
      });
      expect(result.statusCode, result.body).toBe(201);
      return result.json();
    }
    const northCount = await count([
      { x: 12, y: 20 },
      { x: 25, y: 20 },
    ]);
    const southCount = await count([{ x: 80, y: 80 }]);
    const untagged = await count([{ x: 120, y: 20 }]);
    const assignment = {
      measurementKind: 'count',
      measurementId: northCount.id,
      conditionId: made.json().id,
      floorId: north,
      roomId: room.json().id,
    };
    const apply = (body = assignment, revision = 1, who = estimator) =>
      call(ctx, 'POST', cond, { as: who, headers: { 'if-match': '"' + revision + '"' }, body });
    expect((await apply({ ...assignment, roomId: outsideRoom.json().id })).statusCode).toBe(404);
    expect((await apply({ ...assignment, floorId: south })).statusCode).toBe(400);
    expect((await apply(assignment, 0)).statusCode).toBe(412);
    expect((await apply(assignment, 1, company.as('reviewer'))).statusCode).toBe(403);
    expect((await apply(assignment, 1, outsider.owner)).statusCode).toBe(404);
    const [first, repeat] = await Promise.all([apply(), apply()]);
    expect([first.statusCode, repeat.statusCode].sort(), first.body + repeat.body).toEqual([
      200, 201,
    ]);
    expect(first.json()).toEqual(repeat.json());
    expect(first.json()).toMatchObject(assignment);

    const southTagged = await apply({
      ...assignment,
      measurementId: southCount.id,
      conditionId: south,
      floorId: null,
      roomId: null,
    });
    expect(southTagged.statusCode, southTagged.body).toBe(201);
    expect(southTagged.json()).toMatchObject({ floorId: south });
    const all = await call(ctx, 'GET', cond, { as: estimator });
    expect(all.statusCode, all.body).toBe(200);
    expect(new Set(all.json().measurements.map(({ id }: { id: string }) => id))).toEqual(
      new Set([northCount.id, southCount.id, untagged.id]),
    );
    const filtered = await call(ctx, 'GET', cond + '?floorId=' + north, { as: estimator });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().measurements).toMatchObject([
      { id: northCount.id, kind: 'count', value: 2, unit: null, conditions: [first.json()] },
    ]);
    expect(filtered.json().measurements).toHaveLength(1);
    expect(
      (await call(ctx, 'GET', cond + '?floorId=' + outside, { as: estimator })).statusCode,
    ).toBe(404);
    expect((await call(ctx, 'GET', cond, { as: outsider.owner })).statusCode).toBe(404);
    const events = await ctx.owner.client`
      select actor_user_id from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${northCount.id}
        and action = 'takeoff_measurement.condition_applied'
    `;
    expect(events).toEqual([{ actor_user_id: estimator.userId }]);
  });
});

describe('Enterprise Takeoff measurement review', () => {
  it('locks a reviewed quantity to its measurement and scale, rejects stale or incorrect approval, and audits one decision', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside takeoff review');
    const projectId = await project(company, 'Canopy quantity sign-off');
    const estimator = company.as('estimator');
    const reviewer = company.as('reviewer');
    const root = projectRoute + '/' + projectId;
    const post = (path: string, body: object, revision?: number, as = estimator) =>
      call(ctx, 'POST', path, {
        as,
        body,
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
    const upload = await post(root + '/documents', {
      title: 'Panel dimensions for review',
      category: 'plans',
      filename: 'review.pdf',
      contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
      clientRequestId: randomUUID(),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const plan = await post(root + '/takeoff/plan-sets', {
      title: 'Quantity review',
      revisionLabel: 'A',
      versionIds: [upload.json().id],
      clientRequestId: randomUUID(),
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const planPath = root + '/takeoff/plan-sets/' + plan.json().id;
    const detail = await call(ctx, 'GET', planPath, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    const sheet = planPath + '/sheets/' + detail.json().sheets[0].id;
    const calibrationInput = (checkLength: number) => ({
      pointA: { x: 0, y: 30 },
      pointB: { x: 100, y: 30 },
      knownLength: 10,
      unit: 'ft',
      verification: {
        pointA: { x: 0, y: 50 },
        pointB: { x: 250, y: 50 },
        knownLength: checkLength,
      },
    });
    async function calibrate(revision: number, checkLength: number) {
      const result = await post(
        sheet + '/calibration',
        {
          ...calibrationInput(checkLength),
          clientRequestId: randomUUID(),
        },
        revision,
      );
      expect(result.statusCode, result.body).toBe(201);
      return result.json().id;
    }
    async function areaReviews(calibrationId: string) {
      const result = await post(sheet + '/areas', {
        calibrationId,
        exterior: [
          { x: 10, y: 20 },
          { x: 110, y: 20 },
          { x: 110, y: 140 },
          { x: 10, y: 140 },
        ],
        holes: [],
        clientRequestId: randomUUID(),
      });
      expect(result.statusCode, result.body).toBe(201);
      return sheet + '/measurements/area/' + result.json().id + '/reviews';
    }
    const draft = {
      note: 'Review against the plan reference dimension.',
      clientRequestId: randomUUID(),
    };
    const approve = { decision: 'approved', note: 'Compared quantity and scale against sheet.' };
    const changes = {
      decision: 'changes_requested',
      note: 'The check dimension needs correction.',
    };
    const invalid = await areaReviews(await calibrate(0, 24));
    expect((await post(invalid, draft, 1, reviewer)).statusCode).toBe(403);
    const submitted = await post(invalid, draft, 1);
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(submitted.json()).toMatchObject({
      status: 'review_required',
      quantity: 120,
      unit: 'ft',
      submittedByUserId: estimator.userId,
    });
    const retry = await post(invalid, draft, 1);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(submitted.json());
    expect((await post(invalid, { ...draft, note: 'Different request' }, 1)).statusCode).toBe(409);
    const invalidDecision = invalid + '/' + submitted.json().id + '/decide';
    expect((await post(invalidDecision, approve, 1)).statusCode).toBe(403);
    expect((await post(invalidDecision, approve, 1, outsider.owner)).statusCode).toBe(404);
    const wrong = await post(invalidDecision, approve, 1, reviewer);
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect(wrong.json().detail).toContain('incorrect scale');
    const blocked = await call(ctx, 'GET', invalid, { as: reviewer });
    expect(blocked.statusCode, blocked.body).toBe(200);
    expect(blocked.json()).toMatchObject({
      approvalBlock: 'incorrect_scale',
      reviews: [{ status: 'review_required', revision: 1 }],
    });
    const changed = await post(invalidDecision, changes, 1, reviewer);
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({
      status: 'changes_requested',
      reviewNote: changes.note,
      revision: 2,
    });

    const correctScale = await calibrate(1, 25);
    const good = await areaReviews(correctScale);
    const goodSubmission = await post(good, { ...draft, clientRequestId: randomUUID() }, 1);
    expect(goodSubmission.statusCode, goodSubmission.body).toBe(201);
    const decision = good + '/' + goodSubmission.json().id + '/decide';
    expect((await post(decision, approve, 4, reviewer)).statusCode).toBe(412);
    const simultaneous = await Promise.all([
      post(decision, approve, 1, reviewer),
      post(decision, approve, 1, reviewer),
    ]);
    for (const result of simultaneous) {
      expect(result.statusCode, result.body).toBe(200);
      expect(result.headers.etag).toBe('"2"');
      expect(result.json()).toMatchObject({
        status: 'approved',
        revision: 2,
        quantity: 120,
        unit: 'ft',
        calibrationId: correctScale,
        reviewedByUserId: reviewer.userId,
        reviewNote: approve.note,
      });
    }
    expect(simultaneous[0]?.json()).toEqual(simultaneous[1]?.json());
    expect((await post(decision, changes, 2, reviewer)).statusCode).toBe(409);
    const outsiderRead = await call(ctx, 'GET', good, { as: outsider.owner });
    expect(outsiderRead.statusCode, outsiderRead.body).toBe(404);

    const superseded = await areaReviews(correctScale);
    const supersededSubmission = await post(
      superseded,
      { ...draft, clientRequestId: randomUUID() },
      1,
    );
    expect(supersededSubmission.statusCode, supersededSubmission.body).toBe(201);
    await approveScaleChange(
      sheet + '/calibration',
      calibrationInput(25),
      2,
      estimator,
      company.owner,
    );
    const stale = await post(
      superseded + '/' + supersededSubmission.json().id + '/decide',
      approve,
      1,
      reviewer,
    );
    expect(stale.statusCode, stale.body).toBe(409);
    const history = await call(ctx, 'GET', good, { as: reviewer });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json()).toMatchObject({
      approvalBlock: 'stale_calibration',
      reviews: [{ status: 'approved', calibrationId: correctScale, quantity: 120 }],
    });

    const category = await post(root + '/takeoff/categories', { name: 'Canopy footings' });
    expect(category.statusCode, category.body).toBe(201);
    const count = await post(sheet + '/counts', {
      categoryId: category.json().id,
      symbol: 'square',
      points: [
        { x: 12, y: 20 },
        { x: 25, y: 20 },
      ],
      clientRequestId: randomUUID(),
    });
    expect(count.statusCode, count.body).toBe(201);
    const countRoot = sheet + '/measurements/count/' + count.json().id + '/reviews';
    const countReview = await post(countRoot, { ...draft, clientRequestId: randomUUID() }, 1);
    expect(countReview.statusCode, countReview.body).toBe(201);
    const removed = await post(
      sheet + '/counts/' + count.json().id + '/markers/' + count.json().markers[0].id + '/remove',
      {},
      1,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      (await post(countRoot + '/' + countReview.json().id + '/decide', approve, 1, reviewer))
        .statusCode,
    ).toBe(412);
    const newRequest = { ...draft, clientRequestId: randomUUID() };
    expect((await post(countRoot, newRequest, 1)).statusCode).toBe(412);
    const newCount = await post(countRoot, newRequest, 2);
    expect(newCount.statusCode, newCount.body).toBe(201);
    expect(newCount.json()).toMatchObject({ measurementRevision: 2, quantity: 1, unit: null });

    const audit = await ctx.owner.client`
      select actor_user_id, before_state, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${goodSubmission.json().id} and action = 'takeoff.approved'
    `;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: reviewer.userId,
      before_state: { status: 'review_required', revision: 1 },
      after_state: { status: 'approved', revision: 2, reviewNote: approve.note },
    });
  });
});

describe('Enterprise commercial estimate drafts', () => {
  it('creates a scoped blank estimate, keeps decimal line quantities, and freezes the approved revision', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    const projectId = await project(company, 'Commercial estimate target');
    const otherProject = await project(company, 'Different estimate target');
    await project(outsider, 'Unrelated company estimate');
    const root = projectRoute + '/' + projectId + '/estimates';
    const estimator = company.as('estimator');
    const reviewer = company.as('reviewer');
    const post = (path: string, body: object, expected?: number, as = estimator) =>
      call(ctx, 'POST', path, {
        as,
        body,
        headers: expected === undefined ? {} : { 'if-match': '"' + expected + '"' },
      });
    const form = {
      title: 'Canopy quantities',
      currency: 'CAD',
      quantityPrecision: 4,
      clientRequestId: randomUUID(),
    };
    expect((await post(root, form, undefined, reviewer)).statusCode).toBe(403);
    expect((await post(root, form, undefined, outsider.owner)).statusCode).toBe(404);
    const [first, second] = await Promise.all([post(root, form), post(root, form)]);
    expect(
      [first.statusCode, second.statusCode].sort(),
      [first.body, second.body].join('\n'),
    ).toEqual([200, 201]);
    expect(first.json()).toEqual(second.json());
    const revision = first.json();
    expect(revision).toMatchObject({
      title: form.title,
      status: 'draft',
      revision: 1,
      currency: 'CAD',
      quantityPrecision: 4,
    });
    expect((await post(root, { ...form, currency: 'USD' })).statusCode).toBe(409);
    const path = root + '/' + revision.id;
    const reason = { reason: 'Quantities checked against reviewed drawings.' };
    const emptyApproval = await post(path + '/approve', reason, 1, reviewer);
    expect(emptyApproval.statusCode, emptyApproval.body).toBe(400);
    const manual = {
      description: 'Canopy deck surface',
      unit: 'sq_yd',
      quantity: '12.5000',
      clientRequestId: randomUUID(),
    };
    expect((await post(path + '/lines', manual, 1, reviewer)).statusCode).toBe(403);
    expect((await post(path + '/lines', manual, 6)).statusCode).toBe(412);
    const added = await post(path + '/lines', manual, 1);
    expect(added.statusCode, added.body).toBe(201);
    expect(added.headers.etag).toBe('"2"');
    expect(added.json().lines).toMatchObject([
      { description: manual.description, unit: 'sq_yd', quantity: '12.5' },
    ]);
    const repeated = await post(path + '/lines', manual, 1);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json()).toEqual(added.json());
    expect((await post(path + '/approve', reason, 2)).statusCode).toBe(403);
    const approved = await post(path + '/approve', reason, 2, reviewer);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({
      status: 'approved',
      revision: 3,
      approvedByUserId: reviewer.userId,
      approvalReason: reason.reason,
    });
    expect((await post(path + '/approve', reason, 2, reviewer)).json()).toEqual(approved.json());
    const blocked = await post(path + '/lines', { ...manual, clientRequestId: randomUUID() }, 3);
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().detail).toContain('Approved estimates require a new revision');
    const list = await call(ctx, 'GET', root, { as: estimator });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items).toMatchObject([{ id: revision.id, status: 'approved' }]);
    expect(
      (
        await call(ctx, 'GET', projectRoute + '/' + otherProject + '/estimates/' + revision.id, {
          as: estimator,
        })
      ).statusCode,
    ).toBe(404);
    expect((await call(ctx, 'GET', path, { as: outsider.owner })).statusCode).toBe(404);
    const detail = await call(ctx, 'GET', path, { as: reviewer });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toEqual(approved.json());
    const events = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${revision.id}
      and action = 'estimating.quantity_revision_approved'
    `;
    expect(events).toMatchObject([
      {
        actor_user_id: reviewer.userId,
        after_state: { approvalReason: reason.reason, revision: 3 },
      },
    ]);
  });
});

describe('Enterprise takeoff quantity transfers', () => {
  it('previews 120 square feet as unrounded square yards and transfers approved draft mappings exactly once', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside takeoff transfer');
    const projectId = await project(company, 'Canopy takeoff transfer');
    const otherProjectId = await project(company, 'Unrelated takeoff project');
    const estimator = company.as('estimator');
    const reviewer = company.as('reviewer');
    const projectPath = projectRoute + '/' + projectId;
    const post = (path: string, body: object, revision?: number, as = estimator) =>
      call(ctx, 'POST', path, {
        as,
        body,
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
    const create = async (path: string, form: object, revision?: number) => {
      const result = await post(path, { ...form, clientRequestId: randomUUID() }, revision);
      expect(result.statusCode, result.body).toBe(201);
      return result.json();
    };
    const vault = await create(projectPath + '/documents', {
      title: 'Quantity transfer drawing',
      category: 'plans',
      filename: 'canopy-transfer.pdf',
      contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
    });
    const plan = await create(projectPath + '/takeoff/plan-sets', {
      title: 'Canopy',
      revisionLabel: 'A',
      versionIds: [vault.id],
    });
    const planPath = projectPath + '/takeoff/plan-sets/' + plan.id;
    const planDetail = await call(ctx, 'GET', planPath, { as: estimator });
    expect(planDetail.statusCode, planDetail.body).toBe(200);
    const sheet = planPath + '/sheets/' + planDetail.json().sheets[0].id;
    const calibration = {
      pointA: { x: 0, y: 30 },
      pointB: { x: 100, y: 30 },
      knownLength: 10,
      unit: 'ft',
      verification: { pointA: { x: 0, y: 50 }, pointB: { x: 250, y: 50 }, knownLength: 25 },
    };
    const scale = await create(sheet + '/calibration', calibration, 0);
    const source = await create(sheet + '/areas', {
      calibrationId: scale.id,
      exterior: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 140 },
        { x: 10, y: 140 },
      ],
      holes: [],
    });
    const history = sheet + '/measurements/area/' + source.id + '/reviews';
    const review = await create(history, { note: 'Confirm the deck area against the plan.' }, 1);
    const approvedSources = projectPath + '/takeoff/approved-measurements';
    const pendingSources = await call(ctx, 'GET', approvedSources, { as: estimator });
    expect(pendingSources.statusCode, pendingSources.body).toBe(200);
    expect(pendingSources.json()).toEqual({ items: [], nextCursor: null });
    expect((await call(ctx, 'GET', approvedSources, { as: reviewer })).statusCode).toBe(403);
    expect((await call(ctx, 'GET', approvedSources, { as: outsider.owner })).statusCode).toBe(404);
    const target = await create(projectPath + '/estimates', {
      title: 'Canopy estimate',
      currency: 'USD',
      quantityPrecision: 3,
    });
    const targetPath = projectPath + '/estimates/' + target.id;
    const firstLine = await create(
      targetPath + '/lines',
      { description: 'Deck material', unit: 'sq_yd', quantity: null },
      1,
    );
    const secondLine = await create(
      targetPath + '/lines',
      { description: 'Existing deck allowance', unit: 'sq_yd', quantity: '10.5' },
      2,
    );
    const thirdLine = await create(
      targetPath + '/lines',
      { description: 'Unrelated bracket', unit: 'ea', quantity: '1' },
      3,
    );
    const deck = firstLine.lines[0].id;
    const manual = secondLine.lines[1].id;
    const bracket = thirdLine.lines[2].id;
    const root = targetPath + '/takeoff-transfers';
    const proposed = {
      takeoffRevisionId: review.id,
      mappings: [{ estimateLineId: deck }, { estimateLineId: manual }],
    };
    expect((await post(root + '/preview', proposed, 4)).statusCode).toBe(409);
    expect((await post(root + '/preview', proposed, 4, reviewer)).statusCode).toBe(403);
    expect((await post(root + '/preview', proposed, 4, outsider.owner)).statusCode).toBe(404);
    expect(
      (await post(root.replace(projectId, otherProjectId) + '/preview', proposed, 4)).statusCode,
    ).toBe(404);
    const signoff = await post(
      history + '/' + review.id + '/decide',
      { decision: 'approved', note: 'The calibrated canopy measures 120 square feet.' },
      1,
      reviewer,
    );
    expect(signoff.statusCode, signoff.body).toBe(200);
    const eligible = await call(ctx, 'GET', approvedSources, { as: estimator });
    expect(eligible.statusCode, eligible.body).toBe(200);
    expect(eligible.json()).toMatchObject({
      items: [
        {
          id: review.id,
          planTitle: 'Canopy',
          revisionLabel: 'A',
          measurementKind: 'area',
          quantity: 120,
          unit: 'ft',
        },
      ],
      nextCursor: null,
    });
    expect(
      (await post(root + '/preview', { ...proposed, mappings: [{ estimateLineId: bracket }] }, 4))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          root + '/preview',
          { ...proposed, mappings: [{ estimateLineId: randomUUID() }] },
          4,
        )
      ).statusCode,
    ).toBe(404);
    const preview = await post(root + '/preview', proposed, 4);
    expect(preview.statusCode, preview.body).toBe(200);
    const exact = '13.' + '3'.repeat(38);
    expect(preview.json()).toMatchObject({
      sourceQuantity: 120,
      sourceUnit: 'ft',
      quantityPrecision: 3,
      mappings: [
        {
          estimateLineId: deck,
          targetUnit: 'sq_yd',
          unroundedQuantity: exact,
          roundedQuantity: '13.333',
          disposition: 'ready',
        },
        { estimateLineId: manual, oldQuantity: '10.5', disposition: 'requires_replacement' },
      ],
    });
    const command = {
      ...proposed,
      clientRequestId: randomUUID(),
      previewDigest: preview.json().previewDigest,
      confirmed: true,
    };
    const protectedQuantity = await post(root + '/confirm', command, 4);
    expect(protectedQuantity.statusCode, protectedQuantity.body).toBe(409);
    const before = await call(ctx, 'GET', targetPath, { as: estimator });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json()).toMatchObject({
      revision: 4,
      lines: [{ quantity: null }, { quantity: '10.5' }, { quantity: '1' }],
    });

    const reason = 'Replace the allowance with the reviewed area.';
    const allowed = {
      ...proposed,
      mappings: [{ estimateLineId: deck }, { estimateLineId: manual, replacementReason: reason }],
    };
    const corrected = await post(root + '/preview', allowed, 4);
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json().mappings[1]).toMatchObject({
      disposition: 'ready',
      replacementReason: reason,
    });
    const confirm = {
      ...allowed,
      confirmed: true,
      previewDigest: corrected.json().previewDigest,
      clientRequestId: randomUUID(),
    };
    expect((await post(root + '/confirm', { ...confirm, confirmed: false }, 4)).statusCode).toBe(
      400,
    );
    expect(
      (await post(root + '/confirm', { ...confirm, previewDigest: '0'.repeat(64) }, 4)).statusCode,
    ).toBe(409);
    const results = await Promise.all([
      post(root + '/confirm', confirm, 4),
      post(root + '/confirm', confirm, 4),
    ]);
    expect(
      results.map((entry) => entry.statusCode).sort(),
      results.map((entry) => entry.body).join('\n'),
    ).toEqual([200, 201]);
    const recorded = results[0]!.json();
    expect(results[1]!.json()).toEqual(recorded);
    expect(recorded).toMatchObject({
      applied: true,
      revision: 5,
      sourceReviewId: review.id,
      mappings: [
        { estimateLineId: deck, roundedQuantity: '13.333' },
        { estimateLineId: manual, oldQuantity: '10.5', replacementReason: reason },
      ],
    });
    expect(
      (await post(root + '/confirm', { ...confirm, clientRequestId: randomUUID() }, 4)).statusCode,
    ).toBe(412);
    const after = await call(ctx, 'GET', targetPath, { as: estimator });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json()).toMatchObject({
      revision: 5,
      lines: [
        { quantity: '13.333', sourceReviewId: review.id },
        { quantity: '13.333', sourceReviewId: review.id },
        { quantity: '1', sourceReviewId: null },
      ],
    });
    const repeat = await post(root + '/preview', proposed, 5);
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(
      repeat.json().mappings.map(({ disposition }: { disposition: string }) => disposition),
    ).toEqual(['already_applied', 'already_applied']);
    const noop = await post(
      root + '/confirm',
      {
        ...proposed,
        confirmed: true,
        previewDigest: repeat.json().previewDigest,
        clientRequestId: randomUUID(),
      },
      5,
    );
    expect(noop.statusCode, noop.body).toBe(200);
    expect(noop.json()).toMatchObject({ applied: false, transferId: null, revision: 5 });

    await approveScaleChange(sheet + '/calibration', calibration, 1, estimator, company.owner);
    const superseded = await call(ctx, 'GET', approvedSources, { as: estimator });
    expect(superseded.statusCode, superseded.body).toBe(200);
    expect(superseded.json()).toEqual({ items: [], nextCursor: null });
    expect((await post(root + '/preview', proposed, 5)).statusCode).toBe(409);
    const approve = await post(
      targetPath + '/approve',
      { reason: 'Checked the transferred area and allowance.' },
      5,
      reviewer,
    );
    expect(approve.statusCode, approve.body).toBe(200);
    const locked = await post(root + '/preview', proposed, 6);
    expect(locked.statusCode, locked.body).toBe(409);
    expect(locked.json().detail).toContain('Approved estimates require a new draft revision');
    expect((await post(root + '/confirm', confirm, 4)).json()).toEqual(recorded);
    const revised = await create(
      targetPath + '/revise',
      { reason: 'Retain the reviewed source while adjusting scope.' },
      6,
    );
    expect(revised).toMatchObject({
      sourceRevisionId: target.id,
      status: 'draft',
      lines: [
        { quantity: '13.333', sourceReviewId: review.id },
        { quantity: '13.333', sourceReviewId: review.id },
        { quantity: '1', sourceReviewId: null },
      ],
    });

    const trace = await ctx.owner.client`
      select count(*)::int as entries, min(replacement_reason) as reason
      from enterprise_suite.project_estimate_transfer_mappings
      where org_id = ${company.orgId} and transfer_id = ${recorded.transferId}
    `;
    expect(trace).toEqual([{ entries: 2, reason }]);
    const events = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${target.id} and action = 'takeoff.quantity_transferred'
    `;
    expect(events).toEqual([{ actor_user_id: estimator.userId, after_state: recorded }]);
  });
});

describe('Enterprise estimate revision history', () => {
  it('creates one draft from an approved estimate and preserves each prior quantity snapshot', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside estimate revision');
    const projectId = await project(company, 'Estimate revision fixture');
    const as = company.as('estimator');
    const reviewer = company.as('reviewer');
    const root = projectRoute + '/' + projectId + '/estimates';
    const post = (path: string, body: object, revision?: number, actor = as) =>
      call(ctx, 'POST', path, {
        as: actor,
        body,
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
    const made = await post(root, {
      title: 'Canopy alternatives',
      currency: 'CAD',
      quantityPrecision: 4,
      clientRequestId: randomUUID(),
    });
    expect(made.statusCode, made.body).toBe(201);
    const baseline = made.json();
    const basePath = root + '/' + baseline.id;
    const line = await post(
      basePath + '/lines',
      {
        description: 'Deck covering',
        unit: 'sq_yd',
        quantity: '12.75',
        clientRequestId: randomUUID(),
      },
      1,
    );
    expect(line.statusCode, line.body).toBe(201);
    const approval = await post(
      basePath + '/approve',
      { reason: 'Preserve the initial measured scope.' },
      2,
      reviewer,
    );
    expect(approval.statusCode, approval.body).toBe(200);
    const approved = approval.json();
    const input = { reason: 'Add a separate finish allowance.', clientRequestId: randomUUID() };
    const command = basePath + '/revise';
    expect((await post(command, input)).statusCode).toBe(428);
    expect((await post(command, input, 2)).statusCode).toBe(412);
    expect((await post(command, input, 3, reviewer)).statusCode).toBe(403);
    expect((await post(command, input, 3, outsider.owner)).statusCode).toBe(404);
    const responses = await Promise.all([post(command, input, 3), post(command, input, 3)]);
    expect(
      responses.map((entry) => entry.statusCode).sort(),
      responses.map((entry) => entry.body).join('\n'),
    ).toEqual([200, 201]);
    const draft = responses[0]!.json();
    expect(responses[1]!.json()).toEqual(draft);
    expect(draft).toMatchObject({
      estimateId: baseline.estimateId,
      sourceRevisionId: baseline.id,
      revisionReason: input.reason,
      status: 'draft',
      revisionNumber: 2,
      revision: 1,
      currency: 'CAD',
      quantityPrecision: 4,
      lines: [{ description: 'Deck covering', quantity: '12.75' }],
    });
    expect(draft.lines[0].id).not.toBe(approved.lines[0].id);
    expect((await post(command, { ...input, reason: 'Different terms' }, 3)).statusCode).toBe(409);
    const draftPath = root + '/' + draft.id;
    const changed = await post(
      draftPath + '/lines',
      {
        description: 'Additional fasteners',
        unit: 'ea',
        quantity: '15',
        clientRequestId: randomUUID(),
      },
      1,
    );
    expect(changed.statusCode, changed.body).toBe(201);
    const original = await call(ctx, 'GET', basePath, { as });
    expect(original.statusCode, original.body).toBe(200);
    expect(original.json()).toEqual(approved);
    const latest = await post(
      draftPath + '/revise',
      { reason: 'Preserve the draft before the final change.', clientRequestId: randomUUID() },
      2,
    );
    expect(latest.statusCode, latest.body).toBe(201);
    expect(latest.json()).toMatchObject({
      sourceRevisionId: draft.id,
      revisionNumber: 3,
      status: 'draft',
      lines: [{ quantity: '12.75' }, { quantity: '15' }],
    });
    const retained = await call(ctx, 'GET', draftPath, { as });
    expect(retained.statusCode, retained.body).toBe(200);
    expect(retained.json()).toMatchObject({
      status: 'superseded',
      revision: 3,
      lines: changed.json().lines,
    });
    expect(
      (
        await post(
          draftPath + '/lines',
          { description: 'Late change', unit: 'ea', quantity: '1', clientRequestId: randomUUID() },
          3,
        )
      ).statusCode,
    ).toBe(409);
    await expect(ctx.owner.client`
      update enterprise_suite.project_estimate_lines set quantity = 99
      where id = ${approved.lines[0].id}
    `).rejects.toMatchObject({ code: '23514' });
    const lineage = await ctx.owner.client`
      select id, lineage_id from enterprise_suite.project_estimate_lines
      where org_id = ${company.orgId} and id = ${latest.json().lines[0].id}
    `;
    expect(lineage).toMatchObject([{ lineage_id: approved.lines[0].id }]);
  });
});

describe('Enterprise estimate price and scope comparison', () => {
  it('compares revised scope and exact line costs while preserving the approved prices', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outside = await createCompany(ctx);
    await project(outside, 'Outside comparison');
    const projectId = await project(company, 'Commercial scope comparison');
    const as = company.as('estimator');
    const reviewer = company.as('reviewer');
    const root = projectRoute + '/' + projectId + '/estimates';
    const post = (path: string, body: object, revision?: number, actor = as) =>
      call(ctx, 'POST', path, {
        as: actor,
        body,
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
    const created = await post(root, {
      title: 'Deck upgrade',
      currency: 'CAD',
      clientRequestId: randomUUID(),
    });
    expect(created.statusCode, created.body).toBe(201);
    const basePath = root + '/' + created.json().id;
    const line = await post(
      basePath + '/lines',
      {
        description: 'Canopy deck',
        unit: 'sq_yd',
        quantity: '12.75',
        unitPriceMinor: 2500,
        clientRequestId: randomUUID(),
      },
      1,
    );
    expect(line.statusCode, line.body).toBe(201);
    const original = line.json().lines[0];
    expect(original).toMatchObject({ unitPriceMinor: 2500, extendedPriceMinor: '31875' });
    const approve = await post(
      basePath + '/approve',
      { reason: 'Approved original scope and rate.' },
      2,
      reviewer,
    );
    expect(approve.statusCode, approve.body).toBe(200);
    const revised = await post(
      basePath + '/revise',
      { reason: 'Review the stronger decking option.', clientRequestId: randomUUID() },
      3,
    );
    expect(revised.statusCode, revised.body).toBe(201);
    const draft = revised.json();
    const draftPath = root + '/' + draft.id;
    const compare = async (path = draftPath + '/comparison', actor = as) =>
      call(ctx, 'GET', path, { as: actor });
    const initial = await compare();
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json().rows).toMatchObject([
      {
        lineageId: original.id,
        change: 'unchanged',
        before: { extendedPriceMinor: '31875' },
        after: { extendedPriceMinor: '31875' },
      },
    ]);
    expect((await compare(draftPath + '/comparison', outside.owner)).statusCode).toBe(404);
    const other = await post(root, {
      title: 'Different estimate',
      currency: 'CAD',
      clientRequestId: randomUUID(),
    });
    expect(other.statusCode, other.body).toBe(201);
    expect(
      (await compare(draftPath + '/comparison?sourceRevisionId=' + other.json().id)).statusCode,
    ).toBe(404);

    const edits = {
      description: 'Reinforced canopy deck',
      unit: 'sq_yd',
      quantity: '14.5',
      unitPriceMinor: 2875,
      reason: 'Customer selected reinforced decking and a longer span.',
      clientRequestId: randomUUID(),
    };
    const patch = (path: string, body: object, revision: number, actor = as) =>
      call(ctx, 'PATCH', path, {
        as: actor,
        body,
        headers: { 'if-match': '"' + revision + '"' },
      });
    const draftLine = draftPath + '/lines/' + draft.lines[0].id;
    expect((await patch(basePath + '/lines/' + original.id, edits, 3)).statusCode).toBe(409);
    expect((await patch(draftLine, edits, 1, reviewer)).statusCode).toBe(403);
    expect((await patch(draftLine, edits, 7)).statusCode).toBe(412);
    expect((await patch(draftLine, { ...edits, reason: '' }, 1)).statusCode).toBe(400);
    expect(
      (await patch(draftLine, { ...edits, unit: 'sq_ft', quantity: undefined }, 1)).statusCode,
    ).toBe(400);
    const [saved, retry] = await Promise.all([
      patch(draftLine, edits, 1),
      patch(draftLine, edits, 1),
    ]);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(saved.json());
    expect(saved.json()).toMatchObject({
      revision: 2,
      line: {
        description: edits.description,
        unitPriceMinor: 2875,
        extendedPriceMinor: '41688',
        lastChangeReason: edits.reason,
      },
    });
    const newLine = await post(
      draftPath + '/lines',
      {
        description: 'Sealant allowance',
        unit: 'ea',
        quantity: '1',
        unitPriceMinor: 1500,
        clientRequestId: randomUUID(),
      },
      2,
    );
    expect(newLine.statusCode, newLine.body).toBe(201);
    const comparison = await compare();
    expect(comparison.statusCode, comparison.body).toBe(200);
    expect(comparison.json()).toMatchObject({
      source: { revisionNumber: 1, status: 'approved' },
      target: { revisionNumber: 2, status: 'draft' },
      rows: [
        {
          lineageId: original.id,
          change: 'changed',
          before: {
            description: 'Canopy deck',
            quantity: '12.75',
            unitPriceMinor: 2500,
            extendedPriceMinor: '31875',
          },
          after: {
            description: edits.description,
            quantity: '14.5',
            unitPriceMinor: 2875,
            extendedPriceMinor: '41688',
            lastChangeReason: edits.reason,
          },
        },
        {
          change: 'added',
          before: null,
          after: { description: 'Sealant allowance', extendedPriceMinor: '1500' },
        },
      ],
    });
    const unchanged = await call(ctx, 'GET', basePath, { as });
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    expect(unchanged.json()).toEqual(approve.json());
    const audit = await ctx.owner.client`
      select after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${draft.id} and action = 'estimating.line_edited'
    `;
    expect(audit).toMatchObject([{ after_state: { reason: edits.reason, revision: 2 } }]);
  });
});

describe('Enterprise plan revision comparison', () => {
  it('requires reviewed alignment for differing scales without modifying the approved measurement', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outside = await createCompany(ctx);
    await project(outside, 'Outside drawing comparison');
    const projectId = await project(company, 'Revision comparison');
    const otherProject = await project(company, 'Other drawing comparison');
    const as = company.as('estimator');
    const reviewer = company.as('reviewer');
    const root = projectRoute + '/' + projectId;
    const post = (path: string, body: object, revision?: number, actor = as) =>
      call(ctx, 'POST', path, {
        as: actor,
        body,
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
    async function create(path: string, body: object, revision?: number) {
      const response = await post(path, { ...body, clientRequestId: randomUUID() }, revision);
      expect(response.statusCode, response.body).toBe(201);
      return response.json();
    }
    const original = await create(root + '/documents', {
      title: 'Canopy details',
      filename: 'canopy-a.pdf',
      category: 'plans',
      contentBase64: Buffer.from(pdfFromContent('10 10 30 30 re S')).toString('base64'),
    });
    const updated = await create(
      root + '/documents/' + original.documentSetId + '/versions',
      {
        filename: 'canopy-b.pdf',
        revisionNote: 'Moves the detail south.',
        contentBase64: Buffer.from(pdfFromContent('50 50 30 30 re S')).toString('base64'),
      },
      1,
    );
    async function makePlan(versionId: string, revisionLabel: string, knownLength: number) {
      const plan = await create(root + '/takeoff/plan-sets', {
        title: 'Canopy scope',
        revisionLabel,
        versionIds: [versionId],
      });
      const planPath = root + '/takeoff/plan-sets/' + plan.id;
      const detail = await call(ctx, 'GET', planPath, { as });
      expect(detail.statusCode, detail.body).toBe(200);
      const sheetId = detail.json().sheets[0].id;
      const sheet = planPath + '/sheets/' + sheetId;
      const scale = await create(
        sheet + '/calibration',
        {
          unit: 'ft',
          knownLength,
          pointA: { x: 10, y: 10 },
          pointB: { x: 110, y: 10 },
          verification: null,
        },
        0,
      );
      return { planId: plan.id, sheetId, sheet, scale };
    }
    const earlier = await makePlan(original.id, 'Issue A', 10);
    const current = await makePlan(updated.id, 'Issue B', 20);
    const area = await create(earlier.sheet + '/areas', {
      calibrationId: earlier.scale.id,
      exterior: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 140 },
        { x: 10, y: 140 },
      ],
      holes: [],
    });
    const reviews = earlier.sheet + '/measurements/area/' + area.id + '/reviews';
    const review = await create(reviews, { note: 'Review the area on Issue A.' }, 1);
    const approval = await post(
      reviews + '/' + review.id + '/decide',
      { decision: 'approved', note: 'Checked the 120 square feet.' },
      1,
      reviewer,
    );
    expect(approval.statusCode, approval.body).toBe(200);
    const historyBefore = await call(ctx, 'GET', reviews, { as });
    const scaleBefore = await call(ctx, 'GET', earlier.sheet + '/calibration', { as });
    expect(historyBefore.statusCode, historyBefore.body).toBe(200);
    expect(scaleBefore.statusCode, scaleBefore.body).toBe(200);
    const previewPath = root + '/takeoff/compare';
    const request = {
      oldRevisionId: earlier.planId,
      oldSheetId: earlier.sheetId,
      newRevisionId: current.planId,
      newSheetId: current.sheetId,
      alignment: {},
    };
    expect((await post(previewPath, request, undefined, reviewer)).statusCode).toBe(403);
    expect((await post(previewPath, request, undefined, outside.owner)).statusCode).toBe(404);
    expect((await post(previewPath.replace(projectId, otherProject), request)).statusCode).toBe(
      404,
    );
    expect(
      (
        await post(previewPath, {
          ...request,
          newRevisionId: earlier.planId,
          newSheetId: earlier.sheetId,
        })
      ).statusCode,
    ).toBe(400);
    expect((await post(previewPath, { ...request, newSheetId: earlier.sheetId })).statusCode).toBe(
      404,
    );
    const unreviewed = await post(previewPath, request);
    expect(unreviewed.statusCode, unreviewed.body).toBe(200);
    expect(unreviewed.json()).toMatchObject({
      status: 'alignment_review',
      alignmentIssues: ['different_scale'],
      earlier: { sourceVersionId: original.id, revisionLabel: 'Issue A', sheetId: earlier.sheetId },
      current: { sourceVersionId: updated.id, revisionLabel: 'Issue B', sheetId: current.sheetId },
    });
    const alignment = { offsetX: 15, offsetY: -5, scale: 2, rotation: 90, reviewed: true };
    const accepted = await post(previewPath, { ...request, alignment });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      status: 'ready',
      alignment,
      alignmentIssues: ['different_scale'],
    });
    const renderPath = previewPath + '/raster';
    const renderInput = { ...request, alignment, comparisonKey: accepted.json().comparisonKey };
    expect(
      (await post(renderPath, { ...renderInput, alignment: { ...alignment, reviewed: false } }))
        .statusCode,
    ).toBe(409);
    expect((await post(renderPath, renderInput, undefined, outside.owner)).statusCode).toBe(404);
    expect(
      (await post(renderPath, { ...renderInput, comparisonKey: '0'.repeat(64) })).statusCode,
    ).toBe(409);
    const raster = await post(renderPath, renderInput);
    expect(raster.statusCode, raster.body).toBe(200);
    expect(raster.headers['cache-control']).toBe('private, no-store');
    const image = raster.json();
    expect(image.width).toBeGreaterThan(0);
    expect(image.width).toBeLessThanOrEqual(1200);
    expect(image.height).toBeGreaterThan(0);
    expect(image.height).toBeLessThanOrEqual(1200);
    expect(image.addedPixels).toBeGreaterThan(0);
    expect(image.removedPixels).toBeGreaterThan(0);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    for (const png of [image.earlierPng, image.currentPng, image.overlayPng]) {
      expect(Buffer.from(png, 'base64').subarray(0, 8)).toEqual(pngSignature);
    }
    expect(image.earlierPng).not.toEqual(image.currentPng);
    expect(image.overlayPng).not.toEqual(image.currentPng);
    const notesPath = root + '/takeoff/comparison-notes';
    const note = {
      ...renderInput,
      x: 0.38,
      y: 0.62,
      body: 'Review this relocated canopy edge.',
      clientRequestId: randomUUID(),
    };
    const noteList = notesPath + '?comparisonKey=' + note.comparisonKey;
    expect((await post(notesPath, note, undefined, reviewer)).statusCode).toBe(403);
    expect((await post(notesPath, note, undefined, outside.owner)).statusCode).toBe(404);
    expect((await post(notesPath, { ...note, x: 1.2 })).statusCode).toBe(400);
    expect((await post(notesPath, { ...note, comparisonKey: '0'.repeat(64) })).statusCode).toBe(
      409,
    );
    expect(
      (await post(notesPath, { ...note, alignment: { ...alignment, reviewed: false } })).statusCode,
    ).toBe(409);
    const repeatedNotes = await Promise.all([post(notesPath, note), post(notesPath, note)]);
    expect(
      repeatedNotes.map((entry) => entry.statusCode).sort(),
      repeatedNotes.map((entry) => entry.body).join('\n'),
    ).toEqual([200, 201]);
    const savedNote = repeatedNotes[0]!.json();
    expect(repeatedNotes[1]!.json()).toEqual(savedNote);
    expect(savedNote).toMatchObject({
      comparisonKey: note.comparisonKey,
      x: 0.38,
      y: 0.62,
      body: note.body,
      createdByUserId: as.userId,
    });
    expect((await post(notesPath, { ...note, body: 'Different note' })).statusCode).toBe(409);
    const listedNotes = await call(ctx, 'GET', noteList, { as });
    expect(listedNotes.statusCode, listedNotes.body).toBe(200);
    expect(listedNotes.json()).toEqual({ items: [savedNote], nextCursor: null });
    expect((await call(ctx, 'GET', noteList, { as: outside.owner })).statusCode).toBe(404);
    const otherNotes = await call(ctx, 'GET', noteList.replace(projectId, otherProject), { as });
    expect(otherNotes.statusCode, otherNotes.body).toBe(200);
    expect(otherNotes.json()).toEqual({ items: [], nextCursor: null });
    const noteAudit = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${savedNote.id} and action = 'takeoff.comparison_annotated'
    `;
    expect(noteAudit).toMatchObject([
      {
        actor_user_id: as.userId,
        after_state: {
          x: 0.38,
          y: 0.62,
          oldSheetId: earlier.sheetId,
          newSheetId: current.sheetId,
          alignment,
        },
      },
    ]);
    expect(noteAudit).toHaveLength(1);
    await create(
      current.sheet + '/calibration',
      {
        unit: 'ft',
        knownLength: 20,
        pointA: { x: 10, y: 10 },
        pointB: { x: 110, y: 10 },
        verification: null,
      },
      1,
    );
    expect((await post(renderPath, renderInput)).statusCode).toBe(409);
    const fresh = await post(previewPath, { ...request, alignment });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json().comparisonKey).not.toBe(renderInput.comparisonKey);
    expect((await post(notesPath, { ...note, clientRequestId: randomUUID() })).statusCode).toBe(
      409,
    );
    expect((await post(notesPath, note)).json()).toEqual(savedNote);
    expect((await call(ctx, 'GET', noteList, { as })).json()).toEqual({
      items: [savedNote],
      nextCursor: null,
    });
    expect(
      (
        await call(ctx, 'GET', notesPath + '?comparisonKey=' + fresh.json().comparisonKey, { as })
      ).json(),
    ).toEqual({ items: [], nextCursor: null });
    await ctx.owner.client`
      update enterprise_suite.documents set sha256_hex = ${'0'.repeat(64)}
      where org_id = ${company.orgId} and id = ${updated.id}
    `;
    const invalidFile = await post(renderPath, {
      ...renderInput,
      comparisonKey: fresh.json().comparisonKey,
    });
    expect(invalidFile.statusCode, invalidFile.body).toBe(409);
    expect(invalidFile.json().detail).toContain('checksum');
    const historyAfter = await call(ctx, 'GET', reviews, { as });
    const scaleAfter = await call(ctx, 'GET', earlier.sheet + '/calibration', { as });
    expect(historyAfter.statusCode, historyAfter.body).toBe(200);
    expect(scaleAfter.statusCode, scaleAfter.body).toBe(200);
    expect(historyAfter.json()).toEqual(historyBefore.json());
    expect(scaleAfter.json()).toEqual(scaleBefore.json());
  });
});

describe('Enterprise takeoff markup', () => {
  it('exports the exact approved layer totals as a private immutable markup PDF', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outsider = await createCompany(ctx);
    await project(outsider, 'Outside markup project');
    const projectId = await project(company, 'Canopy markup project');
    const otherProject = await project(company, 'Other markup project');
    const as = company.as('estimator');
    const reviewer = company.as('reviewer');
    const root = projectRoute + '/' + projectId;
    const post = (path: string, body: object, revision?: number, actor = as) =>
      call(ctx, 'POST', path, {
        as: actor,
        body,
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
    const get = (path: string, actor = as) => call(ctx, 'GET', path, { as: actor });
    async function create(path: string, body: object, revision?: number) {
      const response = await post(path, { ...body, clientRequestId: randomUUID() }, revision);
      expect(response.statusCode, response.body).toBe(201);
      return response.json();
    }
    const original = await create(root + '/documents', {
      title: 'Canopy markup drawing',
      filename: 'markup-a.pdf',
      category: 'plans',
      contentBase64: Buffer.from(pdfFromContent('130 100 50 50 re S')).toString('base64'),
    });
    const plan = await create(root + '/takeoff/plan-sets', {
      title: 'Canopy scope',
      revisionLabel: 'Issued for markup',
      versionIds: [original.id],
    });
    const planPath = root + '/takeoff/plan-sets/' + plan.id;
    const planDetail = await get(planPath);
    expect(planDetail.statusCode, planDetail.body).toBe(200);
    const sheetId = planDetail.json().sheets[0].id;
    const sheet = planPath + '/sheets/' + sheetId;
    const calibration = {
      unit: 'ft',
      knownLength: 10,
      pointA: { x: 10, y: 10 },
      pointB: { x: 110, y: 10 },
      verification: null,
    };
    const scale = await create(sheet + '/calibration', calibration, 0);
    const areaInput = {
      calibrationId: scale.id,
      exterior: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 140 },
        { x: 10, y: 140 },
      ],
      holes: [
        [
          { x: 30, y: 40 },
          { x: 50, y: 40 },
          { x: 50, y: 60 },
          { x: 30, y: 60 },
        ],
      ],
    };
    const area = await create(sheet + '/areas', areaInput);
    await create(sheet + '/areas', { ...areaInput, holes: [] });
    const areaReviews = sheet + '/measurements/area/' + area.id + '/reviews';
    const areaReview = await create(areaReviews, { note: 'Check the deducted opening.' }, 1);
    const areaApproval = await post(
      areaReviews + '/' + areaReview.id + '/decide',
      {
        decision: 'approved',
        note: 'Checked the 116 net square feet.',
      },
      1,
      reviewer,
    );
    expect(areaApproval.statusCode, areaApproval.body).toBe(200);
    const category = await post(root + '/takeoff/categories', { name: 'Support brackets' });
    expect(category.statusCode, category.body).toBe(201);
    const count = await create(sheet + '/counts', {
      categoryId: category.json().id,
      symbol: 'triangle',
      points: [
        { x: 75, y: 75 },
        { x: 85, y: 95 },
      ],
    });
    const countReviews = sheet + '/measurements/count/' + count.id + '/reviews';
    const countReview = await create(countReviews, { note: 'Check the two support brackets.' }, 1);
    const countApproval = await post(
      countReviews + '/' + countReview.id + '/decide',
      {
        decision: 'approved',
        note: 'Two brackets confirmed.',
      },
      1,
      reviewer,
    );
    expect(countApproval.statusCode, countApproval.body).toBe(200);

    const markup = sheet + '/markup-exports';
    const onlyArea = { visibleLayers: ['area'] };
    const preview = await post(markup + '/preview', onlyArea);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      sheetId,
      revisionId: plan.id,
      revisionLabel: 'Issued for markup',
      scaleLabel: '0.1 ft per drawing point · Calibration 1',
      approvedCount: 1,
      totals: [{ layer: 'area', quantity: '116', unit: 'ft²' }],
    });
    const all = await post(markup + '/preview', { visibleLayers: ['count', 'area', 'length'] });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json().totals).toEqual([
      { layer: 'area', quantity: '116', unit: 'ft²' },
      { layer: 'count', quantity: '2', unit: 'each' },
    ]);
    expect((await post(markup + '/preview', { visibleLayers: ['internal_cost'] })).statusCode).toBe(
      400,
    );
    expect((await post(markup + '/preview', onlyArea, undefined, reviewer)).statusCode).toBe(403);
    expect((await post(markup + '/preview', onlyArea, undefined, outsider.owner)).statusCode).toBe(
      404,
    );

    const command = {
      ...onlyArea,
      sheetId,
      revisionId: plan.id,
      format: 'pdf',
      selectionDigest: preview.json().selectionDigest,
      clientRequestId: randomUUID(),
    };
    expect((await post(markup, { ...command, revisionId: randomUUID() })).statusCode).toBe(404);
    expect((await post(markup, { ...command, selectionDigest: '0'.repeat(64) })).statusCode).toBe(
      409,
    );
    const attempts = await Promise.all([post(markup, command), post(markup, command)]);
    expect(
      attempts.map((reply) => reply.statusCode).sort(),
      attempts.map((reply) => reply.body).join('\n'),
    ).toEqual([200, 201]);
    const exported = attempts[0]!.json();
    expect(attempts[1]!.json()).toEqual(exported);
    expect((await get(markup)).json()).toEqual({ items: [exported], nextCursor: null });

    const download = markup + '/' + exported.id + '/download';
    expect((await get(download, outsider.owner)).statusCode).toBe(404);
    expect((await get(download.replace(projectId, otherProject))).statusCode).toBe(404);
    expect((await get(download, reviewer)).statusCode).toBe(403);
    const pdf = await get(download);
    expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/^application\/pdf/);
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    expect(pdf.headers['content-disposition']).toContain(exported.filename);
    expect(sha256Hex(pdf.rawPayload)).toBe(exported.sha256);
    await withPlanDocument(new Uint8Array(pdf.rawPayload), 10_000, true, async (document) => {
      expect(document.numPages).toBe(2);
      const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const drawing = await document.getPage(1);
      const operators = await drawing.getOperatorList();
      expect(operators.fnArray).toContain(OPS.paintImageXObject);
      const paintedAreas = operators.fnArray.filter(
        (op, index) =>
          op === OPS.constructPath && operators.argsArray[index]?.[0] === OPS.eoFillStroke,
      );
      expect(paintedAreas).toHaveLength(1);
      const text: string[] = [];
      for (const number of [1, 2]) {
        const page = await document.getPage(number);
        const items = (await page.getTextContent()).items;
        text.push(items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' '));
      }
      expect(text[0]).toContain('Revision Issued for markup');
      expect(text[0]).toContain('0.1 ft per drawing point');
      expect(text[1]).toContain('Takeoff markup legend');
      expect(text[1]).toContain('116 ft²');
      expect(text[1]).toContain('Shaded area, with clear deductions');
      expect(text[1]).not.toMatch(/\b120\b|2 each|Support brackets|Internal cost/i);
    });

    const audit = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${exported.id} and action = 'takeoff.markup_exported'
    `;
    expect(audit).toEqual([
      {
        actor_user_id: as.userId,
        after_state: {
          ...exported,
          planId: plan.id,
          sourceVersionId: original.id,
          calibrationId: scale.id,
          selectedReviewIds: [areaReview.id],
        },
      },
    ]);

    await approveScaleChange(
      sheet + '/calibration',
      { ...calibration, knownLength: 20 },
      1,
      as,
      company.owner,
    );
    expect((await post(markup, { ...command, clientRequestId: randomUUID() })).statusCode).toBe(
      409,
    );
    expect((await post(markup, command)).json()).toEqual(exported);
    expect((await get(download)).rawPayload).toEqual(pdf.rawPayload);
    expect((await get(areaReviews)).json().reviews[0]).toMatchObject({
      id: areaReview.id,
      status: 'approved',
      quantity: 116,
      calibrationId: scale.id,
    });
  });
});

describe('Enterprise Takeoff calibration lock', () => {
  it('requires estimator lead approval for a locked scale and keeps earlier approved quantities', async () => {
    const company = await createCompany(ctx, { roles: ['estimator', 'reviewer'] });
    const outside = await createCompany(ctx);
    const projectId = await project(company, 'Calibration lock fixture');
    await project(outside, 'Outside calibration lock fixture');
    const root = projectRoute + '/' + projectId;
    const estimator = company.as('estimator');
    const reviewer = company.as('reviewer');
    const member = company.owner;
    async function create(path: string, body: object, revision?: number) {
      const result = await call(ctx, 'POST', path, {
        as: estimator,
        body: { ...body, clientRequestId: randomUUID() },
        headers: revision === undefined ? {} : { 'if-match': '"' + revision + '"' },
      });
      expect(result.statusCode, result.body).toBe(201);
      return result.json();
    }
    const document = await create(root + '/documents', {
      title: 'Locked dimension drawing',
      filename: 'locked-scale.pdf',
      category: 'plans',
      contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
    });
    const plan = await create(root + '/takeoff/plan-sets', {
      title: 'Locked scale plan',
      revisionLabel: 'For approval',
      versionIds: [document.id],
    });
    const planPath = root + '/takeoff/plan-sets/' + plan.id;
    const detail = await call(ctx, 'GET', planPath, { as: estimator });
    expect(detail.statusCode, detail.body).toBe(200);
    const sheetId = detail.json().sheets[0].id;
    const sheet = planPath + '/sheets/' + sheetId;
    const scale = sheet + '/calibration';
    const lock = scale + '/lock';
    const changes = scale + '/change-requests';
    const body = {
      pointA: { x: 0, y: 30 },
      pointB: { x: 100, y: 30 },
      knownLength: 10,
      unit: 'ft',
      verification: null,
    };
    const original = await create(scale, body, 0);
    const initial = await call(ctx, 'GET', lock, { as: estimator });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toMatchObject({
      mode: 'after_review',
      effective: false,
      revision: 0,
      dependentApprovals: 0,
    });
    const area = await create(sheet + '/areas', {
      calibrationId: original.id,
      exterior: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 140 },
        { x: 10, y: 140 },
      ],
      holes: [],
    });
    const reviews = sheet + '/measurements/area/' + area.id + '/reviews';
    const entry = await create(reviews, { note: 'Review the canopy measurement.' }, 1);
    const approved = await call(ctx, 'POST', reviews + '/' + entry.id + '/decide', {
      as: reviewer,
      headers: { 'if-match': '"1"' },
      body: { decision: 'approved', note: 'Checked the canopy dimensions.' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const active = await call(ctx, 'GET', lock, { as: estimator });
    expect(active.json()).toMatchObject({
      mode: 'after_review',
      effective: true,
      revision: 0,
      dependentApprovals: 1,
    });
    expect((await call(ctx, 'GET', lock, { as: outside.owner })).statusCode).toBe(404);

    const next = { ...body, knownLength: 20 };
    const raw = { ...next, clientRequestId: randomUUID() };
    for (const as of [estimator, member]) {
      const direct = await call(ctx, 'POST', scale, {
        as,
        body: raw,
        headers: { 'if-match': '"1"' },
      });
      expect(direct.statusCode, direct.body).toBe(409);
      expect(direct.json().detail).toContain('locked');
    }

    const request = {
      input: next,
      reason: 'The supplier clarified the reference dimension.',
      clientRequestId: randomUUID(),
    };
    const submit = (data: object, as = estimator, target = changes) =>
      call(ctx, 'POST', target, { as, body: data, headers: { 'if-match': '"1"' } });
    expect((await submit(request, reviewer)).statusCode).toBe(403);
    expect((await submit(request, outside.owner)).statusCode).toBe(404);
    const [first, replay] = await Promise.all([submit(request), submit(request)]);
    expect([first.statusCode, replay.statusCode].sort(), first.body + replay.body).toEqual([
      200, 201,
    ]);
    const saved = first.json();
    expect(replay.json()).toEqual(saved);
    expect(saved).toMatchObject({
      baseCalibrationId: original.id,
      baseCalibrationRevision: 1,
      status: 'pending',
      proposed: { scale: 0.2, knownLength: 20 },
    });
    const staleRequest = await create(
      changes,
      { input: { ...body, knownLength: 30 }, reason: 'Alternate reference option.' },
      1,
    );
    const wrongRequest = await create(
      changes,
      {
        input: {
          ...next,
          verification: {
            pointA: { x: 0, y: 50 },
            pointB: { x: 250, y: 50 },
            knownLength: 25,
          },
        },
        reason: 'The secondary reference also requires review.',
      },
      1,
    );
    const decide = (id: string, as = member, decision = 'approved', revision = 1) =>
      call(ctx, 'POST', changes + '/' + id + '/decide', {
        as,
        headers: { 'if-match': '"' + revision + '"' },
        body: { decision, reason: 'Reviewed the reference on the issued drawings.' },
      });
    expect((await decide(saved.id, estimator)).statusCode).toBe(403);
    expect((await decide(saved.id, reviewer)).statusCode).toBe(403);
    expect((await decide(saved.id, outside.owner)).statusCode).toBe(404);
    expect((await decide(saved.id, member, 'approved', 4)).statusCode).toBe(412);
    expect((await decide(wrongRequest.id)).statusCode).toBe(400);
    const declined = await decide(wrongRequest.id, member, 'declined');
    expect(declined.statusCode, declined.body).toBe(200);
    expect(declined.json()).toMatchObject({ status: 'declined', appliedCalibrationId: null });
    const unchanged = await call(ctx, 'GET', scale, { as: estimator });
    expect(unchanged.json().calibration.id).toBe(original.id);

    const [decision, repeat] = await Promise.all([decide(saved.id), decide(saved.id)]);
    expect(decision.statusCode, decision.body).toBe(200);
    expect(repeat.statusCode, repeat.body).toBe(200);
    expect(repeat.json()).toEqual(decision.json());
    const applied = decision.json().appliedCalibrationId;
    expect(decision.json()).toMatchObject({
      status: 'approved',
      revision: 2,
      appliedCalibrationId: expect.any(String),
      decidedByUserId: member.userId,
    });
    expect((await decide(staleRequest.id)).statusCode).toBe(409);
    const current = await call(ctx, 'GET', scale, { as: estimator });
    expect(current.json()).toMatchObject({
      revision: 2,
      calibration: { id: applied, scale: 0.2 },
    });
    const history = await call(ctx, 'GET', reviews, { as: estimator });
    expect(history.json()).toMatchObject({
      approvalBlock: 'stale_calibration',
      reviews: [{ id: entry.id, status: 'approved', quantity: 120, calibrationId: original.id }],
    });

    const configure = (mode: string, as = member, revision = 0, clientRequestId = randomUUID()) =>
      call(ctx, 'PUT', lock, {
        as,
        headers: { 'if-match': '"' + revision + '"' },
        body: {
          mode,
          reason: 'Recording the sheet policy for the next planning round.',
          clientRequestId,
        },
      });
    expect((await configure('locked', reviewer)).statusCode).toBe(403);
    const configurationId = randomUUID();
    const locked = await configure('locked', member, 0, configurationId);
    expect(locked.statusCode, locked.body).toBe(200);
    expect((await configure('locked', member, 0, configurationId)).json()).toEqual(locked.json());
    expect((await configure('unlocked', member, 0)).statusCode).toBe(412);
    const unlocked = await configure('unlocked', member, 1);
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    const settings = await call(ctx, 'GET', lock, { as: estimator });
    expect(settings.json()).toMatchObject({
      mode: 'unlocked',
      effective: false,
      revision: 2,
      history: [
        { mode: 'unlocked', revision: 2 },
        { mode: 'locked', revision: 1 },
      ],
    });
    expect((await create(scale, { ...body, knownLength: 25 }, 2)).revision).toBe(3);

    const decisions = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and object_id = ${saved.id} and action = 'takeoff_sheet.calibration_change_approved'
    `;
    expect(decisions).toEqual([{ actor_user_id: member.userId, after_state: decision.json() }]);
  });
});
