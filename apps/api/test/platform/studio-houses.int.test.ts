// House Studio saved houses against the real database through the restricted app role: save,
// rename with revision checks, duplicate, trash, restore, purge, tenant isolation and permissions.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, auditRows, call, createCompany, createTestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ env: { ANTHROPIC_API_KEY: '', SERPAPI_API_KEY: '' } });
});
afterEach(async () => {
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

const spec = { lengthFt: 52, widthFt: 34, stories: 1, bedrooms: 3, bathrooms: 2, garage: 'two_car', wallHeightFt: 9, roofPitch: 6 };
const house = {
  name: 'Oak Street ranch',
  source: 'ai',
  brief: '3 bed 2 bath ranch, 1,800 sq ft',
  spec,
  settings: {
    location: 'Dallas, Texas',
    onHand: { stud_2x4x8: 40 },
    priceOverrides: { stud_2x4x8: { unitPrice: 4.25, seller: 'My supplier', basis: 'manual' } },
    lot: { address: '12 Elm St', widthFt: 60, depthFt: 120, frontSetbackFt: 25, sideSetbackFt: 5, rearSetbackFt: 20, lat: null, lon: null, realLife: false },
    deal: { salePrice: 420000, lotCost: 60000, financingPercent: 2, commissionPercent: 3, overheadPercent: 5 },
  },
};

describe('House Studio saved houses', () => {
  it('saves, lists, renames with revision checks, duplicates, trashes, restores and purges', async () => {
    const company = await createCompany(ctx);
    const created = await call(ctx, 'POST', '/v1/studio-houses', { as: company.owner, body: house });
    expect(created.statusCode, created.body).toBe(201);
    const saved = created.json();
    expect(saved).toMatchObject({ name: 'Oak Street ranch', source: 'ai', revision: 1, deletedAt: null });
    expect(saved.settings.onHand).toEqual({ stud_2x4x8: 40 });

    const list = await call(ctx, 'GET', '/v1/studio-houses', { as: company.owner });
    expect(list.json().items.map((h: { id: string }) => h.id)).toEqual([saved.id]);

    const renamed = await call(ctx, 'PATCH', `/v1/studio-houses/${saved.id}`, { as: company.owner, body: { revision: 1, name: 'Oak St. ranch v2' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Oak St. ranch v2', revision: 2 });

    // A second tab still on revision 1 cannot overwrite the newer save.
    const stale = await call(ctx, 'PATCH', `/v1/studio-houses/${saved.id}`, { as: company.owner, body: { revision: 1, name: 'Old tab' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('revision_conflict');

    const copy = await call(ctx, 'POST', `/v1/studio-houses/${saved.id}/duplicate`, { as: company.owner });
    expect(copy.statusCode, copy.body).toBe(201);
    expect(copy.json()).toMatchObject({ name: 'Oak St. ranch v2 (copy)', revision: 1 });

    // Purging needs the trash first.
    const early = await call(ctx, 'DELETE', `/v1/studio-houses/${saved.id}?permanent=true`, { as: company.owner });
    expect(early.statusCode).toBe(409);

    const trashed = await call(ctx, 'DELETE', `/v1/studio-houses/${saved.id}`, { as: company.owner });
    expect(trashed.statusCode, trashed.body).toBe(200);
    expect(trashed.json().deletedAt).not.toBeNull();
    const active = await call(ctx, 'GET', '/v1/studio-houses', { as: company.owner });
    expect(active.json().items).toHaveLength(1);
    const trash = await call(ctx, 'GET', '/v1/studio-houses?trash=true', { as: company.owner });
    expect(trash.json().items.map((h: { id: string }) => h.id)).toEqual([saved.id]);

    // Editing a trashed house is refused until it is restored.
    const editTrashed = await call(ctx, 'PATCH', `/v1/studio-houses/${saved.id}`, { as: company.owner, body: { revision: 3, name: 'x' } });
    expect(editTrashed.statusCode).toBe(409);
    const restored = await call(ctx, 'POST', `/v1/studio-houses/${saved.id}/restore`, { as: company.owner });
    expect(restored.json().deletedAt).toBeNull();

    await call(ctx, 'DELETE', `/v1/studio-houses/${saved.id}`, { as: company.owner });
    const purged = await call(ctx, 'DELETE', `/v1/studio-houses/${saved.id}?permanent=true`, { as: company.owner });
    expect(purged.statusCode).toBe(204);
    const gone = await call(ctx, 'GET', `/v1/studio-houses/${saved.id}`, { as: company.owner });
    expect(gone.statusCode).toBe(404);

    const audit = (await auditRows(ctx, company.orgId)).map((r: { action: string }) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['studio_house.trashed', 'studio_house.restored', 'studio_house.purged']));
  });

  it('keeps each company\'s houses private and checks permissions', async () => {
    const a = await createCompany(ctx, { roles: ['read_only'] });
    const b = await createCompany(ctx);
    const saved = (await call(ctx, 'POST', '/v1/studio-houses', { as: a.owner, body: house })).json();

    const otherCompany = await call(ctx, 'GET', `/v1/studio-houses/${saved.id}`, { as: b.owner });
    expect(otherCompany.statusCode).toBe(404);
    const otherDelete = await call(ctx, 'DELETE', `/v1/studio-houses/${saved.id}`, { as: b.owner });
    expect(otherDelete.statusCode).toBe(404);
    expect((await call(ctx, 'GET', '/v1/studio-houses', { as: b.owner })).json().items).toEqual([]);

    const readOnly = a.members.read_only!;
    expect((await call(ctx, 'GET', '/v1/studio-houses', { as: readOnly })).statusCode).toBe(200);
    expect((await call(ctx, 'DELETE', `/v1/studio-houses/${saved.id}`, { as: readOnly })).statusCode).toBe(403);
    expect((await call(ctx, 'GET', '/v1/studio-houses')).statusCode).toBe(401);
  });

  it('rejects invalid houses', async () => {
    const company = await createCompany(ctx);
    const badSpec = await call(ctx, 'POST', '/v1/studio-houses', { as: company.owner, body: { ...house, spec: { ...spec, bedrooms: 40 } } });
    expect(badSpec.statusCode).toBe(400);
    const extraKey = await call(ctx, 'POST', '/v1/studio-houses', { as: company.owner, body: { ...house, settings: { script: '<x>' } } });
    expect(extraKey.statusCode).toBe(400);
    const notUuid = await call(ctx, 'GET', '/v1/studio-houses/not-a-uuid', { as: company.owner });
    expect(notUuid.statusCode).toBe(400);
  });
});

describe('House Studio prices and site', () => {
  it('needs a member for store prices and surroundings, and says when store prices are off', async () => {
    const company = await createCompany(ctx);
    expect((await call(ctx, 'GET', '/v1/market/material-prices?q=2x4%20stud')).statusCode).toBe(401);
    const prices = await call(ctx, 'GET', '/v1/market/material-prices?q=2x4%20stud', { as: company.owner });
    expect(prices.statusCode, prices.body).toBe(200);
    expect(prices.json()).toMatchObject({ live: false, offers: [] });
    expect((await call(ctx, 'POST', '/v1/site/context', { body: { lat: 32.9, lon: -96.9 } })).statusCode).toBe(401);
    const bad = await call(ctx, 'POST', '/v1/site/context', { as: company.owner, body: { lat: 132.9, lon: -96.9 } });
    expect(bad.statusCode).toBe(400);
  });
});
