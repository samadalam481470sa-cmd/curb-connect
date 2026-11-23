import { describe, expect, it } from 'vitest';
import { roofInspectionFixture } from '../fixtures';
import { collectText, documentFor, inspectionTotals, renderToBuffer } from '../index';

describe('roof photo inspection report PDF', () => {
  it('totals findings and keeps missing prices explicit', () => {
    const totals = inspectionTotals(roofInspectionFixture);
    expect(totals.totalMarkers).toBe(2);
    expect(totals.failCount).toBe(1);
    expect(totals.monitorCount).toBe(1);
    expect(totals.overall).toBe('fail');
    expect(totals.pricedTotalMinor).toBe(45000);
    expect(totals.missingPriceCount).toBe(1);
  });

  it('renders a PDF containing the findings', async () => {
    const text = collectText(documentFor(roofInspectionFixture));
    expect(text).toContain('Roof photo inspection report');
    expect(text).toContain('Missing shingles');
    expect(text).toContain('Price missing');
    const pdf = await renderToBuffer(roofInspectionFixture);
    expect(pdf.pageCount).toBeGreaterThan(0);
    expect(pdf.sha256).toHaveLength(64);
  });
});
