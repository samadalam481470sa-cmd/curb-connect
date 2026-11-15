// CP-057-QA / OPS-065-QA / ADD-060-QA: regional price books, immutable approved revisions, CSV
// import with a validation report, narrowest service-area selection, disclosed company-wide
// fallback, stale and conflicting price detection, and identical work priced differently (and
// explainably) in two markets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';
import { approvedBook, createProperty, CURB_ITEMS, fixtureCandidate, insertServiceArea } from './fixtures';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx?.close());

const pin = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const CSV_HEADER = 'code,label,category,cost_component,unit,unit_rate,fixed_amount_minor,minimum_quantity,taxable,source,source_ref,price_date';

describe('CP-057-QA price books', () => {
  it('approved revisions are immutable; changes need a new revision', async () => {
    const a = await createCompany(ctx, { roles: ['finance', 'estimator'] });
    const { bookId, revisionId } = await approvedBook(ctx, a.as('finance'), { name: 'Default curb' });
    const locked = await call(ctx, 'PUT', `/v1/price-book-revisions/${revisionId}/items`, { as: a.as('finance'), body: { items: [] } });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe('immutable_record');
    // Even the owner connection's trigger refuses a direct edit of an approved item.
    await expect(ctx.owner.client`update price_items set unit_rate = 1 where price_book_revision_id = ${revisionId}`).rejects.toThrow();
    const next = await call(ctx, 'POST', `/v1/price-books/${bookId}/revisions`, { as: a.as('finance'), body: { copyFromRevisionId: revisionId } });
    expect(next.statusCode, next.body).toBe(201);
    expect(next.json()).toMatchObject({ revisionNumber: 2, status: 'draft' });
    expect(next.json().items).toHaveLength(CURB_ITEMS.length);
    expect(next.json().items[0]).toMatchObject({ source: 'test rate sheet', sourceRef: 'synthetic page-60' });
    // Estimators can read but not write price books.
    expect((await call(ctx, 'POST', '/v1/price-books', { as: a.as('estimator'), body: { name: 'X', productLine: 'curb' } })).statusCode).toBe(403);
    const approve = await call(ctx, 'POST', `/v1/price-book-revisions/${next.json().id}/approve`, { as: a.as('finance'), body: {} });
    expect(approve.statusCode).toBe(200);
    const first = await call(ctx, 'GET', `/v1/price-book-revisions/${revisionId}`, { as: a.as('estimator') });
    expect(first.json().status).toBe('retired');
  });

  it('CSV import reports every problem and applies nothing until the file is clean', async () => {
    const a = await createCompany(ctx, { roles: ['finance'] });
    const book = await call(ctx, 'POST', '/v1/price-books', { as: a.as('finance'), body: { name: 'Imported', productLine: 'curb' } });
    const draft = await call(ctx, 'POST', `/v1/price-books/${book.json().id}/revisions`, { as: a.as('finance'), body: {} });
    const bad = [
      CSV_HEADER,
      'SAW_CUT,Saw cutting,labor,cutting,linear_ft,$20,,,true,Supplier A,Q-1,2026-10-01',
      'BREAKOUT,Breakout,labor,demolition,linear_ft,,,,true,,,',
      'saw_cut,Duplicate,labor,cutting,linear_ft,21,,,true,Supplier A,Q-1,2026-10-01',
      'GLITTER,Glitter,sparkle,cutting,linear_ft,1,,,true,x,,2026-13-45',
    ].join('\n');
    const report = await call(ctx, 'POST', `/v1/price-book-revisions/${draft.json().id}/import`, { as: a.as('finance'), body: { csv: bad } });
    expect(report.statusCode, report.body).toBe(200);
    const r = report.json();
    expect(r).toMatchObject({ applied: false, totalRows: 4 });
    const fields = r.errors.map((e: { line: number; field: string }) => `${e.line}:${e.field}`);
    expect(fields).toEqual(expect.arrayContaining(['2:unit_rate', '3:unit_rate', '5:category', '5:price_date']));
    expect((await call(ctx, 'GET', `/v1/price-book-revisions/${draft.json().id}`, { as: a.as('finance') })).json().items).toHaveLength(0);

    const good = [CSV_HEADER, 'SAW_CUT,"Saw cutting, wet",labor,cutting,linear_ft,20,,,true,Supplier A,Q-1,2026-10-01', 'MOBILIZATION,Mobilization,mobilization,mobilization,lump_sum,,40000,,true,Crew sheet,,'].join('\r\n');
    const dry = await call(ctx, 'POST', `/v1/price-book-revisions/${draft.json().id}/import`, { as: a.as('finance'), body: { csv: good, dryRun: true } });
    expect(dry.json()).toMatchObject({ applied: false, validRows: 2, errors: [] });
    const applied = await call(ctx, 'POST', `/v1/price-book-revisions/${draft.json().id}/import`, { as: a.as('finance'), body: { csv: good } });
    expect(applied.json()).toMatchObject({ applied: true, validRows: 2 });
    expect(applied.json().warnings.some((w: { field: string }) => w.field === 'price_date')).toBe(true);
    const items = (await call(ctx, 'GET', `/v1/price-book-revisions/${draft.json().id}`, { as: a.as('finance') })).json().items;
    expect(items.map((i: { label: string }) => i.label)).toContain('Saw cutting, wet');
  });

  it('selects the narrowest covering service area, else a disclosed company-wide fallback', async () => {
    const a = await createCompany(ctx, { roles: ['finance'] });
    const metro = await insertServiceArea(ctx, a.orgId, 'Metro', 0.01, 0.01, 0.02);
    const downtown = await insertServiceArea(ctx, a.orgId, 'Downtown', 0.01, 0.01, 0.002);
    const def = await approvedBook(ctx, a.as('finance'), { name: 'Company default' });
    const metroBook = await approvedBook(ctx, a.as('finance'), { name: 'Metro book', serviceAreaId: metro });
    const dtBook = await approvedBook(ctx, a.as('finance'), {
      name: 'Downtown book',
      serviceAreaId: downtown,
      items: CURB_ITEMS.map((i) => (i.code === 'SAW_CUT' ? { ...i, unitRate: '26' } : i)),
    });
    const c = await fixtureCandidate(ctx, a.owner, '100 Fixture Way');
    const inDowntown = await createProperty(ctx, a.owner, { originalQuery: '100 Fixture Way', candidate: c });
    const inMetro = await createProperty(ctx, a.owner, { originalQuery: 'Edge of metro', confirmedLocation: pin(0.025, 0.025) });
    const outside = await createProperty(ctx, a.owner, { originalQuery: 'Far away', confirmedLocation: pin(0.5, 0.5) });
    const resolve = (id: string) => call(ctx, 'GET', `/v1/price-books/resolve?productLine=curb&propertyId=${id}`, { as: a.as('finance') });
    expect((await resolve(inDowntown.id)).json()).toMatchObject({ priceBookId: dtBook.bookId, match: 'service_area', fallback: false, disclosure: null, serviceArea: { id: downtown, name: 'Downtown' } });
    expect((await resolve(inMetro.id)).json()).toMatchObject({ priceBookId: metroBook.bookId, match: 'service_area' });
    const far = (await resolve(outside.id)).json();
    expect(far).toMatchObject({ priceBookId: def.bookId, match: 'company_default', fallback: true });
    expect(far.disclosure).toMatch(/company-wide default/);
  });

  it('detects stale prices and conflicting regional books', async () => {
    const a = await createCompany(ctx, { roles: ['finance'] });
    const area = await insertServiceArea(ctx, a.orgId, 'Zone', 0.01, 0.01, 0.01);
    await approvedBook(ctx, a.as('finance'), { name: 'Zone A', serviceAreaId: area, priceDate: '2020-01-01', maxPriceAgeDays: 30 });
    await approvedBook(ctx, a.as('finance'), { name: 'Zone B', serviceAreaId: area, items: CURB_ITEMS.map((i) => (i.code === 'BREAKOUT' ? { ...i, unitRate: '31' } : i)) });
    const p = await createProperty(ctx, a.owner, { originalQuery: 'Zone lot', confirmedLocation: pin(0.011, 0.011) });
    const sel = (await call(ctx, 'GET', `/v1/price-books/resolve?productLine=curb&propertyId=${p.id}`, { as: a.as('finance') })).json();
    expect(sel.conflicts.map((c: { code: string }) => c.code)).toEqual(['BREAKOUT']);
    expect(sel.stale.length).toBe(CURB_ITEMS.length);
    expect(sel.stale[0]).toMatchObject({ priceDate: '2020-01-01', maxAgeDays: 30 });
  });

  it('no approved book at all is price_unavailable, never $0; cross-tenant revision is 404', async () => {
    const a = await createCompany(ctx, { roles: ['finance'] });
    const b = await createCompany(ctx, { roles: ['finance'] });
    const p = await createProperty(ctx, a.owner, { originalQuery: 'Nowhere', confirmedLocation: pin(0.4, 0.4) });
    const none = await call(ctx, 'GET', `/v1/price-books/resolve?productLine=curb&propertyId=${p.id}`, { as: a.as('finance') });
    expect(none.statusCode).toBe(409);
    expect(none.json().code).toBe('price_unavailable');
    const { revisionId } = await approvedBook(ctx, a.as('finance'), { name: 'A book' });
    expect((await call(ctx, 'GET', `/v1/price-book-revisions/${revisionId}`, { as: b.as('finance') })).statusCode).toBe(404);
  });
});
