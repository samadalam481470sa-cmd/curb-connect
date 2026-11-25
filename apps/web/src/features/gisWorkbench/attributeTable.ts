// Attribute table logic for the GIS Workbench: sort + filter + cell formatting over the active
// layer's features. Pure functions so the table behavior is unit-testable. Nulls are never
// zero-filled: a missing value renders as "—" and sorts last in both directions.

import type { AttributeColumn, GisFeature } from './layers';

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  key: string;
  direction: SortDirection;
}

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Formats one attribute cell. Missing values stay visibly missing. */
export function cellText(value: unknown, column: AttributeColumn): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    switch (column.format) {
      case 'money':
        return MONEY.format(value);
      case 'acres':
        return `${NUMBER.format(value)} ac`;
      case 'sqft':
        return `${Math.round(value).toLocaleString('en-US')} sq ft`;
      default:
        return NUMBER.format(value);
    }
  }
  if (column.format === 'date' && typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return String(value);
}

/**
 * Sorts features by one attribute. Numbers compare numerically, everything else as text.
 * Missing values sort last regardless of direction — a blank is unknown, not zero.
 */
export function sortRows(
  features: readonly GisFeature[],
  sort: TableSort,
  columns: readonly AttributeColumn[],
): GisFeature[] {
  const column = columns.find((c) => c.key === sort.key);
  const sign = sort.direction === 'desc' ? -1 : 1;
  const sorted = [...features];
  sorted.sort((a, b) => {
    const av = a.properties[sort.key];
    const bv = b.properties[sort.key];
    const aMissing = av === null || av === undefined || av === '';
    const bMissing = bv === null || bv === undefined || bv === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (column?.numeric && typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv)) * sign;
  });
  return sorted;
}

/**
 * Filters features by a plain-text query matched against the visible attribute cells
 * (case-insensitive). An empty query returns everything.
 */
export function filterRows(
  features: readonly GisFeature[],
  query: string,
  columns: readonly AttributeColumn[],
): GisFeature[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...features];
  return features.filter((feature) =>
    columns.some((column) => cellText(feature.properties[column.key], column).toLowerCase().includes(q)),
  );
}

/** The full identify-panel readout for one feature: every column, in order. */
export function identifyRows(
  feature: GisFeature,
  columns: readonly AttributeColumn[],
): Array<{ label: string; value: string }> {
  return columns.map((column) => ({
    label: column.label,
    value: cellText(feature.properties[column.key], column),
  }));
}
