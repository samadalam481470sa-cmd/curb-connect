// CP-057-QA: CSV parsing and validation are strict and never import a missing price as 0.
import { describe, expect, it } from 'vitest';
import { parseCsv, validateCsv } from './service';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF and blank lines', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('validateCsv', () => {
  const header = 'code,label,category,cost_component,unit,unit_rate,fixed_amount_minor';
  it('rejects a row with no price instead of importing $0', () => {
    const { report, items } = validateCsv(`${header}\nCUT,Cut,labor,cutting,linear_ft,,`, false);
    expect(items).toHaveLength(0);
    expect(report.errors[0]).toMatchObject({ line: 2, field: 'unit_rate' });
  });
  it('requires the core columns', () => {
    const { report } = validateCsv('code,label\nA,B', false);
    expect(report.errors.map((e) => e.field)).toEqual(['category', 'cost_component', 'unit']);
  });
  it('accepts a clean row and warns about missing provenance', () => {
    const { report, items } = validateCsv(`${header}\ncut_1,Cut,labor,cutting,linear_ft,20.5,`, false);
    expect(report.errors).toEqual([]);
    expect(items[0]).toMatchObject({ code: 'CUT_1', unitRate: '20.5', source: 'csv_import', taxable: true });
    expect(report.warnings.map((w) => w.field)).toEqual(['source', 'price_date']);
  });
});
