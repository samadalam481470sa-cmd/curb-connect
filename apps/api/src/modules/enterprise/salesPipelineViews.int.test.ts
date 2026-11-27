import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../../../test/helpers';

let ctx: TestContext;
const pipeline = '/v1/enterprise/sales/pipeline';
const views = pipeline + '/saved-views';
const leads = '/v1/enterprise/sales/leads';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_pipeline_views where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_activities where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_leads where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_sources where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});
afterAll(async () => ctx?.close());

it('persists private and shared pipeline views without granting access to results', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator'] });
  const foreign = await createCompany(ctx);
  const rep = company.as('salesperson');
  for (const tenant of [company, foreign]) {
    const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
  }
  const source = await call(ctx, 'POST', leads + '/sources', {
    as: company.owner,
    body: { name: 'Saved view test' },
  });
  expect(source.statusCode, source.body).toBe(201);
  const input = {
    name: 'Owner-only prospect',
    sourceId: source.json().id,
    contactMethod: 'none',
    consent: {},
  };
  const preview = await call(ctx, 'POST', leads + '/preview', { as: company.owner, body: input });
  const lead = await call(ctx, 'POST', leads, {
    as: company.owner,
    headers: { 'if-match': '"0"' },
    body: {
      ...input,
      previewFingerprint: preview.json().previewFingerprint,
      clientRequestId: randomUUID(),
    },
  });
  expect(lead.statusCode, lead.body).toBe(201);

  const sharedRequest = {
    name: 'Company pipeline',
    visibility: 'company',
    filters: { sourceId: source.json().id, stage: 'new', sort: 'name_asc' },
    columns: ['lot', 'probability'],
    clientRequestId: randomUUID(),
  };
  const save = (body: object, as = company.owner) => call(ctx, 'POST', views, { as, body });
  expect((await save(sharedRequest, rep)).statusCode).toBe(403);
  expect(
    (await save({ ...sharedRequest, columns: ['probability', 'probability'] })).statusCode,
  ).toBe(400);
  const shared = await save(sharedRequest);
  expect(shared.statusCode, shared.body).toBe(201);
  const sharedId = shared.json().id as string;
  expect(shared.json()).toMatchObject({
    filters: sharedRequest.filters,
    columns: ['lot', 'probability'],
    visibility: 'company',
    owned: true,
  });
  const retry = await save(sharedRequest);
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().id).toBe(sharedId);
  expect(
    (await save({ ...sharedRequest, name: 'COMPANY PIPELINE', clientRequestId: randomUUID() }))
      .statusCode,
  ).toBe(409);

  const privateView = await save(
    {
      ...sharedRequest,
      name: 'My pipeline',
      visibility: 'private',
      columns: [],
      clientRequestId: randomUUID(),
    },
    rep,
  );
  expect(privateView.statusCode, privateView.body).toBe(201);
  const privateId = privateView.json().id as string;
  const get = (id: string, as = rep) => call(ctx, 'GET', views + '/' + id, { as });
  const fromRep = await get(sharedId);
  expect(fromRep.statusCode, fromRep.body).toBe(200);
  expect(fromRep.json()).toMatchObject({
    id: sharedId,
    owned: false,
    filters: sharedRequest.filters,
  });
  expect((await get(sharedId, foreign.owner)).statusCode).toBe(404);
  expect((await get(sharedId, company.as('estimator'))).statusCode).toBe(403);
  expect((await get(privateId, company.owner)).statusCode).toBe(404);
  expect((await get(randomUUID())).statusCode).toBe(404);
  const list = await call(ctx, 'GET', views, { as: rep });
  expect(list.json().items.map(({ id }: { id: string }) => id)).toEqual([privateId, sharedId]);
  const board = pipeline + '?' + new URLSearchParams(fromRep.json().filters);
  const managerRows = await call(ctx, 'GET', board, { as: company.owner });
  expect(managerRows.json().items).toHaveLength(1);
  const repRows = await call(ctx, 'GET', board, { as: rep });
  expect(repRows.json()).toMatchObject({ items: [], counts: [] });
  const audits = await ctx.owner
    .client`select resource_id from public.audit_events where org_id = ${company.orgId} and action = 'sales.pipeline_view_saved'`;
  expect(audits.map(({ resource_id }) => resource_id).sort()).toEqual([sharedId, privateId].sort());
}, 60_000);
