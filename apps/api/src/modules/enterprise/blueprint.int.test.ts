// Enterprise Blueprint API integration coverage: idempotent creates, field/lifecycle validation,
// optimistic concurrency, tenant isolation and the RLS policy on work_package_records.
import { randomUUID } from 'node:crypto';
import { findWorkPackage, workPackageFieldKey } from '@fieldline/contracts';
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
      await sql`delete from enterprise_suite.work_package_records where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.audit_events where org_id = any(${orgIds}::uuid[])`;
      await sql`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => {
  await ctx?.close();
});

async function enabledCompany(): Promise<Company> {
  const company = await createCompany(ctx);
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

describe('Enterprise Blueprint records API', () => {
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
