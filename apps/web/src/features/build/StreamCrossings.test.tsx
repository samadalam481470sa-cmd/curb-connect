import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StreamCrossings, type SiteStreamsResponse } from './StreamCrossings';

const PARCEL = { widthFt: 400, depthFt: 320 };

function found(): SiteStreamsResponse {
  return {
    status: 'found',
    message: '2 mapped waterways cross this parcel (USGS NHD).',
    crossings: [
      {
        name: 'Turtle Creek',
        type: 'stream',
        paths: [
          [
            { xFt: 100, yFt: 100 },
            { xFt: 200, yFt: 200 },
          ],
        ],
      },
      { name: 'Unnamed waterway', type: 'waterway', paths: [] },
    ],
    source: 'USGS National Hydrography Dataset (NHD), The National Map',
    sourceUrl: 'https://www.usgs.gov/national-hydrography/national-hydrography-dataset',
    checkedAt: '2026-11-24T18:00:00.000Z',
  };
}

describe('StreamCrossings', () => {
  it('lists each crossing with the surveyor flag', () => {
    render(<StreamCrossings parcel={PARCEL} streams={found()} />);
    expect(screen.getByText('Turtle Creek')).toBeTruthy();
    expect(screen.getByText('Unnamed waterway')).toBeTruthy();
    expect(
      screen.getAllByText('Stream crossing — verify with surveyor/engineer'),
    ).toHaveLength(2);
    expect(screen.getByText(/USGS National Hydrography Dataset/)).toBeTruthy();
  });

  it('draws the crossing geometry on the parcel outline', () => {
    const { container } = render(<StreamCrossings parcel={PARCEL} streams={found()} />);
    const lines = container.querySelectorAll('polyline');
    expect(lines).toHaveLength(1);
    // yFt 100 -> SVG y 220 (depth 320, flipped); yFt 200 -> SVG y 120.
    expect(lines[0]!.getAttribute('points')).toBe('100.0,220.0 200.0,120.0');
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('says no mapped waterways instead of calling the parcel clear', () => {
    render(
      <StreamCrossings
        parcel={PARCEL}
        streams={{ ...found(), status: 'empty', message: 'No mapped waterways in this parcel.', crossings: [] }}
      />,
    );
    expect(screen.getByText(/No mapped waterways in this parcel/)).toBeTruthy();
    expect(screen.queryByText('Stream crossing — verify with surveyor/engineer')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the real reason when NHD did not answer', () => {
    render(
      <StreamCrossings
        parcel={PARCEL}
        streams={{
          ...found(),
          status: 'upstream_unavailable',
          message: 'The USGS National Hydrography Dataset did not answer (HTTP 503).',
          crossings: [],
        }}
      />,
    );
    expect(screen.getByText(/did not answer \(HTTP 503\)/)).toBeTruthy();
  });

  it('asks for a pull before anything has been checked', () => {
    render(<StreamCrossings parcel={PARCEL} streams={null} />);
    expect(screen.getByText(/Pull real ground heights to check/)).toBeTruthy();
  });

  it('shows a loading state while checking', () => {
    render(<StreamCrossings parcel={PARCEL} streams={null} loading />);
    expect(screen.getByText(/Checking the USGS National Hydrography Dataset/)).toBeTruthy();
  });
});
