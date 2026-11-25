import { describe, expect, it } from 'vitest';
import { conceptSitePlanFixture } from '../fixtures';
import { collectText, documentFor, renderToBuffer } from '../index';

describe('concept site plan PDF', () => {
  it('renders the concept sheet with its labels and disclaimers', async () => {
    const text = collectText(documentFor(conceptSitePlanFixture));
    expect(text).toContain('Concept for Discussion');
    expect(text).toContain('not a survey, plat or zoning approval');
    expect(text).toContain('Sample Meadow 4 lots');
    expect(text).toContain('4 (3 pass the entered rules)');
    expect(text).toContain('Breaks a rule');
    expect(text).toContain('Break-even price per lot (estimate)');
    const pdf = await renderToBuffer(conceptSitePlanFixture);
    expect(pdf.pageCount).toBeGreaterThan(0);
    expect(pdf.sha256).toHaveLength(64);
  });

  it('renders an empty lot plan without crashing', async () => {
    const empty = { ...conceptSitePlanFixture, lots: [] };
    const pdf = await renderToBuffer(empty);
    expect(pdf.pageCount).toBeGreaterThan(0);
  });
});
