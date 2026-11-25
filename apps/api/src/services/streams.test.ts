import { describe, expect, it, vi } from 'vitest';
import {
  NHD_FLOWLINE_URL,
  lookupSiteStreams,
  parseNhdFlowlines,
  type SiteStreamsRequest,
} from './streams';

const REQ: SiteStreamsRequest = { lat: 32.78, lon: -96.8, widthFt: 400, depthFt: 320 };

type NhdFeature = {
  attributes: Record<string, unknown>;
  geometry: { paths: number[][][] };
};

/** NHD answer modeled on the live Dallas query: Turtle Creek named, one unnamed segment. */
function nhdAnswer(): { features: NhdFeature[] } {
  return {
    features: [
      {
        attributes: { gnis_name: 'Turtle Creek', ftype: 460, fcode: 46006 },
        geometry: {
          paths: [
            [
              [-96.8005, 32.7802],
              [-96.7995, 32.7798],
            ],
          ],
        },
      },
      {
        attributes: { gnis_name: ' ', ftype: 558, fcode: 55800 },
        geometry: {
          paths: [
            [
              [-96.801, 32.779],
              [-96.799, 32.779],
            ],
          ],
        },
      },
    ],
  };
}

describe('site streams', () => {
  it('parses NHD flowlines into named crossings in parcel feet', () => {
    const parsed = parseNhdFlowlines(nhdAnswer(), REQ);
    expect(parsed).not.toBeNull();
    expect(parsed!.truncated).toBe(false);
    expect(parsed!.crossings).toHaveLength(2);
    const creek = parsed!.crossings[0]!;
    expect(creek.name).toBe('Turtle Creek');
    expect(creek.type).toBe('stream');
    // Center-ish point lands near the middle of the 400x320 parcel.
    const pt = creek.paths[0]![0]!;
    expect(pt.xFt).toBeGreaterThan(0);
    expect(pt.xFt).toBeLessThan(400);
    expect(pt.yFt).toBeGreaterThan(0);
    expect(pt.yFt).toBeLessThan(320);
    expect(parsed!.crossings[1]!.name).toBe('Unnamed waterway');
    expect(parsed!.crossings[1]!.type).toBe('waterway');
  });

  it('merges segments of the same named stream but keeps unnamed segments separate', () => {
    const answer = nhdAnswer();
    answer.features.push({
      attributes: { gnis_name: 'Turtle Creek', ftype: 460, fcode: 46006 },
      geometry: { paths: [[[-96.7998, 32.7801], [-96.7995, 32.7803]]] },
    });
    answer.features.push({
      attributes: { gnis_name: null, ftype: 460, fcode: 46003 },
      geometry: { paths: [[[-96.8003, 32.7798], [-96.7998, 32.7802]]] },
    });
    const parsed = parseNhdFlowlines(answer, REQ);
    expect(parsed!.crossings).toHaveLength(3);
    expect(parsed!.crossings[0]!.paths).toHaveLength(2);
    expect(parsed!.crossings[0]!.name).toBe('Turtle Creek');
    expect(parsed!.crossings[2]!.name).toBe('Unnamed stream');
  });

  it('classifies a canal by its NHD type and clamps geometry to the parcel', () => {
    const parsed = parseNhdFlowlines(
      {
        features: [
          {
            attributes: { gnis_name: null, ftype: 336, fcode: 33600 },
            geometry: {
              // Starts far outside the parcel and runs through it: clamping keeps the crossing.
              paths: [[[-97.5, 32.78], [-96.8, 32.78]]],
            },
          },
        ],
      },
      REQ,
    );
    expect(parsed!.crossings).toHaveLength(1);
    expect(parsed!.crossings[0]!.name).toBe('Unnamed canal');
    expect(parsed!.crossings[0]!.type).toBe('canal');
    const pts = parsed!.crossings[0]!.paths[0]!;
    expect(pts.every((p) => p.xFt >= 0 && p.xFt <= 400 && p.yFt >= 0 && p.yFt <= 320)).toBe(true);
  });

  it('queries the fixed NHD flowline layer and returns found crossings', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url.startsWith(NHD_FLOWLINE_URL)).toBe(true);
      expect(url).toContain('geometryType=esriGeometryEnvelope');
      expect(url).toContain('outSR=4326');
      expect(url).toContain('GNIS_NAME');
      return new Response(JSON.stringify(nhdAnswer()));
    });
    const out = await lookupSiteStreams(
      REQ,
      fetcher as unknown as typeof fetch,
      Date.parse('2026-11-24T18:00:00Z'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('found');
    expect(out.crossings).toHaveLength(2);
    expect(out.source).toMatch(/National Hydrography Dataset/);
    expect(out.checkedAt).toBe('2026-11-24T18:00:00.000Z');
    expect(out.message).toMatch(/surveyor\/engineer/);
  });

  it('says no mapped waterways instead of inventing a clear verdict', async () => {
    const out = await lookupSiteStreams(
      REQ,
      vi.fn(async () => new Response(JSON.stringify({ features: [] }))) as unknown as typeof fetch,
      1_000,
    );
    expect(out.status).toBe('empty');
    expect(out.crossings).toEqual([]);
    expect(out.message).toBe('No mapped waterways in this parcel.');
  });

  it('says so with the real reason when NHD does not answer', async () => {
    const out = await lookupSiteStreams(
      REQ,
      vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch,
      1_000,
    );
    expect(out.status).toBe('upstream_unavailable');
    expect(out.crossings).toEqual([]);
    expect(out.message).toMatch(/HTTP 503/);
    expect(out.message).toMatch(/unknown for this parcel/);
  });

  it('says so when NHD answers in a form it cannot read', async () => {
    const out = await lookupSiteStreams(
      REQ,
      vi.fn(async () => new Response(JSON.stringify({ nope: true }))) as unknown as typeof fetch,
      1_000,
    );
    expect(out.status).toBe('upstream_unavailable');
    expect(out.crossings).toEqual([]);
  });
});
