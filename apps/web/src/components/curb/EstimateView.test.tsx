// CP-058 / ADD-049-QA: non-binding curb estimates carry a non-dismissible PRELIMINARY / BUDGETARY
// banner, show low/base/high, and list unknowns separately (never priced as zero).
import type { Estimate } from '@fieldline/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EstimateView } from './EstimateView';

afterEach(cleanup);

const scenario = (total: number) => ({
  directMinor: total - 1000,
  subtotalMinor: total,
  taxMinor: 0,
  totalMinor: total,
  lines: [{ code: 'saw_cut', costComponent: 'labor', label: 'Saw cut', quantity: 12, unit: 'm', unitRate: '10.00', amountMinor: total, quantitySource: ['cut_length'] }],
});

function estimate(isBinding: boolean): Estimate {
  return {
    id: 'e1',
    number: 'E-1',
    status: isBinding ? 'approved' : 'review_required',
    stale: null,
    currentRevision: {
      id: 'r1',
      revisionNumber: 1,
      currency: 'USD',
      isBinding,
      quoteKind: isBinding ? 'firm' : 'budgetary_range',
      scenarios: { low: scenario(100000), base: scenario(120000), high: scenario(150000) },
      inputs: { cut_length: { state: 'known', value: 12, unit: 'm', source: 'field_verified' }, cut_depth: { state: 'unknown' } },
      gating: { blockers: [{ code: 'permit_required', message: 'Permit not issued' }], warnings: [], requiredSignoffs: [] },
      assumptions: [],
    },
  } as unknown as Estimate;
}

describe('EstimateView', () => {
  it('CP-058 shows a banner with no dismiss control when not binding', () => {
    render(<EstimateView estimate={estimate(false)} />);
    const banner = screen.getAllByText(/not a binding quote/i)[0];
    expect(banner).toBeTruthy();
    expect(screen.queryByRole('button', { name: /dismiss|close/i })).toBeNull();
    const range = screen.getByLabelText('Price range');
    expect(within(range).getByText('Low')).toBeTruthy();
    expect(within(range).getByText('High')).toBeTruthy();
    expect(screen.getByText(/Unknowns \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Cut depth: not priced/)).toBeTruthy();
    expect(screen.getByText(/Permit not issued/)).toBeTruthy();
  });

  it('CP-058 hides the banner for a binding firm quote', () => {
    render(<EstimateView estimate={estimate(true)} />);
    expect(screen.queryAllByText(/not a binding quote/i)).toHaveLength(0);
  });
});
