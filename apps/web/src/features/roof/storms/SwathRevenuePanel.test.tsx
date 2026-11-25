import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { SwathRevenuePanel } from './SwathRevenuePanel';
import type { HailEvent, StormImpact } from './api';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/session', () => ({ useApi: () => ({ api: { get } }) }));

const event: HailEvent = {
  id: 'spc-2026-11-24-1',
  date: '2026-11-24',
  timeUtc: '18:30',
  magnitudeIn: 1.75,
  location: 'Dallas',
  county: 'Dallas',
  state: 'TX',
  lat: 32.7767,
  lon: -96.797,
  comments: '',
  source: 'NOAA Storm Prediction Center',
};

function impact(overrides: Partial<StormImpact> = {}): StormImpact {
  return {
    event,
    radiusMiles: 25,
    source: 'company properties',
    checkedAt: '2026-11-24T19:00:00.000Z',
    matched: [],
    matchedCount: 3,
    propertiesWithoutLocation: 0,
    revenueEstimateMinor: 1250000,
    averageJobValueMinor: 2500000,
    revenueLabel: 'Potential revenue (estimate)',
    revenueNote:
      'Estimate from matched roofs at the company average job value.',
    ...overrides,
  };
}

function renderPanel(props: { event: HailEvent | null }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SwathRevenuePanel {...props} />, { wrapper });
}

beforeEach(() => {
  get.mockReset();
});

describe('SwathRevenuePanel', () => {
  it('shows the revenue hero from the impact endpoint when revenue is present', async () => {
    get.mockResolvedValue(impact());
    renderPanel({ event });
    const hero = await screen.findByLabelText('Estimated potential revenue');
    expect(hero.textContent).toContain('$12,500.00');
    expect(screen.getByText(/3 matched roofs/)).toBeTruthy();
    expect(screen.getByText(/average job value \$25,000.00/)).toBeTruthy();
    expect(
      screen.getByText(/Estimate from matched roofs/),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('/v1/roof-storms/impact?eventId=spc-2026-11-24-1&radiusMiles=25'),
      expect.objectContaining({ schema: expect.anything() }),
    );
  });

  it('shows Insufficient data — never $0 — when there are no priced roofs', async () => {
    get.mockResolvedValue(
      impact({
        revenueEstimateMinor: null,
        averageJobValueMinor: null,
        matchedCount: 2,
        revenueNote:
          'The company has no priced roof estimates yet, so no revenue estimate can be calculated.',
      }),
    );
    renderPanel({ event });
    expect(await screen.findByText('Insufficient data')).toBeTruthy();
    expect(
      screen.getByText(/no priced roof estimates yet/),
    ).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it('prompts to pick an event and calls nothing when no event is selected', () => {
    renderPanel({ event: null });
    expect(
      screen.getByText(/Pick a hail event on the map/),
    ).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});
