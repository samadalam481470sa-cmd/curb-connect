// Enterprise Blueprint API integration coverage: idempotent creates, field/lifecycle validation,
// optimistic concurrency, tenant isolation and the RLS policy on work_package_records.
import { randomUUID } from 'node:crypto';
import { findWorkPackage, workPackageFieldKey, type MemberRole } from '@fieldline/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../db/runtime';
import { enterpriseBlueprintRecords } from '../../db/schema/enterpriseBlueprint';
import {
  call,
  createCompany,
  createTestContext,
  type Company,
  type TestContext,
} from '../../../test/helpers';

const PACKAGE_CODE = '001';
const PACKAGE = findWorkPackage(PACKAGE_CODE)!;
const FIELD_KEY = workPackageFieldKey(PACKAGE.fields[0]!);
const FIRST_STAGE = PACKAGE.lifecycle[0]!;
const NEXT_STAGE = PACKAGE.lifecycle[1]!;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  if (!ctx) return;
  // cleanupTracked() only walks public tables; remove the isolated enterprise rows first so the
  // organizations can be deleted (the suite FKs are ON DELETE RESTRICT).
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length > 0) {
    await ctx.owner.client.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`delete from enterprise_suite.control_evidence where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.control_requirements where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.work_package_record_links where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.work_package_records where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.projects where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => {
  await ctx?.close();
});

async function enabledCompany(roles: MemberRole[] = []): Promise<Company> {
  const company = await createCompany(ctx, { roles });
  const res = await call(ctx, 'PUT', '/v1/enterprise/status', {
    as: company.owner,
    body: { enabled: true },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ enabled: true });
  return company;
}

function createRecord(company: Company, body: Record<string, unknown> = {}) {
  return call(ctx, 'POST', `/v1/enterprise/blueprint/${PACKAGE_CODE}/records`, {
    as: company.owner,
    body: {
      title: 'Onboarding record',
      fields: { [FIELD_KEY]: 'Fictional Company LLC' },
      ...body,
    },
  });
}

function listRecords(company: Company) {
  return call(ctx, 'GET', `/v1/enterprise/blueprint/${PACKAGE_CODE}/records`, {
    as: company.owner,
  });
}

async function createProject(company: Company): Promise<string> {
  const res = await call(ctx, 'POST', '/v1/enterprise/projects', {
    as: company.owner,
    body: { name: 'Typed field test project' },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function getExceptions(company: Company, query = '') {
  return call(ctx, 'GET', `/v1/enterprise/blueprint/exceptions${query}`, {
    as: company.owner,
  });
}

function createPackageRecord(
  company: Company,
  code: string,
  title: string,
  fields: Record<string, string | number>,
) {
  return call(ctx, 'POST', `/v1/enterprise/blueprint/${code}/records`, {
    as: company.owner,
    body: { title, fields },
  });
}

async function typedRecord(
  company: Company,
  code: string,
  title: string,
  fields: Record<string, string | number>,
): Promise<string> {
  const res = await createPackageRecord(company, code, title, fields);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

function createProjectRecord(
  company: Company,
  code: string,
  projectId: string,
  title: string,
  fields: Record<string, string | number>,
) {
  return call(ctx, 'POST', `/v1/enterprise/blueprint/${code}/records`, {
    as: company.owner,
    body: { title, projectId, ownerUserId: company.owner.userId, fields },
  });
}

function getPlaybook(company: Company, projectId: string, type: string, phase?: string) {
  const query = new URLSearchParams({ type });
  if (phase) query.set('phase', phase);
  return call(ctx, 'GET', `/v1/enterprise/projects/${projectId}/playbook?${query}`, {
    as: company.owner,
  });
}

function createLink(company: Company, fromId: string, body: Record<string, unknown>) {
  return call(ctx, 'POST', `/v1/enterprise/blueprint/records/${fromId}/links`, {
    as: company.owner,
    body,
  });
}

function listLinks(company: Company, recordId: string) {
  return call(ctx, 'GET', `/v1/enterprise/blueprint/records/${recordId}/links`, {
    as: company.owner,
  });
}

describe('Enterprise Blueprint records API', () => {
  it('creates and reads a record for the last expansion package', async () => {
    const company = await enabledCompany();
    const path = '/v1/enterprise/blueprint/157/records';
    const created = await call(ctx, 'POST', path, {
      as: company.owner,
      body: { title: 'Sandbox connector review', fields: { provider: 'Accounting sandbox' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      packageCode: '157',
      status: 'draft',
      fields: { provider: 'Accounting sandbox' },
    });
    const listed = await call(ctx, 'GET', path, { as: company.owner });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items).toMatchObject([{ id: created.json().id }]);
  });

  it('returns the original record when a create is retried with the same clientRequestId', async () => {
    const company = await enabledCompany();
    const clientRequestId = randomUUID();
    const body = {
      title: 'Idempotent onboarding',
      fields: { [FIELD_KEY]: 'Fictional Company LLC' },
      clientRequestId,
    };

    const first = await createRecord(company, body);
    expect(first.statusCode).toBe(201);
    const record = first.json() as { id: string; revision: number; status: string };
    expect(record.status).toBe(FIRST_STAGE);

    const retry = await createRecord(company, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ id: record.id, revision: record.revision });

    const listed = await listRecords(company);
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: { id: string }[] }).items).toHaveLength(1);

    const [audit] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from enterprise_suite.audit_events
      where org_id = ${company.orgId}::uuid
        and object_id = ${record.id}::uuid
        and action = 'blueprint.record_created'`;
    expect(audit?.n).toBe(1);
  });

  it('rejects a field key that is not in the work-package contract', async () => {
    const company = await enabledCompany();
    const res = await createRecord(company, {
      fields: { 'not-a-package-field': 'should not be stored' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation_failed' });
    expect((await listRecords(company)).json().items).toEqual([]);
  });

  it('rejects a status outside the package lifecycle and leaves the record untouched', async () => {
    const company = await enabledCompany();
    const created = await createRecord(company);
    expect(created.statusCode).toBe(201);
    const record = created.json() as { id: string; revision: number };

    const rejected = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: company.owner,
      body: { status: 'not-a-lifecycle-stage' },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: 'validation_failed' });

    const [row] = await ctx.owner.client<{ status: string; revision: number }[]>`
      select status, revision from enterprise_suite.work_package_records
      where id = ${record.id}::uuid`;
    expect(row).toEqual({ status: FIRST_STAGE, revision: 1 });
  });

  it('rejects a stale If-Match revision and keeps the newer edit', async () => {
    const company = await enabledCompany();
    const created = await createRecord(company);
    expect(created.statusCode).toBe(201);
    const record = created.json() as { id: string; revision: number };

    const moved = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: company.owner,
      body: { status: NEXT_STAGE },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ status: NEXT_STAGE, revision: 2 });

    const stale = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: company.owner,
      body: { status: FIRST_STAGE },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ code: 'precondition_failed' });

    const [row] = await ctx.owner.client<{ status: string; revision: number }[]>`
      select status, revision from enterprise_suite.work_package_records
      where id = ${record.id}::uuid`;
    expect(row).toEqual({ status: NEXT_STAGE, revision: 2 });
  });

  it('hides and refuses another tenant’s record', async () => {
    const a = await enabledCompany();
    const b = await enabledCompany();
    const created = await createRecord(a, { title: 'A only record' });
    expect(created.statusCode).toBe(201);
    const record = created.json() as { id: string; revision: number };

    const listedByB = await listRecords(b);
    expect(listedByB.statusCode).toBe(200);
    expect((listedByB.json() as { items: unknown[] }).items).toEqual([]);

    const patchedByB = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: b.owner,
      body: { notes: 'cross-tenant write' },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(patchedByB.statusCode).toBe(404);
    expect(patchedByB.json()).toMatchObject({ code: 'not_found' });

    const listedByA = await listRecords(a);
    const row = (listedByA.json() as { items: { id: string; notes: string | null }[] }).items.find(
      (item) => item.id === record.id,
    );
    expect(row?.notes).toBeNull();
  });
});

describe('typed Enterprise Blueprint fields', () => {
  it('computes money fields on create and recomputes them on update', async () => {
    const company = await enabledCompany();
    const projectId = await createProject(company);
    const created = await call(ctx, 'POST', '/v1/enterprise/blueprint/046/records', {
      as: company.owner,
      body: {
        title: 'Lumber order',
        fields: {
          vendor: 'Fictional Lumber',
          project: projectId,
          sku: '2x4-8',
          quantity: 12,
          'unit-cost': 450,
          'delivery-date': '2026-12-01',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const record = created.json() as {
      id: string;
      revision: number;
      projectId: string | null;
      fields: Record<string, string | number>;
    };
    expect(record.projectId).toBe(projectId);
    expect(record.fields).toMatchObject({ quantity: 12, 'unit-cost': 450, total: 5_400 });

    const updated = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: company.owner,
      body: { fields: { quantity: 20 } },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { fields: Record<string, string | number> }).fields.total).toBe(
      9_000,
    );
  });

  it('accepts empty optional references and computes a balance with optional tax and paid', async () => {
    const company = await enabledCompany();
    const created = await call(ctx, 'POST', '/v1/enterprise/blueprint/072/records', {
      as: company.owner,
      body: {
        title: 'Invoice capture',
        fields: {
          vendor: 'Fictional Supply',
          'invoice-number': 'INV-1001',
          po: '',
          project: '',
          amount: 10_000,
          'due-date': '2026-12-31',
          'invoice-date': '2026-12-01',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const fields = (created.json() as { fields: Record<string, string | number> }).fields;
    expect(fields['balance-due']).toBe(10_000);
    expect(fields.po).toBeUndefined();
    expect(fields.project).toBeUndefined();
  });

  it('rejects computed inputs, wrong scalar types, invalid dates and missing required fields', async () => {
    const company = await enabledCompany();
    const projectId = await createProject(company);
    const fields = {
      vendor: 'Fictional Lumber',
      project: projectId,
      sku: '2x4-8',
      quantity: 12,
      'unit-cost': 450,
      'delivery-date': '2026-12-01',
    };
    const post = (extra: Record<string, unknown>) =>
      call(ctx, 'POST', '/v1/enterprise/blueprint/046/records', {
        as: company.owner,
        body: { title: 'Typed validation', fields: { ...fields, ...extra } },
      });

    const computed = await post({ total: 5_400 });
    expect(computed.statusCode).toBe(400);
    expect(computed.json()).toMatchObject({ code: 'validation_failed' });

    const stringMoney = await post({ 'unit-cost': '450' });
    expect(stringMoney.statusCode).toBe(400);
    expect(stringMoney.json()).toMatchObject({ code: 'validation_failed' });

    const invalidDate = await post({ 'delivery-date': '2026-02-30' });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.json()).toMatchObject({ code: 'validation_failed' });

    const missingVendor = await post({ vendor: '' });
    expect(missingVendor.statusCode).toBe(400);
    expect(missingVendor.json()).toMatchObject({ code: 'validation_failed' });

    const listed = await call(ctx, 'GET', '/v1/enterprise/blueprint/046/records', {
      as: company.owner,
    });
    expect((listed.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('validates enum options', async () => {
    const company = await enabledCompany();
    const invalid = await call(ctx, 'POST', '/v1/enterprise/blueprint/007/records', {
      as: company.owner,
      body: { title: 'Lead', fields: { name: 'Fictional lead', source: 'carrier-pigeon' } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'validation_failed' });

    const valid = await call(ctx, 'POST', '/v1/enterprise/blueprint/007/records', {
      as: company.owner,
      body: {
        title: 'Lead',
        fields: { name: 'Fictional lead', source: 'web', consent: 'granted' },
      },
    });
    expect(valid.statusCode).toBe(201);
  });

  it('validates user and project references in the same tenant and computes days open', async () => {
    const a = await enabledCompany();
    const b = await enabledCompany();
    const projectA = await createProject(a);
    const projectB = await createProject(b);
    const fields = {
      question: 'Confirm the storefront glazing detail.',
      responder: a.owner.userId,
      project: projectA,
      'due-date': '2026-01-10',
      'opened-on': '2026-01-01',
      'answered-on': '2026-01-04',
    };
    const post = (extra: Record<string, unknown> = {}) =>
      call(ctx, 'POST', '/v1/enterprise/blueprint/039/records', {
        as: a.owner,
        body: { title: 'Glazing RFI', fields: { ...fields, ...extra } },
      });

    const valid = await post();
    expect(valid.statusCode).toBe(201);
    expect((valid.json() as { fields: Record<string, string | number> }).fields['days-open']).toBe(
      3,
    );

    const wrongProject = await post({ project: projectB });
    expect(wrongProject.statusCode).toBe(400);
    expect(wrongProject.json()).toMatchObject({ code: 'validation_failed' });

    const wrongUser = await post({ responder: b.owner.userId });
    expect(wrongUser.statusCode).toBe(400);
    expect(wrongUser.json()).toMatchObject({ code: 'validation_failed' });
  });
});

describe('typed Enterprise Blueprint links', () => {
  async function fixture(company: Company) {
    const project = await createProject(company);
    const po = await typedRecord(company, '046', 'Fictional PO', {
      vendor: 'Fictional Lumber',
      project,
      sku: '2x4-8',
      quantity: 10,
      'unit-cost': 100,
      'delivery-date': '2026-12-01',
    });
    const changeOrder = await typedRecord(company, '048', 'Fictional change order', {
      'scope-delta': 'Add a service door',
      price: 5_000,
      'approval-authority': company.owner.userId,
      project,
      'original-contract': 100_000,
    });
    const submittal = await typedRecord(company, '040', 'Fictional submittal', {
      'spec-section': '08 11 00',
      reviewer: company.owner.userId,
      'required-date': '2026-12-01',
      project,
    });
    const invoice = await typedRecord(company, '072', 'Fictional invoice', {
      vendor: 'Fictional Supply',
      'invoice-number': 'INV-LINK-1',
      po,
      amount: 1_000,
      'due-date': '2026-12-31',
      'invoice-date': '2026-12-01',
      project,
    });
    return { project, po, changeOrder, submittal, invoice };
  }

  it('creates cross-package relations and reports blocking impact in both directions', async () => {
    const company = await enabledCompany();
    const records = await fixture(company);

    const block = await createLink(company, records.po, {
      kind: 'blocks',
      toRecordId: records.changeOrder,
      note: 'The PO must release before this change order can start.',
    });
    expect(block.statusCode, block.body).toBe(201);

    const fromPo = await listLinks(company, records.po);
    expect(fromPo.statusCode).toBe(200);
    expect((fromPo.json() as { links: unknown[] }).links).toMatchObject([
      {
        kind: 'blocks',
        direction: 'outgoing',
        record: { id: records.changeOrder, packageCode: '048' },
      },
    ]);
    expect(
      (fromPo.json() as { impact: { downstream: unknown[] } }).impact.downstream,
    ).toMatchObject([{ id: records.changeOrder }]);

    const fromChangeOrder = await listLinks(company, records.changeOrder);
    expect(fromChangeOrder.statusCode).toBe(200);
    expect((fromChangeOrder.json() as { links: unknown[] }).links).toMatchObject([
      {
        kind: 'blocks',
        direction: 'incoming',
        record: { id: records.po, packageCode: '046' },
      },
    ]);
    expect(
      (fromChangeOrder.json() as { impact: { upstream: unknown[] } }).impact.upstream,
    ).toMatchObject([{ id: records.po }]);

    const changeFor = await createLink(company, records.changeOrder, {
      kind: 'change_order_for',
      toRecordId: records.po,
    });
    expect(changeFor.statusCode, changeFor.body).toBe(201);
    const billedBy = await createLink(company, records.po, {
      kind: 'billed_by',
      toRecordId: records.invoice,
    });
    expect(billedBy.statusCode, billedBy.body).toBe(201);
    const evidenceFor = await createLink(company, records.submittal, {
      kind: 'evidence_for',
      toRecordId: records.changeOrder,
    });
    expect(evidenceFor.statusCode, evidenceFor.body).toBe(201);

    const search = await call(ctx, 'GET', '/v1/enterprise/blueprint/records?q=Fictional%20PO', {
      as: company.owner,
    });
    expect(search.statusCode).toBe(200);
    expect((search.json() as { items: { id: string }[] }).items).toMatchObject([
      { id: records.po },
    ]);
  });

  it('enforces package, project, duplicate and cycle rules', async () => {
    const company = await enabledCompany();
    const records = await fixture(company);

    const block = await createLink(company, records.po, {
      kind: 'blocks',
      toRecordId: records.changeOrder,
    });
    expect(block.statusCode).toBe(201);

    const duplicate = await createLink(company, records.po, {
      kind: 'blocks',
      toRecordId: records.changeOrder,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'conflict' });

    const cycle = await createLink(company, records.changeOrder, {
      kind: 'blocks',
      toRecordId: records.po,
    });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json()).toMatchObject({ code: 'validation_failed' });

    const badBillingTarget = await createLink(company, records.po, {
      kind: 'billed_by',
      toRecordId: records.changeOrder,
    });
    expect(badBillingTarget.statusCode).toBe(400);

    const badEvidenceSource = await createLink(company, records.po, {
      kind: 'evidence_for',
      toRecordId: records.changeOrder,
    });
    expect(badEvidenceSource.statusCode).toBe(400);

    const badChangeOrderSource = await createLink(company, records.po, {
      kind: 'change_order_for',
      toRecordId: records.changeOrder,
    });
    expect(badChangeOrderSource.statusCode).toBe(400);

    const self = await createLink(company, records.po, {
      kind: 'blocks',
      toRecordId: records.po,
    });
    expect(self.statusCode).toBe(400);

    const otherProject = await createProject(company);
    const otherPo = await typedRecord(company, '046', 'Second project PO', {
      vendor: 'Fictional Lumber',
      project: otherProject,
      sku: '2x6-10',
      quantity: 1,
      'unit-cost': 100,
      'delivery-date': '2026-12-02',
    });
    const crossProject = await createLink(company, records.changeOrder, {
      kind: 'change_order_for',
      toRecordId: otherPo,
    });
    expect(crossProject.statusCode).toBe(400);
    expect(crossProject.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('removes outgoing links and keeps links tenant-scoped', async () => {
    const a = await enabledCompany();
    const b = await enabledCompany();
    const records = await fixture(a);
    const foreign = await createRecord(b, { title: 'Other tenant record' });
    expect(foreign.statusCode).toBe(201);
    const foreignId = (foreign.json() as { id: string }).id;

    const crossTenant = await createLink(a, records.po, {
      kind: 'blocks',
      toRecordId: foreignId,
    });
    expect(crossTenant.statusCode).toBe(404);

    const block = await createLink(a, records.po, {
      kind: 'blocks',
      toRecordId: records.changeOrder,
    });
    expect(block.statusCode).toBe(201);
    const linkId = (block.json() as { id: string }).id;

    const viaTarget = await call(
      ctx,
      'DELETE',
      `/v1/enterprise/blueprint/records/${records.changeOrder}/links/${linkId}`,
      { as: a.owner },
    );
    expect(viaTarget.statusCode).toBe(404);

    const deleted = await call(
      ctx,
      'DELETE',
      `/v1/enterprise/blueprint/records/${records.po}/links/${linkId}`,
      { as: a.owner },
    );
    expect(deleted.statusCode).toBe(204);

    const after = await listLinks(a, records.po);
    expect((after.json() as { links: unknown[] }).links).toEqual([]);
    expect((after.json() as { impact: { downstream: unknown[] } }).impact.downstream).toEqual([]);
  });
});

describe('blueprint project playbook', () => {
  it('selects the phase packages and reflects live record ownership and next actions', async () => {
    const company = await enabledCompany();
    const project = await createProject(company);

    const before = await getPlaybook(company, project, 'residential', 'planning');
    expect(before.statusCode, before.body).toBe(200);
    const beforeBody = before.json() as {
      project: { id: string };
      projectType: { key: string };
      phase: { key: string };
      summary: { required: number; missing: number };
      phases: {
        gate: { status: string };
        steps: {
          packageCode: string;
          status: string;
          owner: { source: string };
          record: { id: string } | null;
          nextAction: { kind: string };
        }[];
      }[];
    };
    expect(beforeBody.project.id).toBe(project);
    expect(beforeBody.projectType.key).toBe('residential');
    expect(beforeBody.phase.key).toBe('planning');
    expect(beforeBody.summary.required).toBeGreaterThan(0);
    expect(beforeBody.summary.missing).toBe(beforeBody.summary.required);
    expect(beforeBody.phases[0]?.gate.status).toBe('not_started');
    const missingStep = beforeBody.phases[0]?.steps.find((step) => step.packageCode === '028');
    expect(missingStep).toMatchObject({
      status: 'missing',
      record: null,
      owner: { source: 'package' },
      nextAction: { kind: 'create' },
    });

    const created = await createProjectRecord(company, '028', project, 'Fictional project start', {
      manager: company.owner.userId,
      'template-version': 'v1',
      'project-type': 'residential',
    });
    expect(created.statusCode, created.body).toBe(201);
    const recordId = (created.json() as { id: string }).id;

    const after = await getPlaybook(company, project, 'residential', 'planning');
    expect(after.statusCode, after.body).toBe(200);
    const afterBody = after.json() as typeof beforeBody;
    const recordedStep = afterBody.phases[0]?.steps.find((step) => step.packageCode === '028');
    expect(recordedStep).toMatchObject({
      status: 'in_progress',
      record: { id: recordId },
      owner: { source: 'record' },
      nextAction: { kind: 'advance' },
    });
    expect(afterBody.phases[0]?.gate.status).toBe('in_progress');

    const full = await getPlaybook(company, project, 'residential');
    expect(full.statusCode).toBe(200);
    expect((full.json() as { phases: unknown[] }).phases).toHaveLength(4);

    const land = await getPlaybook(company, project, 'land-development', 'planning');
    expect(land.statusCode).toBe(200);
    expect(
      (land.json() as { phases: { steps: { packageCode: string }[] }[] }).phases[0]?.steps.map(
        (step) => step.packageCode,
      ),
    ).toEqual(expect.arrayContaining(['029', '136', '137']));
  });
});

describe('blueprint exception inbox', () => {
  it('aggregates overdue and SLA-breached records, then blocked records, by owner', async () => {
    const company = await enabledCompany();
    const dueOn = isoDaysAgo(1);
    const created = await createRecord(company, {
      title: 'Approve the fictional vendor packet',
      ownerUserId: company.owner.userId,
      dueOn,
      slaHours: 1,
    });
    expect(created.statusCode).toBe(201);
    const record = created.json() as { id: string; revision: number };
    const listed = await listRecords(company);
    expect((listed.json() as { items: Record<string, unknown>[] }).items[0]).toMatchObject({
      id: record.id,
      ownerUserId: company.owner.userId,
      ownerName: company.owner.displayName,
    });

    // Move the SLA clock back without changing the record's due date.
    await ctx.owner.client`
      update enterprise_suite.work_package_records
      set created_at = now() - interval '2 hours'
      where id = ${record.id}::uuid`;

    const first = await getExceptions(company);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      counts: { overdue: number; blocked: number; slaBreached: number; total: number };
      items: {
        id: string;
        ownerUserId: string;
        ownerName: string | null;
        dueOn: string;
        slaDueAt: string | null;
        overdue: boolean;
        slaBreached: boolean;
        blocked: boolean;
        reasons: string[];
      }[];
    };
    expect(firstBody.counts).toMatchObject({ overdue: 1, blocked: 0, slaBreached: 1, total: 1 });
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]).toMatchObject({
      id: record.id,
      ownerUserId: company.owner.userId,
      dueOn,
      overdue: true,
      slaBreached: true,
      blocked: false,
    });
    expect(firstBody.items[0]!.slaDueAt).not.toBeNull();
    expect(firstBody.items[0]!.ownerName).toBeTruthy();
    expect(firstBody.items[0]!.reasons).toEqual(['overdue', 'sla_breached']);

    const mine = await getExceptions(company, `?owner=${company.owner.userId}`);
    expect((mine.json() as { items: unknown[] }).items).toHaveLength(1);
    const unassigned = await getExceptions(company, '?owner=unassigned');
    expect((unassigned.json() as { items: unknown[] }).items).toEqual([]);

    const blocked = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: company.owner,
      body: { blockedReason: 'Waiting for the insurance certificate' },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toMatchObject({
      blockedReason: 'Waiting for the insurance certificate',
      revision: 2,
    });

    const blockedQueue = await getExceptions(company, '?kind=blocked');
    expect(blockedQueue.statusCode).toBe(200);
    expect((blockedQueue.json() as { items: { id: string }[] }).items).toMatchObject([
      { id: record.id },
    ]);

    const cleared = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: company.owner,
      body: { blockedReason: null },
      headers: { 'if-match': '"2"' },
    });
    expect(cleared.statusCode).toBe(200);
    const unblockedQueue = await getExceptions(company, '?kind=blocked');
    expect((unblockedQueue.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('rejects a foreign owner and removes a finished record from the queue', async () => {
    const a = await enabledCompany();
    const b = await enabledCompany();
    const created = await call(ctx, 'POST', '/v1/enterprise/blueprint/007/records', {
      as: a.owner,
      body: {
        title: 'Fictional lead',
        fields: { name: 'Fictional lead', source: 'web' },
        dueOn: isoDaysAgo(1),
        blockedReason: 'Waiting on the referral packet',
      },
    });
    expect(created.statusCode).toBe(201);
    const record = created.json() as { id: string; revision: number };

    const foreignOwner = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: a.owner,
      body: { ownerUserId: b.owner.userId },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(foreignOwner.statusCode).toBe(400);
    expect(foreignOwner.json()).toMatchObject({ code: 'validation_failed' });

    const finished = await call(ctx, 'PATCH', `/v1/enterprise/blueprint/records/${record.id}`, {
      as: a.owner,
      body: { status: 'lost' },
      headers: { 'if-match': `"${record.revision}"` },
    });
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toMatchObject({ status: 'lost', blockedReason: null, blockedAt: null });

    const queue = await getExceptions(a);
    expect((queue.json() as { items: unknown[] }).items).toEqual([]);
  });
});

describe('RLS on enterprise_suite.work_package_records', () => {
  it('forces RLS, isolates rows by app.org_id and rejects a cross-tenant insert', async () => {
    const a = await enabledCompany();
    const b = await enabledCompany();
    await createRecord(a, { title: 'Record for A' });
    await createRecord(b, { title: 'Record for B' });

    const [table] = await ctx.owner.client<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select relrowsecurity, relforcerowsecurity from pg_class
      where oid = 'enterprise_suite.work_package_records'::regclass`;
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const [linkTable] = await ctx.owner.client<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select relrowsecurity, relforcerowsecurity from pg_class
      where oid = 'enterprise_suite.work_package_record_links'::regclass`;
    expect(linkTable).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const asB = await withTenant(ctx.appDb.db, { orgId: b.orgId, userId: b.owner.userId }, (tx) =>
      tx.select().from(enterpriseBlueprintRecords),
    );
    expect(asB.map((row) => row.orgId)).toEqual([b.orgId]);
    expect(asB.map((row) => row.title)).toEqual(['Record for B']);

    const withoutOrg = await withTenant(ctx.appDb.db, { orgId: null, userId: null }, (tx) =>
      tx.select().from(enterpriseBlueprintRecords),
    );
    expect(withoutOrg).toEqual([]);

    const crossTenantCode = await withTenant(
      ctx.appDb.db,
      { orgId: b.orgId, userId: b.owner.userId },
      (tx) =>
        tx.insert(enterpriseBlueprintRecords).values({
          orgId: a.orgId,
          packageCode: PACKAGE_CODE,
          title: 'Cross-tenant write',
          status: FIRST_STAGE,
          fields: {},
          createdByUserId: b.owner.userId,
        }),
    ).then(
      () => null,
      (error: { cause?: { code?: string }; code?: string }) => error.cause?.code ?? error.code,
    );
    expect(crossTenantCode).toBe('42501');
  });
});

describe('control gate compliance', () => {
  it('assigns owners, reviews attached evidence and exports a checksummed audit packet', async () => {
    const company = await enabledCompany(['reviewer']);
    const reviewer = company.as('reviewer');
    const gatePath = '/v1/enterprise/blueprint/controls/accounting/product-contract';
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
    const yesterday = isoDaysAgo(1);

    const before = await call(ctx, 'GET', '/v1/enterprise/blueprint/controls?module=accounting', {
      as: company.owner,
    });
    expect(before.statusCode, before.body).toBe(200);
    const beforeBody = before.json() as {
      counts: { total: number; missing: number };
      modules: {
        requirements: {
          gateKey: string;
          status: string;
          revision: number;
          ownerUserId: string | null;
        }[];
      }[];
    };
    expect(beforeBody.counts).toMatchObject({ total: 18, missing: 18 });
    expect(beforeBody.modules[0]?.requirements).toHaveLength(18);
    expect(beforeBody.modules[0]?.requirements[0]).toMatchObject({
      gateKey: 'product-contract',
      status: 'missing',
      revision: 0,
      ownerUserId: null,
    });

    const assigned = await call(ctx, 'PUT', gatePath, {
      as: company.owner,
      body: {
        ownerUserId: company.owner.userId,
        expiresOn: future,
        notes: 'Annual control review',
      },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json()).toMatchObject({ revision: 1, ownerUserId: company.owner.userId });

    const withoutRevision = await call(ctx, 'PUT', gatePath, {
      as: company.owner,
      body: { ownerUserId: company.owner.userId },
    });
    expect(withoutRevision.statusCode).toBe(428);
    expect(withoutRevision.json()).toMatchObject({ code: 'precondition_required' });

    const reassigned = await call(ctx, 'PUT', gatePath, {
      as: company.owner,
      body: { ownerUserId: reviewer.userId },
      headers: { 'if-match': '"1"' },
    });
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json()).toMatchObject({ revision: 2, ownerUserId: reviewer.userId });

    const attachment = Buffer.from('%PDF-1.4\n% control evidence\n%%EOF\n');
    const submitted = await call(ctx, 'POST', gatePath + '/evidence', {
      as: company.owner,
      body: {
        title: 'Approved product contract v4',
        evidenceOn: today,
        expiresOn: future,
        sourceReference: 'https://evidence.example.test/contract-v4',
        note: 'Signed by the product owner',
        filename: 'product-contract-v4.pdf',
        contentBase64: attachment.toString('base64'),
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const evidence = submitted.json() as {
      id: string;
      reviewStatus: string;
      hasAttachment: boolean;
      sha256Hex: string;
    };
    expect(evidence).toMatchObject({ reviewStatus: 'pending', hasAttachment: true });
    expect(evidence.sha256Hex).toMatch(/^[0-9a-f]{64}$/);

    const pending = await call(ctx, 'GET', '/v1/enterprise/blueprint/controls?module=accounting', {
      as: company.owner,
    });
    const pendingGate = (
      pending.json() as {
        modules: {
          requirements: { gateKey: string; status: string; ownerName: string | null }[];
        }[];
      }
    ).modules[0]?.requirements.find((item) => item.gateKey === 'product-contract');
    expect(pendingGate).toMatchObject({
      status: 'pending_review',
      ownerName: reviewer.displayName,
    });

    const selfReview = await call(
      ctx,
      'POST',
      `/v1/enterprise/blueprint/control-evidence/${evidence.id}/review`,
      { as: company.owner, body: { decision: 'accepted', note: 'Looks complete' } },
    );
    expect(selfReview.statusCode).toBe(403);

    const reviewed = await call(
      ctx,
      'POST',
      `/v1/enterprise/blueprint/control-evidence/${evidence.id}/review`,
      {
        as: reviewer,
        body: { decision: 'accepted', note: 'Verified against the signed contract' },
      },
    );
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json()).toMatchObject({
      reviewStatus: 'accepted',
      reviewNote: 'Verified against the signed contract',
    });

    const satisfied = await call(
      ctx,
      'GET',
      '/v1/enterprise/blueprint/controls?module=accounting',
      { as: company.owner },
    );
    const satisfiedBody = satisfied.json() as {
      counts: { satisfied: number };
      modules: {
        requirements: {
          gateKey: string;
          status: string;
          nextExpiry: string | null;
          counts: { accepted: number };
        }[];
      }[];
    };
    expect(satisfiedBody.counts.satisfied).toBe(1);
    expect(
      satisfiedBody.modules[0]?.requirements.find((item) => item.gateKey === 'product-contract'),
    ).toMatchObject({ status: 'satisfied', nextExpiry: future, counts: { accepted: 1 } });

    const download = await call(
      ctx,
      'GET',
      `/v1/enterprise/blueprint/control-evidence/${evidence.id}/download`,
      { as: company.owner },
    );
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.body).toBe(attachment.toString('utf8'));

    const packetPath = '/v1/enterprise/blueprint/controls/audit-packet?module=accounting';
    expect((await call(ctx, 'GET', packetPath)).statusCode).toBe(401);
    const packet = await call(ctx, 'GET', packetPath, { as: company.owner });
    expect(packet.statusCode, packet.body).toBe(200);
    expect(packet.headers['content-disposition']).toContain('attachment;');
    const packetBody = packet.json() as {
      packetVersion: string;
      integrity: { algorithm: string; digest: string };
      modules: {
        requirements: { gateKey: string; evidence: { title: string; reviewStatus: string }[] }[];
      }[];
      summary: { satisfied: number; total: number };
    };
    expect(packetBody.packetVersion).toBe('1.0');
    expect(packetBody.integrity.algorithm).toBe('sha256');
    expect(packetBody.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(packetBody.summary).toMatchObject({ satisfied: 1, total: 18 });
    const exportAudit = await ctx.owner.client`
      select actor_user_id, after_state from enterprise_suite.audit_events
      where org_id = ${company.orgId} and action = 'control.audit_packet_exported'
    `;
    expect(exportAudit).toMatchObject([
      {
        actor_user_id: company.owner.userId,
        after_state: { moduleKey: 'accounting', digest: packetBody.integrity.digest },
      },
    ]);
    const other = await enabledCompany();
    const otherPacket = await call(ctx, 'GET', packetPath, { as: other.owner });
    expect(otherPacket.statusCode, otherPacket.body).toBe(200);
    expect(otherPacket.json().summary).toMatchObject({ satisfied: 0, total: 18 });
    expect(otherPacket.body).not.toContain('Approved product contract v4');
    expect(
      packetBody.modules[0]?.requirements.find((item) => item.gateKey === 'product-contract')
        ?.evidence[0],
    ).toMatchObject({
      title: 'Approved product contract v4',
      reviewStatus: 'accepted',
    });

    const expiringGate = '/v1/enterprise/blueprint/controls/accounting/roles-permissions';
    const expiredSubmission = await call(ctx, 'POST', expiringGate + '/evidence', {
      as: company.owner,
      body: {
        title: 'Old permission matrix',
        evidenceOn: yesterday,
        expiresOn: yesterday,
      },
    });
    expect(expiredSubmission.statusCode, expiredSubmission.body).toBe(201);
    const expiredEvidence = expiredSubmission.json() as { id: string };
    const expiredReview = await call(
      ctx,
      'POST',
      `/v1/enterprise/blueprint/control-evidence/${expiredEvidence.id}/review`,
      { as: reviewer, body: { decision: 'accepted', note: 'Superseded after the stated expiry' } },
    );
    expect(expiredReview.statusCode).toBe(200);

    const expired = await call(ctx, 'GET', '/v1/enterprise/blueprint/controls?module=accounting', {
      as: company.owner,
    });
    expect(
      (
        expired.json() as {
          modules: { requirements: { gateKey: string; status: string }[] }[];
        }
      ).modules[0]?.requirements.find((item) => item.gateKey === 'roles-permissions'),
    ).toMatchObject({ status: 'expired' });
  });

  it('summarizes every module for the suite compliance overview', async () => {
    const company = await enabledCompany();
    const res = await call(ctx, 'GET', '/v1/enterprise/blueprint/controls', {
      as: company.owner,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      scope: string | null;
      counts: { total: number; missing: number; satisfied: number };
      modules: {
        key: string;
        counts: { total: number };
        requirements: { moduleKey: string; status: string }[];
      }[];
    };
    expect(body.scope).toBeNull();
    expect(body.modules).toHaveLength(13);
    expect(body.modules.every((module) => module.requirements.length === 18)).toBe(true);
    expect(body.counts).toMatchObject({ total: 234, missing: 234, satisfied: 0 });
    expect(body.modules.reduce((total, module) => total + module.counts.total, 0)).toBe(234);
    expect(
      body.modules.every((module) =>
        module.requirements.every((gate) => gate.moduleKey === module.key),
      ),
    ).toBe(true);
  });
});
