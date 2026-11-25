import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  type Company,
  type TestContext,
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
      await sql`delete from enterprise_suite.schedule_template_applications where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_templates where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_baselines where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.schedule_tasks where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.document_reviews where org_id = any(${orgIds}::uuid[])`;
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
