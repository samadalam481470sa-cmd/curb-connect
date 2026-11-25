import { describe, expect, it } from 'vitest';
import { cellText, filterRows, identifyRows, sortRows } from './attributeTable';
import type { GisFeature } from './layers';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'acres', label: 'Acres', numeric: true, format: 'acres' as const },
  { key: 'value', label: 'Value', numeric: true, format: 'money' as const },
  { key: 'issued', label: 'Issued', format: 'date' as const },
];

const feature = (id: string, properties: Record<string, unknown>): GisFeature => ({
  id,
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties,
});

const rows = [
  feature('a', { name: 'Zulu', acres: 2.5, value: 100, issued: '2026-11-20T00:00:00.000Z' }),
  feature('b', { name: 'Alpha', acres: null, value: 500, issued: null }),
  feature('c', { name: 'Mike', acres: 10, value: null, issued: '2026-11-01T00:00:00.000Z' }),
];

describe('cellText', () => {
  it('formats money, acres, dates; missing stays visibly missing', () => {
    expect(cellText(123456, columns[2]!)).toBe('$123,456');
    expect(cellText(2.5, columns[1]!)).toBe('2.5 ac');
    expect(cellText('2026-11-20T00:00:00.000Z', columns[3]!)).toBe('2026-11-20');
    expect(cellText(null, columns[0]!)).toBe('—');
    expect(cellText('', columns[0]!)).toBe('—');
    expect(cellText(true, columns[0]!)).toBe('Yes');
  });
});

describe('sortRows', () => {
  it('sorts numbers numerically with missing values last in both directions', () => {
    const asc = sortRows(rows, { key: 'acres', direction: 'asc' }, columns).map((r) => r.id);
    expect(asc).toEqual(['a', 'c', 'b']);
    const desc = sortRows(rows, { key: 'acres', direction: 'desc' }, columns).map((r) => r.id);
    expect(desc).toEqual(['c', 'a', 'b']);
  });

  it('sorts text alphabetically', () => {
    const asc = sortRows(rows, { key: 'name', direction: 'asc' }, columns).map((r) => r.id);
    expect(asc).toEqual(['b', 'c', 'a']);
  });
});

describe('filterRows', () => {
  it('matches visible cell text case-insensitively', () => {
    expect(filterRows(rows, 'zulu', columns).map((r) => r.id)).toEqual(['a']);
    expect(filterRows(rows, '10 ac', columns).map((r) => r.id)).toEqual(['c']);
    expect(filterRows(rows, '', columns)).toHaveLength(3);
    expect(filterRows(rows, 'nope', columns)).toEqual([]);
  });
});

describe('identifyRows', () => {
  it('lists every column in order', () => {
    expect(identifyRows(rows[1]!, columns)).toEqual([
      { label: 'Name', value: 'Alpha' },
      { label: 'Acres', value: '—' },
      { label: 'Value', value: '$500' },
      { label: 'Issued', value: '—' },
    ]);
  });
});
