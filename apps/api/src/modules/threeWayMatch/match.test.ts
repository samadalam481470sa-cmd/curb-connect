import { describe, expect, it } from 'vitest';
import { evaluateMatch, findDuplicates, type MatchInput } from './match';

const base: MatchInput = {
  poLines: [
    { lineIndex: 0, label: 'Studs', orderedQty: 100, unitPriceMinor: 475 },
    { lineIndex: 1, label: 'OSB', orderedQty: 20, unitPriceMinor: 1200 },
  ],
  receipts: [
    { lineIndex: 0, receivedQty: 100 },
    { lineIndex: 1, receivedQty: 20 },
  ],
  billedLines: [
    { lineIndex: 0, billedQty: 100, billedUnitPriceMinor: 475 },
    { lineIndex: 1, billedQty: 20, billedUnitPriceMinor: 1200 },
  ],
  billedTaxMinor: 0,
  billedFreightMinor: 0,
  invoiceAmountMinor: 100 * 475 + 20 * 1200,
  poSupplierName: 'Lumber Yard Inc',
  billedVendorName: 'Lumber Yard Inc',
  apCostCode: '06-100',
  billedCostCode: '06-100',
};

describe('evaluateMatch', () => {
  it('clean three-way match', () => {
    const r = evaluateMatch(base);
    expect(r.status).toBe('matched');
    expect(r.amountMatchesInvoice).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('billed more than received -> quantity_variance', () => {
    const r = evaluateMatch({
      ...base,
      receipts: [{ lineIndex: 0, receivedQty: 80 }, { lineIndex: 1, receivedQty: 20 }],
    });
    expect(r.status).toBe('quantity_variance');
    expect(r.lines[0]?.quantityOk).toBe(false);
  });

  it('partial receipts accumulate across multiple receipts', () => {
    const r = evaluateMatch({
      ...base,
      receipts: [
        { lineIndex: 0, receivedQty: 60 },
        { lineIndex: 0, receivedQty: 40 },
        { lineIndex: 1, receivedQty: 20 },
      ],
    });
    expect(r.status).toBe('matched');
    expect(r.lines[0]?.receivedQty).toBe(100);
  });

  it('unit price differs -> price_variance', () => {
    const r = evaluateMatch({
      ...base,
      billedLines: [
        { lineIndex: 0, billedQty: 100, billedUnitPriceMinor: 500 },
        { lineIndex: 1, billedQty: 20, billedUnitPriceMinor: 1200 },
      ],
      invoiceAmountMinor: 100 * 500 + 20 * 1200,
    });
    expect(r.status).toBe('price_variance');
    expect(r.lines[0]?.priceOk).toBe(false);
  });

  it('tax and freight count toward the billed total', () => {
    const r = evaluateMatch({
      ...base,
      billedTaxMinor: 1000,
      billedFreightMinor: 2500,
      invoiceAmountMinor: 100 * 475 + 20 * 1200 + 3500,
    });
    expect(r.status).toBe('matched');
    expect(r.computedBilledTotalMinor).toBe(100 * 475 + 20 * 1200 + 3500);
  });

  it('amount mismatch -> price_variance with reason', () => {
    const r = evaluateMatch({ ...base, invoiceAmountMinor: base.invoiceAmountMinor + 1 });
    expect(r.status).toBe('price_variance');
    expect(r.amountMatchesInvoice).toBe(false);
  });

  it('vendor mismatch -> unmatched', () => {
    const r = evaluateMatch({ ...base, billedVendorName: 'Somebody Else LLC' });
    expect(r.status).toBe('unmatched');
    expect(r.vendorMatches).toBe(false);
  });

  it('missing PO price cannot verify -> unmatched, never assumed', () => {
    const r = evaluateMatch({
      ...base,
      poLines: [
        { lineIndex: 0, label: 'Studs', orderedQty: 100, unitPriceMinor: null },
        { lineIndex: 1, label: 'OSB', orderedQty: 20, unitPriceMinor: 1200 },
      ],
    });
    expect(r.status).toBe('unmatched');
    expect(r.lines[0]?.priceOk).toBeNull();
  });

  it('nothing billed yet matches trivially only when amounts agree at zero', () => {
    const r = evaluateMatch({ ...base, billedLines: [], invoiceAmountMinor: 0 });
    expect(r.status).toBe('matched');
  });
});

describe('findDuplicates', () => {
  const invs = [
    { id: 'a', vendorName: 'Lumber Yard Inc', invoiceNumber: 'INV-1', amountMinor: 5000 },
    { id: 'b', vendorName: 'lumber yard inc', invoiceNumber: 'inv-1', amountMinor: 5000 },
    { id: 'c', vendorName: 'Lumber Yard Inc', invoiceNumber: 'INV-2', amountMinor: 5000 },
    { id: 'd', vendorName: 'Lumber Yard Inc', invoiceNumber: null, amountMinor: 5000 },
  ];
  it('finds same vendor + number + amount (case-insensitive)', () => {
    const dupes = findDuplicates(invs, invs[0]!);
    expect(dupes.map((d) => d.id)).toEqual(['b']);
  });
  it('no invoice number -> no duplicates claimed', () => {
    expect(findDuplicates(invs, invs[3]!)).toEqual([]);
  });
});
