// Fixtures for the commerce-core integration tests: synthetic jurisdictions (global table, inserted
// with the owner connection and removed afterwards), service areas, approved price books built
// through the API, and curb projects / roof orders inserted directly (their modules own the API).
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { call, type Company, type Person, type TestContext } from '../helpers';

export const createdJurisdictionCodes = new Set<string>();

/** Square WKT MultiPolygon centred on lon/lat with half-size h degrees. */
export function squareWkt(lon: number, lat: number, h: number): string {
  const r = `${lon - h} ${lat - h}, ${lon + h} ${lat - h}, ${lon + h} ${lat + h}, ${lon - h} ${lat + h}, ${lon - h} ${lat - h}`;
  return `SRID=4326;MULTIPOLYGON(((${r})))`;
}

export async function insertJurisdiction(ctx: TestContext, input: { name: string; kind: 'city' | 'county' | 'state' | 'unincorporated'; lon: number; lat: number; h: number }): Promise<string> {
  const code = `test-${input.name.toLowerCase().replaceAll(' ', '-')}-${randomUUID().slice(0, 8)}`;
  createdJurisdictionCodes.add(code);
  const [row] = await ctx.owner.client<{ id: string }[]>`
    insert into jurisdictions (code, name, kind, status, boundary, is_synthetic, rules_version)
    values (${code}, ${input.name}, ${input.kind}, 'draft', ST_GeomFromEWKT(${squareWkt(input.lon, input.lat, input.h)}), true, 'synthetic-1')
    returning id`;
  return row!.id;
}

export async function removeJurisdictions(ctx: TestContext): Promise<void> {
  const codes = [...createdJurisdictionCodes];
  if (!codes.length) return;
  await ctx.owner.client.begin(async (sql) => {
    await sql`set local session_replication_role = replica`;
    await sql`delete from jurisdictions where code = any(${codes}::text[])`;
  });
  createdJurisdictionCodes.clear();
}

export async function insertServiceArea(ctx: TestContext, orgId: string, name: string, lon: number, lat: number, h: number): Promise<string> {
  const [row] = await ctx.owner.client<{ id: string }[]>`
    insert into service_areas (org_id, name, kind, product_lines, boundary)
    values (${orgId}, ${name}, 'custom', '{curb,roof}', ST_GeomFromEWKT(${squareWkt(lon, lat, h)}))
    returning id`;
  return row!.id;
}

/** Golden page-60 curb items (synthetic rates). */
export const CURB_ITEMS = [
  { code: 'MOBILIZATION', label: 'Mobilization', category: 'mobilization', costComponent: 'mobilization', unit: 'lump_sum', unitRate: null, fixedAmountMinor: 40000, minimumQuantity: null, taxable: true },
  { code: 'SAW_CUT', label: 'Saw cutting', category: 'labor', costComponent: 'cutting', unit: 'linear_ft', unitRate: '20', fixedAmountMinor: null, minimumQuantity: null, taxable: true },
  { code: 'BREAKOUT', label: 'Curb breakout', category: 'labor', costComponent: 'demolition', unit: 'linear_ft', unitRate: '28', fixedAmountMinor: null, minimumQuantity: null, taxable: true },
  { code: 'DISPOSAL', label: 'Disposal', category: 'disposal', costComponent: 'disposal', unit: 'lump_sum', unitRate: null, fixedAmountMinor: 22000, minimumQuantity: null, taxable: true },
  { code: 'REPLACE_CURB', label: 'Curb replacement', category: 'material', costComponent: 'restoration', unit: 'linear_ft', unitRate: '95', fixedAmountMinor: null, minimumQuantity: null, taxable: true },
  { code: 'TRAFFIC', label: 'Traffic control', category: 'traffic_control', costComponent: 'traffic', unit: 'lump_sum', unitRate: null, fixedAmountMinor: 35000, minimumQuantity: null, taxable: true },
  { code: 'PERMIT_ALLOW', label: 'Permit allowance', category: 'permit', costComponent: 'permits', unit: 'lump_sum', unitRate: null, fixedAmountMinor: 20000, minimumQuantity: null, taxable: true },
] as const;

export const GOLDEN_LINES = [
  { code: 'MOBILIZATION', quantity: '1' },
  { code: 'SAW_CUT', quantityKey: 'cut_length' },
  { code: 'BREAKOUT', quantityKey: 'cut_length' },
  { code: 'DISPOSAL', quantity: '1' },
  { code: 'REPLACE_CURB', quantityKey: 'cut_length' },
  { code: 'TRAFFIC', quantity: '1' },
  { code: 'PERMIT_ALLOW', quantity: '1' },
];

const now = () => new Date().toISOString();
/** 18 ft = 5.4864 m exactly, field verified. */
export const fieldVerifiedCut = () => ({ state: 'known', value: 5.4864, unit: 'm', source: 'field_verified', measuredAt: now(), precision: 0 });
export const photoCut = () => ({ state: 'known', value: 5.4864, unit: 'm', source: 'imagery_derived', measuredAt: now(), precision: 0.3 });
export const known = (value: boolean) => ({ state: 'known', value, source: 'field_verified', recordedAt: now() });
export const CLEAR_SITE = {
  permit_required: known(false),
  public_right_of_way: known(false),
  utilities_cleared: known(true),
  depth_verified: known(true),
};

export async function approvedBook(
  ctx: TestContext,
  as: Person,
  input: { name: string; serviceAreaId?: string; productLine?: 'curb' | 'roof'; items?: readonly Record<string, unknown>[]; priceDate?: string | null; maxPriceAgeDays?: number },
): Promise<{ bookId: string; revisionId: string }> {
  const book = await call(ctx, 'POST', '/v1/price-books', {
    as,
    body: { name: input.name, productLine: input.productLine ?? 'curb', currency: 'USD', ...(input.serviceAreaId && { serviceAreaId: input.serviceAreaId }) },
  });
  expect(book.statusCode, book.body).toBe(201);
  const items = (input.items ?? CURB_ITEMS).map((i) => ({ ...i, source: 'test rate sheet', sourceRef: 'synthetic page-60', priceDate: input.priceDate === undefined ? new Date().toISOString().slice(0, 10) : input.priceDate }));
  const rev = await call(ctx, 'POST', `/v1/price-books/${book.json().id}/revisions`, {
    as,
    body: { overheadRate: '0.1', contingencyRate: '0', marginStrategy: 'target_margin', marginRate: '0.25', taxRate: '0', items, ...(input.maxPriceAgeDays && { maxPriceAgeDays: input.maxPriceAgeDays }) },
  });
  expect(rev.statusCode, rev.body).toBe(201);
  const approve = await call(ctx, 'POST', `/v1/price-book-revisions/${rev.json().id}/approve`, { as, body: { effectiveFrom: '2020-01-01' } });
  expect(approve.statusCode, approve.body).toBe(200);
  return { bookId: book.json().id, revisionId: rev.json().id };
}

export async function createProperty(ctx: TestContext, as: Person, body: Record<string, unknown>) {
  const res = await call(ctx, 'POST', '/v1/properties', { as, body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; revision: number; structures: { id: string; revision: number }[]; jurisdiction: { status: string; candidates: { id: string }[] }; [k: string]: unknown };
}

export async function fixtureCandidate(ctx: TestContext, as: Person, q: string) {
  const res = await call(ctx, 'GET', `/v1/search/addresses?q=${encodeURIComponent(q)}`, { as });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().candidates[0];
}

export async function curbProject(ctx: TestContext, company: Company, propertyId: string): Promise<string> {
  const [row] = await ctx.owner.client<{ id: string }[]>`
    insert into curb_projects (org_id, number, property_id, service_code)
    values (${company.orgId}, ${`CP-${randomUUID().slice(0, 6)}`}, ${propertyId}, 'driveway_opening') returning id`;
  return row!.id;
}

export async function roofOrder(ctx: TestContext, company: Company, propertyId: string): Promise<string> {
  const [row] = await ctx.owner.client<{ id: string }[]>`
    insert into roof_orders (org_id, number, property_id, mode)
    values (${company.orgId}, ${`RO-${randomUUID().slice(0, 6)}`}, ${propertyId}, 'diy') returning id`;
  return row!.id;
}

export async function createEstimate(ctx: TestContext, as: Person, body: Record<string, unknown>, key = randomUUID()) {
  return call(ctx, 'POST', '/v1/estimates', { as, body, headers: { 'idempotency-key': key } });
}

export async function countRows(ctx: TestContext, table: 'audit_events' | 'domain_events' | 'command_receipts', orgId: string): Promise<number> {
  const [r] = await ctx.owner.client<{ n: number }[]>`select count(*)::int as n from ${ctx.owner.client(table)} where org_id = ${orgId}`;
  return r!.n;
}
