// Invoice Intelligence end to end on a real RLS database: upload, auto column matching, review,
// approval into Billing, duplicate protection, payments, Analysis, tenant isolation and roles.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterEach(async () => { await ctx.cleanup(); });
afterAll(async () => { await ctx?.close(); });

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const CSV = [
  'Invoice Number,Customer,Invoice Date,Due Date,Subtotal,Tax,Total,Amount Paid,Status',
  'INV-9001,Lone Star Homes,2026-10-01,2026-10-31,1000.00,82.50,1082.50,1082.50,Paid',
  'INV-9002,Lone Star Homes,2026-11-01,2026-12-01,500.00,0,500.00,0,Sent',
  'INV-9003,Bob Smith,2026-11-05,2026-12-05,300.00,0,350.00,0,Sent',
].join('\n');
const BILLS = ['Date,Bill No.,Vendor,Due Date,Amount,Open Balance', '10/02/2026,B-1,ABC Supply Co,10/30/2026,400.00,400.00'].join('\n');

describe('Invoice Intelligence', () => {
  it('imports, reviews, approves into Billing, tracks payments and feeds Analysis', async () => {
    const company = await createCompany(ctx);
    const as = company.owner;
    const batch = await call(ctx, 'POST', '/v1/invoice-intel/batches', { as, body: { sourcePlatform: 'other', directionHint: 'receivable' } });
    expect(batch.statusCode).toBe(200);
    const batchId = (batch.json() as { batch: { id: string } }).batch.id;

    const up = await call(ctx, 'POST', `/v1/invoice-intel/batches/${batchId}/files`, { as, body: { name: 'invoices.csv', dataBase64: b64(CSV) } });
    expect(up.statusCode).toBe(200);
    const [res] = (up.json() as { results: { status: string; records: number }[] }).results;
    expect(res).toMatchObject({ status: 'extracted', records: 3 });

    const again = await call(ctx, 'POST', `/v1/invoice-intel/batches/${batchId}/files`, { as, body: { name: 'copy.csv', dataBase64: b64(CSV) } });
    expect((again.json() as { results: { status: string }[] }).results[0]!.status).toBe('duplicate_file');

    const queue = await call(ctx, 'GET', '/v1/invoice-intel/records?review=needs_review&sort=date', { as });
    const items = (queue.json() as { items: { id: string; invoiceNumber: string; reviewReasons: string[] }[] }).items;
    expect(items).toHaveLength(3);
    const bad = items.find((i) => i.invoiceNumber === 'INV-9003')!;
    expect(bad.reviewReasons.join(' ')).toMatch(/Parts add up/);

    const bulk = await call(ctx, 'POST', '/v1/invoice-intel/records/bulk', { as, body: { ids: items.map((i) => i.id), action: 'approve_clean' } });
    const out = bulk.json() as { done: string[]; skipped: { id: string }[] };
    expect(out.done).toHaveLength(2);
    expect(out.skipped.map((s) => s.id)).toEqual([bad.id]);

    const fixed = await call(ctx, 'PATCH', `/v1/invoice-intel/records/${bad.id}`, { as, body: { subtotalMinor: 35000 } });
    expect(fixed.statusCode).toBe(200);
    expect((fixed.json() as { record: { reviewReasons: string[] } }).record.reviewReasons).toEqual([]);
    const approved = await call(ctx, 'POST', `/v1/invoice-intel/records/${bad.id}/approve`, { as, body: {} });
    expect(approved.statusCode).toBe(200);
    expect(await call(ctx, 'POST', `/v1/invoice-intel/records/${bad.id}/approve`, { as, body: {} }).then((r) => r.statusCode)).toBe(200);

    const inBilling = await ctx.owner.client<{ number: string; total_minor: string; status: string }[]>`
      select number, total_minor, status from invoices where org_id = ${company.orgId}::uuid order by number`;
    expect(inBilling.map((r) => [r.number, Number(r.total_minor), r.status])).toEqual([
      ['INV-9001', 108250, 'paid'],
      ['INV-9002', 50000, 'issued'],
      ['INV-9003', 35000, 'issued'],
    ]);

    // Vendor bills from a QuickBooks-style export are recognised as received bills.
    const b2 = await call(ctx, 'POST', '/v1/invoice-intel/batches', { as, body: {} });
    const b2Id = (b2.json() as { batch: { id: string } }).batch.id;
    await call(ctx, 'POST', `/v1/invoice-intel/batches/${b2Id}/files`, { as, body: { name: 'bills.csv', dataBase64: b64(BILLS) } });
    const bills = (await call(ctx, 'GET', `/v1/invoice-intel/records?review=needs_review&batchId=${b2Id}`, { as })).json() as { items: { id: string; direction: string; category: string }[] };
    expect(bills.items[0]).toMatchObject({ direction: 'payable', category: 'Materials' });
    expect((await call(ctx, 'POST', `/v1/invoice-intel/records/${bills.items[0]!.id}/approve`, { as, body: {} })).statusCode).toBe(200);
    const pay = await call(ctx, 'POST', `/v1/invoice-intel/records/${bills.items[0]!.id}/payments`, { as, body: { paidOn: '2026-11-03', amountMinor: 10000 } });
    expect(pay.statusCode).toBe(200);
    expect((await call(ctx, 'POST', `/v1/invoice-intel/records/${bills.items[0]!.id}/payments`, { as, body: { paidOn: '2026-11-03', amountMinor: 999999 } })).statusCode).toBe(409);

    const analysis = await call(ctx, 'GET', '/v1/invoice-intel/analysis?from=2026-01-01&to=2026-12-31', { as });
    expect(analysis.statusCode).toBe(200);
    const a = analysis.json() as { kpis: Record<string, { value: number }>; completeness: { receivables: number; payables: number } };
    expect(a.kpis.invoiced!.value).toBe(108250 + 50000 + 35000);
    expect(a.kpis.billed!.value).toBe(40000);
    expect(a.kpis.paidOut!.value).toBe(10000);
    expect(a.completeness).toMatchObject({ receivables: 3, payables: 1 });

    const csv = await call(ctx, 'GET', '/v1/invoice-intel/export.csv?view=imports&review=approved', { as });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('INV-9002');

    const history = (await call(ctx, 'GET', '/v1/invoice-intel/batches', { as })).json() as { items: { importedCount: number; files: unknown[] }[] };
    expect(history.items).toHaveLength(2);
  });

  it('keeps each company to its own imports and blocks read-only members from uploading', async () => {
    const a = await createCompany(ctx, { roles: ['read_only'] });
    const b = await createCompany(ctx);
    const batch = await call(ctx, 'POST', '/v1/invoice-intel/batches', { as: a.owner, body: {} });
    const batchId = (batch.json() as { batch: { id: string } }).batch.id;
    await call(ctx, 'POST', `/v1/invoice-intel/batches/${batchId}/files`, { as: a.owner, body: { name: 'x.csv', dataBase64: b64(CSV) } });
    const mine = (await call(ctx, 'GET', '/v1/invoice-intel/records?review=all', { as: a.owner })).json() as { items: { id: string }[] };
    expect(mine.items.length).toBe(3);
    const theirs = (await call(ctx, 'GET', '/v1/invoice-intel/records?review=all', { as: b.owner })).json() as { items: unknown[] };
    expect(theirs.items).toHaveLength(0);
    expect((await call(ctx, 'GET', `/v1/invoice-intel/records/${mine.items[0]!.id}`, { as: b.owner })).statusCode).toBe(404);
    expect((await call(ctx, 'POST', `/v1/invoice-intel/batches/${batchId}/files`, { as: b.owner, body: { name: 'y.csv', dataBase64: b64(CSV) } })).statusCode).toBe(404);
    expect((await call(ctx, 'POST', '/v1/invoice-intel/batches', { as: a.as('read_only'), body: {} })).statusCode).toBe(403);
    expect((await call(ctx, 'GET', '/v1/invoice-intel/analysis', { as: a.as('read_only') })).statusCode).toBe(200);
  });

  it('rejects executables and unsafe archives without storing them', async () => {
    const company = await createCompany(ctx);
    const batch = await call(ctx, 'POST', '/v1/invoice-intel/batches', { as: company.owner, body: {} });
    const batchId = (batch.json() as { batch: { id: string } }).batch.id;
    const exe = await call(ctx, 'POST', `/v1/invoice-intel/batches/${batchId}/files`, { as: company.owner, body: { name: 'invoices.csv', dataBase64: Buffer.from([0x4d, 0x5a, 0x90, 0]).toString('base64') } });
    expect((exe.json() as { results: { status: string; reason: string }[] }).results[0]).toMatchObject({ status: 'rejected' });
    const [file] = await ctx.owner.client<{ storage_key: string | null }[]>`select storage_key from invoice_import_files where batch_id = ${batchId}::uuid`;
    expect(file?.storage_key).toBeNull();
  });
});
