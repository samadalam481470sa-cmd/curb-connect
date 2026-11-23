import { describe, expect, it } from 'vitest';
import {
  EMPTY_INSPECTION,
  addMarker,
  createMarker,
  escapeHtml,
  inspectionReportHtml,
  parseInspection,
  parseMoneyText,
  removeMarker,
  serializeInspection,
  summarizeInspection,
  updateMarker,
  type Inspection,
} from './inspection';

function sample(): Inspection {
  const photo = addMarker(
    addMarker(
      { id: 'p1', name: 'Front slope', markers: [] },
      createMarker({ id: 'm1', x: 0.25, y: 0.4, findingType: 'missing_shingles', priceText: '450' }),
    ),
    createMarker({
      id: 'm2',
      x: 1.4,
      y: -0.2,
      findingType: 'creased_tabs',
      result: 'monitor',
      priceText: '',
    }),
  );
  return { ...EMPTY_INSPECTION, address: '1 Main St', photos: [photo] };
}

describe('photo inspection logic', () => {
  it('clamps marker positions to the photo', () => {
    const m = createMarker({ x: 2, y: -1 });
    expect(m.x).toBe(1);
    expect(m.y).toBe(0);
  });

  it('adds, updates and removes markers without mutating the photo', () => {
    const base = { id: 'p1', name: 'A', markers: [] };
    const withOne = addMarker(base, createMarker({ id: 'm1', x: 0.1, y: 0.2 }));
    expect(base.markers).toHaveLength(0);
    const updated = updateMarker(withOne, 'm1', { note: 'Near ridge', x: 5 });
    expect(updated.markers[0]?.note).toBe('Near ridge');
    expect(updated.markers[0]?.x).toBe(1);
    expect(removeMarker(updated, 'm1').markers).toHaveLength(0);
  });

  it('parses money text: blank is missing, invalid is NaN, zero is no charge', () => {
    expect(parseMoneyText('')).toBeNull();
    expect(parseMoneyText('$1,250.50')).toBe(125050);
    expect(parseMoneyText('0')).toBe(0);
    expect(Number.isNaN(parseMoneyText('abc') as number)).toBe(true);
  });

  it('summarizes counts, overall result and priced total', () => {
    const s = summarizeInspection(sample());
    expect(s.totalMarkers).toBe(2);
    expect(s.failCount).toBe(1);
    expect(s.monitorCount).toBe(1);
    expect(s.overall).toBe('fail');
    expect(s.pricedTotalCents).toBe(45000);
    expect(s.missingPriceCount).toBe(1);
    expect(s.isFinal).toBe(false);
    expect(s.byType).toEqual([
      { id: 'missing_shingles', label: 'Missing shingles', count: 1 },
      { id: 'creased_tabs', label: 'Creased tabs', count: 1 },
    ]);
  });

  it('is final only when every marker is priced', () => {
    const priced: Inspection = {
      ...EMPTY_INSPECTION,
      photos: [
        {
          id: 'p1',
          name: 'A',
          markers: [createMarker({ id: 'm1', x: 0.5, y: 0.5, result: 'pass', priceText: '0' })],
        },
      ],
    };
    const s = summarizeInspection(priced);
    expect(s.overall).toBe('pass');
    expect(s.isFinal).toBe(true);
  });

  it('round-trips through JSON and repairs unknown values', () => {
    const parsed = parseInspection(serializeInspection(sample()));
    expect(parsed.photos[0]?.markers).toHaveLength(2);
    const repaired = parseInspection(
      JSON.stringify({
        photos: [{ id: 'p', name: 'X', markers: [{ x: 9, y: 9, findingType: 'bogus', severity: 'x', result: 'x' }] }],
      }),
    );
    expect(repaired.photos[0]?.markers[0]).toMatchObject({
      x: 1,
      y: 1,
      findingType: 'other',
      severity: 'moderate',
      result: 'fail',
    });
  });

  it('escapes HTML in the printable report and shows missing prices', () => {
    expect(escapeHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    const html = inspectionReportHtml({
      inspection: { ...sample(), customer: '<script>alert(1)</script>' },
      photoDataUrls: {},
    });
    expect(html).toContain('Overall: FAIL');
    expect(html).toContain('Price missing');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
