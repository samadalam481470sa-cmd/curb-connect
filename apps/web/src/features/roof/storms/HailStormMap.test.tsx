import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { HailStormMap } from './HailStormMap';
import type { Swath } from './api';

const get = vi.hoisted(() => vi.fn());
const sources = vi.hoisted(() => new Map<string, { setData: ReturnType<typeof vi.fn> }>());
const setPaintProperty = vi.hoisted(() => vi.fn());
const setLayoutProperty = vi.hoisted(() => vi.fn());
const fitBounds = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/session', () => ({ useApi: () => ({ api: { get } }) }));
vi.mock('maplibre-gl', () => {
  class FakeMap {
    private canvas = { style: { cursor: '' } };
    constructor(_options: unknown) {
      void _options;
    }
    on(event: string, _layerOrCallback: unknown, maybeCallback?: () => void) {
      if (event === 'load') {
        const callback = maybeCallback ?? (_layerOrCallback as () => void);
        queueMicrotask(callback);
      }
    }
    addControl() {}
    addSource(id: string) {
      sources.set(id, { setData: vi.fn() });
    }
    getSource(id: string) {
      return sources.get(id);
    }
    addLayer() {}
    setPaintProperty(...args: unknown[]) {
      setPaintProperty(...args);
    }
    setLayoutProperty(...args: unknown[]) {
      setLayoutProperty(...args);
    }
    fitBounds(...args: unknown[]) {
      fitBounds(...args);
    }
    flyTo() {}
    getCanvas() {
      return this.canvas;
    }
    remove() {}
  }
  return {
    Map: FakeMap,
    NavigationControl: class {},
    ScaleControl: class {},
    setWorkerUrl: vi.fn(),
    getVersion: () => '6.0.0',
  };
});

function swathPayload(overrides: Partial<Swath> = {}): Swath {
  return {
    status: 'ok',
    kind: 'mrms_swath',
    source: 'NOAA MRMS MESH Max 1440min',
    checkedAt: '2026-11-24T19:00:00.000Z',
    date: '2026-11-24',
    thresholdIn: 1,
    swath: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-97.0, 32.7],
                [-96.9, 32.7],
                [-96.9, 32.8],
                [-97.0, 32.8],
                [-97.0, 32.7],
              ],
            ],
          },
          properties: { maxHailIn: 1.75 },
        },
      ],
    },
    eventCount: 3,
    message: '',
    note: 'Estimated hail size, not confirmed damage',
    ...overrides,
  };
}

function renderMap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <HailStormMap events={[]} selectedId={null} onSelect={vi.fn()} />,
    { wrapper },
  );
}

beforeEach(() => {
  get.mockReset();
  sources.clear();
  setPaintProperty.mockClear();
  setLayoutProperty.mockClear();
  fitBounds.mockClear();
  get.mockResolvedValue(swathPayload());
});

describe('HailStormMap swath layer', () => {
  it('draws the measured swath over the imagery with a solid outline and the endpoint note verbatim', async () => {
    renderMap();
    await screen.findByText(/Estimated hail size, not confirmed damage/);
    await waitFor(() =>
      expect(sources.get('swath')?.setData).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FeatureCollection',
          features: expect.arrayContaining([
            expect.objectContaining({
              geometry: expect.objectContaining({ type: 'Polygon' }),
            }),
          ]),
        }),
      ),
    );
    expect(setPaintProperty).toHaveBeenCalledWith(
      'swath-fill',
      'fill-opacity',
      0.35,
    );
    expect(setLayoutProperty).toHaveBeenCalledWith(
      'swath-line',
      'visibility',
      'visible',
    );
    expect(setLayoutProperty).toHaveBeenCalledWith(
      'swath-line-dashed',
      'visibility',
      'none',
    );
    expect(screen.queryByText(/Approximate path/)).toBeNull();
    expect(
      screen.getByText(/NOAA MRMS MESH Max 1440min/),
    ).toBeTruthy();
  });

  it('draws an approximate path dashed with a visible approximate tag', async () => {
    get.mockResolvedValue(
      swathPayload({
        kind: 'approximate_path',
        source: 'NOAA Storm Prediction Center',
        note: 'Approximate path from NOAA storm reports — not a measured swath',
      }),
    );
    renderMap();
    await screen.findByText(/Approximate path —/);
    expect(
      screen.getByText(
        /Approximate path from NOAA storm reports — not a measured swath/,
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(setLayoutProperty).toHaveBeenCalledWith(
        'swath-line-dashed',
        'visibility',
        'visible',
      ),
    );
    expect(setLayoutProperty).toHaveBeenCalledWith(
      'swath-line',
      'visibility',
      'none',
    );
    expect(setPaintProperty).toHaveBeenCalledWith(
      'swath-fill',
      'fill-opacity',
      0.15,
    );
  });

  it('draws nothing and says so when the swath is empty', async () => {
    get.mockResolvedValue(
      swathPayload({
        swath: { type: 'FeatureCollection', features: [] },
        eventCount: 0,
      }),
    );
    renderMap();
    await screen.findByText(/No hail swath for the selected period/);
    await waitFor(() =>
      expect(sources.get('swath')?.setData).toHaveBeenCalledWith(
        expect.objectContaining({ features: [] }),
      ),
    );
  });
});
