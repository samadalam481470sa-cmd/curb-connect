// RF-017-QA / RF-024-QA / RF-077-QA / ADD-021-QA: address selection, candidate structures that are
// never assumed in scope, pin relocation that keeps the original evidence, geocoder vs detection
// confidence, jurisdiction resolution (resolved / ambiguous / unresolved / manual), structures CRUD.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';
import { createProperty, fixtureCandidate, insertJurisdiction, removeJurisdictions } from './fixtures';

let ctx: TestContext;
let cityA: string;
let cityB: string;
let cityC: string;
beforeAll(async () => {
  ctx = await createTestContext();
  cityA = await insertJurisdiction(ctx, { name: 'Testville City', kind: 'city', lon: 0.01, lat: 0.01, h: 0.004 });
  // Two municipalities both claim 300 Border Road (0.03, 0.03).
  cityB = await insertJurisdiction(ctx, { name: 'Border North', kind: 'city', lon: 0.031, lat: 0.031, h: 0.003 });
  cityC = await insertJurisdiction(ctx, { name: 'Border South', kind: 'city', lon: 0.029, lat: 0.029, h: 0.003 });
});
afterAll(async () => {
  await ctx?.cleanup();
  await removeJurisdictions(ctx);
  await ctx?.close();
});

const pin = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });

describe('RF-017-QA address search and property confirmation', () => {
  it('search returns provenance; a single rooftop match resolves the jurisdiction', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    const search = await call(ctx, 'GET', '/v1/search/addresses?q=100%20Fixture%20Way', { as: a.as('estimator') });
    expect(search.statusCode).toBe(200);
    const c = search.json().candidates[0];
    expect(c).toMatchObject({ provider: 'fixture', isSynthetic: true, storable: true, precision: 'rooftop' });
    expect(c.attribution).toMatch(/Synthetic/);
    const p = await createProperty(ctx, a.as('estimator'), { originalQuery: '100 Fixture Way', candidate: c, label: 'Fixture home' });
    expect(p).toMatchObject({ originalQuery: '100 Fixture Way', isFictional: true, needsReview: false, jurisdictionId: cityA });
    expect(p.jurisdiction).toMatchObject({ status: 'resolved', manualVerificationRequired: false });
    // RF-017 R: geocoder confidence and roof-detection confidence are separate fields.
    expect((p as unknown as { geocoder: { confidence: number } }).geocoder.confidence).toBe(0.97);
    expect(p.structures).toHaveLength(1);
    expect(p.structures[0]).toMatchObject({ detectionConfidence: 0.91, scopeConfirmed: true, candidateSource: 'fixture' });
  });

  it('two buildings at one address: nothing is assumed until every structure is decided', async () => {
    const a = await createCompany(ctx);
    const c = await fixtureCandidate(ctx, a.owner, '200 Campus Loop');
    const p = await createProperty(ctx, a.owner, { originalQuery: '200 Campus Loop', candidate: c });
    expect(p.needsReview).toBe(true);
    expect(p.reviewReason).toContain('confirm_structures_in_scope');
    expect(p.scopeConfirmedAt).toBeNull();
    expect(p.structures.map((s) => (s as unknown as { scopeConfirmed: boolean }).scopeConfirmed)).toEqual([false, false]);
    // No boundary covers this point: explicit unresolved state.
    expect(p.jurisdiction).toMatchObject({ status: 'unresolved', manualVerificationRequired: true });

    const partial = await call(ctx, 'POST', `/v1/properties/${p.id}/scope`, {
      as: a.owner,
      body: { expectedRevision: p.revision, structures: [{ structureId: p.structures[0]!.id, scopeStatus: 'included' }] },
    });
    expect(partial.statusCode).toBe(422);
    expect(partial.json().code).toBe('address_ambiguous');
    const ok = await call(ctx, 'POST', `/v1/properties/${p.id}/scope`, {
      as: a.owner,
      body: {
        expectedRevision: p.revision,
        structures: [
          { structureId: p.structures[0]!.id, scopeStatus: 'included' },
          { structureId: p.structures[1]!.id, scopeStatus: 'unmeasured' },
        ],
      },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().property.scopeConfirmedAt).not.toBeNull();
    expect(ok.json().property.reviewReason ?? '').not.toContain('confirm_structures_in_scope');
    expect(ok.json().property.structures.map((s: { scopeStatus: string }) => s.scopeStatus)).toEqual(['included', 'unmeasured']);
  });

  it('an ambiguous query is never auto-picked; a tampered candidate is rejected', async () => {
    const a = await createCompany(ctx);
    const amb = await call(ctx, 'POST', '/v1/properties', { as: a.owner, body: { originalQuery: '1 Main Street' } });
    expect(amb.statusCode).toBe(422);
    expect(amb.json().code).toBe('address_ambiguous');
    const c = await fixtureCandidate(ctx, a.owner, '100 Fixture Way');
    const forged = await call(ctx, 'POST', '/v1/properties', { as: a.owner, body: { originalQuery: '100 Fixture Way', candidate: { ...c, placeId: 'fixture:somewhere-else' } } });
    expect(forged.statusCode).toBe(400);
    // Not found anywhere: a manual pin is accepted and labeled.
    const manual = await createProperty(ctx, a.owner, { originalQuery: 'Lot behind the quarry', confirmedLocation: pin(0.0102, 0.0099) });
    expect(manual).toMatchObject({ location: null, confirmedLocation: pin(0.0102, 0.0099), geocoder: null, jurisdictionId: cityA });
    expect(manual.reviewReason).toContain('manual_pin_only');
  });

  it('overlapping municipalities: ambiguous, manual locality selector limited to candidates', async () => {
    const a = await createCompany(ctx);
    const c = await fixtureCandidate(ctx, a.owner, '300 Border Road');
    const p = await createProperty(ctx, a.owner, { originalQuery: '300 Border Road', candidate: c });
    expect(p.jurisdiction.status).toBe('ambiguous');
    expect(p.jurisdiction.candidates.map((x) => x.id).sort()).toEqual([cityB, cityC].sort());
    expect(p.reviewReason).toContain('low_geocoder_confidence');
    const wrong = await call(ctx, 'POST', `/v1/properties/${p.id}/jurisdiction`, { as: a.owner, body: { expectedRevision: p.revision, jurisdictionId: cityA } });
    expect(wrong.statusCode).toBe(400);
    const pick = await call(ctx, 'POST', `/v1/properties/${p.id}/jurisdiction`, { as: a.owner, body: { expectedRevision: p.revision, jurisdictionId: cityB, reason: 'County GIS confirms north side' } });
    expect(pick.statusCode, pick.body).toBe(200);
    expect(pick.json().property.jurisdiction).toMatchObject({ status: 'manual', jurisdictionId: cityB, manualVerificationRequired: false });
    // Moving the pin keeps the manual pick while it still covers the point.
    const moved = await call(ctx, 'POST', `/v1/properties/${p.id}/pin`, { as: a.owner, body: { expectedRevision: pick.json().property.revision, location: pin(0.0301, 0.0301) } });
    expect(moved.json().property.jurisdiction).toMatchObject({ status: 'manual', jurisdictionId: cityB });
    expect(moved.json().property.location).toEqual(pin(0.03, 0.03));
  });

  it('structures CRUD with If-Match; cross-tenant is 404; read_only cannot write', async () => {
    const a = await createCompany(ctx, { roles: ['read_only'] });
    const b = await createCompany(ctx);
    const c = await fixtureCandidate(ctx, a.owner, '100 Fixture Way');
    const p = await createProperty(ctx, a.owner, { originalQuery: '100 Fixture Way', candidate: c });
    const added = await call(ctx, 'POST', `/v1/properties/${p.id}/structures`, { as: a.owner, body: { label: 'Shed under tree', kind: 'shed', scopeStatus: 'unmeasured' } });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json()).toMatchObject({ scopeConfirmed: true, candidateSource: 'user_added', scopeStatus: 'unmeasured' });
    const id = added.json().id;
    const stale = await call(ctx, 'PATCH', `/v1/structures/${id}`, { as: a.owner, body: { label: 'Shed' }, headers: { 'if-match': '"9"' } });
    expect(stale.statusCode).toBe(412);
    const patched = await call(ctx, 'PATCH', `/v1/structures/${id}`, { as: a.owner, body: { label: 'Garden shed', stories: 1 }, headers: { 'if-match': '"1"' } });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ label: 'Garden shed', revision: 2 });
    expect((await call(ctx, 'GET', `/v1/properties/${p.id}`, { as: b.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'PATCH', `/v1/structures/${id}`, { as: b.owner, body: { label: 'x' }, headers: { 'if-match': '"2"' } })).statusCode).toBe(404);
    expect((await call(ctx, 'POST', `/v1/properties/${p.id}/structures`, { as: a.as('read_only'), body: { label: 'X', kind: 'shed', scopeStatus: 'included' } })).statusCode).toBe(403);
    const del = await call(ctx, 'DELETE', `/v1/structures/${id}`, { as: a.owner, headers: { 'if-match': '"2"' } });
    expect(del.statusCode).toBe(204);
    const list = await call(ctx, 'GET', `/v1/properties/${p.id}/structures`, { as: a.as('read_only') });
    expect(list.json().items).toHaveLength(1);
  });
});
