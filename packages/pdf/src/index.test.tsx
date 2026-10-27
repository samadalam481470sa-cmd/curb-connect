import { describe, expect, it } from 'vitest';
import {
  curbEstimateFixture,
  invoiceFixture,
  proposalFixture,
  roofReportFixture,
  signatureCertificateFixture,
} from './fixtures';
import {
  PDF_TEMPLATES_VERSION,
  collectText,
  documentFor,
  formatArea,
  formatMoney,
  renderToBuffer,
  structureTotals,
  type AnySnapshot,
} from './index';

const cases: Array<[string, AnySnapshot, string[]]> = [
  [
    'roof report',
    roofReportFixture,
    [
      'RPT-2026-000123',
      'Imagery not licensed for export — vector diagram shown',
      'Whole-property totals',
      'Pitch table',
      'Edge category totals',
      'Exclusions',
      'Methodology',
      'Approval',
      'Measured',
      'Estimated',
    ],
  ],
  [
    'curb estimate',
    curbEstimateFixture,
    [
      'PRELIMINARY — BUDGETARY RANGE, NOT A BINDING QUOTE',
      '$3,744.00',
      '$5,491.20',
      '$4,700.00',
      '$6,800.00',
      'Municipal permit',
      'Buried curb depth',
      'PH-1',
    ],
  ],
  [
    'proposal',
    proposalFixture,
    ['Standard (selected)', '$14,500.00', '$19,800.00', 'Valid until', '30% deposit at signing'],
  ],
  ['invoice', invoiceFixture, ['INV-2026-000777', '$14,500.00', '$10,150.00', 'Balance due']],
  [
    'signature certificate',
    signatureCertificateFixture,
    ['ENV-abc123', 'a3f1c2d4e5b6', 'Pat Example', 'signed'],
  ],
];

describe('templates', () => {
  it.each(cases)('%s renders pages and contains key text', async (_name, snapshot, expected) => {
    const result = await renderToBuffer(snapshot);
    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.templateVersion).toBe(PDF_TEMPLATES_VERSION);
    const text = collectText(documentFor(snapshot));
    for (const e of expected) expect(text).toContain(e);
  });

  it.each(cases)('%s is byte-for-byte deterministic across renders', async (_name, snapshot) => {
    const a = await renderToBuffer(snapshot);
    const b = await renderToBuffer(structuredClone(snapshot));
    expect(b.sha256).toBe(a.sha256);
    expect(b.contentChecksum).toBe(a.contentChecksum);
  });

  it('content checksum ignores key order but changes with content', async () => {
    const a = await renderToBuffer(invoiceFixture);
    const reordered = Object.fromEntries(
      Object.entries(invoiceFixture).reverse(),
    ) as typeof invoiceFixture;
    const b = await renderToBuffer(reordered);
    expect(b.contentChecksum).toBe(a.contentChecksum);
    const c = await renderToBuffer({
      ...invoiceFixture,
      balanceDue: { amountMinor: 1, currency: 'USD' },
    });
    expect(c.contentChecksum).not.toBe(a.contentChecksum);
    expect(c.sha256).not.toBe(a.sha256);
  });
});

describe('safety rules', () => {
  it('never prints a binding curb quote while a gate is open, even if binding is set', () => {
    const text = collectText(documentFor({ ...curbEstimateFixture, binding: true }));
    expect(text).toContain('NOT A BINDING QUOTE');
  });

  it('prints a binding price when all gates are clear and nothing is unknown', () => {
    const text = collectText(
      documentFor({
        ...curbEstimateFixture,
        binding: true,
        unknowns: [],
        gates: curbEstimateFixture.gates.map((g) => ({ ...g, status: 'satisfied' as const })),
      }),
    );
    expect(text).not.toContain('NOT A BINDING QUOTE');
    expect(text).toContain('Selling price');
  });

  it('labels a budgetary proposal and shows licensed imagery attribution when allowed', () => {
    expect(collectText(documentFor({ ...proposalFixture, budgetary: true }))).toContain(
      'BUDGETARY PROPOSAL',
    );
    const text = collectText(
      documentFor({
        ...roofReportFixture,
        imagery: {
          ...roofReportFixture.imagery,
          exportAllowed: true,
          attribution: 'Imagery © Sample Imagery Ltd 2026',
        },
      }),
    );
    expect(text).toContain('Imagery © Sample Imagery Ltd 2026');
    expect(text).not.toContain('not licensed for export');
  });

  it('roof totals reconcile with facet sums (waste not applied to totals)', () => {
    const t = structureTotals(roofReportFixture.structures);
    expect(t.planAreaSqM).toBe(90);
    expect(t.slopedAreaSqM).toBeCloseTo(60 * Math.sqrt(1.25) + 30, 9);
    expect(collectText(documentFor(roofReportFixture))).toContain(
      formatArea(t.slopedAreaSqM, 'imperial'),
    );
  });

  it('formats money from integer minor units', () => {
    expect(formatMoney({ amountMinor: 549120, currency: 'USD' })).toBe('$5,491.20');
    expect(formatMoney({ amountMinor: -5, currency: 'USD' })).toBe('-$0.05');
    expect(formatMoney({ amountMinor: 1200, currency: 'JPY' })).toBe('1,200 JPY');
  });
});
