import { describe, expect, it } from 'vitest';
import { landReportFixture } from '../fixtures';
import { collectText, documentFor, renderToBuffer } from '../index';

describe('land scout due-diligence report PDF', () => {
  it('renders the parcel, score and honest unknowns', async () => {
    const text = collectText(documentFor(landReportFixture));
    expect(text).toContain('Land Scout due-diligence report');
    expect(text).toContain('LIBERTY VENTURE I HOLDINGS LLC');
    expect(text).toContain('Land score: 100 / 100 (3 of 4 factors scored)');
    expect(text).toContain('Not scored');
    expect(text).toContain('No CAD land value published');
    const pdf = await renderToBuffer(landReportFixture);
    expect(pdf.pageCount).toBeGreaterThan(0);
    expect(pdf.sha256).toHaveLength(64);
  });
});
