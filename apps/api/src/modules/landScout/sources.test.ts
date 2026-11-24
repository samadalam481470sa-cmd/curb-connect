import { describe, expect, it } from 'vitest';
import {
  haversineMiles,
  nearestRailroad,
  normalizeCollinParcel,
  normalizeDallasParcel,
  pointToPathMiles,
} from './sources';

describe('normalizeCollinParcel', () => {
  it('maps a real CCAD feature (values unpublished stay null)', () => {
    const p = normalizeCollinParcel({
      attributes: {
        propID: 46,
        geoID: 'R-0003-00A-0010-1',
        propUseCode: 'OCCLR1-3',
        landTypeCode: 'F3',
        situsConcat: '2300 W PLANO PKWY , PLANO, TX 75075',
        situsCity: 'PLANO',
        situsZip: '75075',
        ownerName: 'LIBERTY VENTURE I HOLDINGS LLC',
        ownerAddrLine1: '1800 WAZEE ST STE 500',
        ownerAddrCity: 'DENVER',
        ownerAddrState: 'CO',
        ownerAddrZip: '80202-2526',
        landSizeAcres: 64.414,
        currValYear: null,
        currValLand: null,
        currValMarket: null,
        dataDate: '2026-10-23T00:48:47.553',
      },
      centroid: { x: -96.7398753130559, y: 33.00593348227691 },
    });
    expect(p?.parcelId).toBe('46');
    expect(p?.ownerName).toContain('LIBERTY');
    expect(p?.ownerMailing).toContain('DENVER CO 80202-2526');
    expect(p?.acres).toBe(64.414);
    expect(p?.landValue).toBeNull();
    expect(p?.lat).toBeCloseTo(33.0059, 3);
    expect(p?.vintage).toContain('2026-10-23');
  });
  it('drops features without an id and out-of-Texas centroids', () => {
    expect(normalizeCollinParcel({ attributes: {}, centroid: {} })).toBeNull();
    const p = normalizeCollinParcel({
      attributes: { propID: 7 },
      centroid: { x: -0.12, y: 51.5 },
    });
    expect(p?.lat).toBeNull();
    expect(p?.lon).toBeNull();
  });
});

describe('normalizeDallasParcel', () => {
  it('maps a DallasTaxParcels feature with its 2019 vintage label', () => {
    const p = normalizeDallasParcel({
      attributes: {
        ACCT: '00RAYHUBBARD0GS00',
        TAXPANAME1: 'DALLAS CITY OF',
        TAXPAADD1: 'ROOM 2B SOUTH',
        TAXPACITY: 'DALLAS',
        TAXPASTA: 'TEXAS',
        TAXPAZIP: '752016318',
        ST_NUM: '9999',
        ST_NAME: 'NO NAME ST',
        CITY: 'DALLAS',
        AREA_FEET: 897120.779,
        APPRAISALYEAR: 2019,
        PROP_CL: 'COMMERCIAL - VACANT PLOTTED LOTS/TRACTS',
      },
      centroid: { x: -96.51841242945268, y: 32.950634174729224 },
    });
    expect(p?.acres).toBeCloseTo(20.59, 1);
    expect(p?.vintage).toContain('2019');
    expect(p?.landValue).toBeNull();
  });
  it('drops MULTIPLE placeholder rows', () => {
    expect(normalizeDallasParcel({ attributes: { ACCT: 'MULTIPLE' }, centroid: {} })).toBeNull();
  });
});

describe('distance math', () => {
  it('haversineMiles is sane for DFW points', () => {
    // Plano parcel to a Richardson substation ~3.1 mi.
    expect(haversineMiles(33.0059, -96.7399, 32.9675, -96.7154)).toBeCloseTo(3.1, 0);
  });
  it('pointToPathMiles measures to the nearest segment', () => {
    const path: [number, number][] = [
      [-96.75, 33.0],
      [-96.73, 33.0],
    ];
    // Point 0.01 deg north of the segment midpoint ≈ 0.69 mi.
    expect(pointToPathMiles(33.01, -96.74, path)).toBeCloseTo(0.69, 1);
    expect(pointToPathMiles(33.0, -96.74, path)).toBeCloseTo(0, 2);
  });
});

describe('nearestRailroad', () => {
  const railFeature = {
    attributes: { RR_ABRVN: 'UP', RR_COMPANY: 'Union Pacific', RR_STATUS: 'Active' },
    geometry: { paths: [[[-96.8, 32.78], [-96.79, 32.78]]] },
  };
  const mockFetch = (features: unknown[]) => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        text: async () => JSON.stringify({ features }),
      };
    }) as unknown as typeof fetch;
    return { fetchImpl, seen };
  };

  it('measures to the nearest active freight line and names the railroad', async () => {
    const { fetchImpl, seen } = mockFetch([railFeature]);
    const hit = await nearestRailroad(32.78, -96.81, fetchImpl);
    expect(hit?.miles).toBeCloseTo(0.58, 1);
    expect(hit?.name).toBe('Union Pacific (UP)');
    // The query asks only for active lines and excludes passenger light rail.
    // (+ is a space in the query string, so decode it before matching.)
    const query = decodeURIComponent(seen[0]!).replace(/\+/g, ' ');
    expect(query).toContain("RR_STATUS = 'Active'");
    expect(query).toContain("RR_ABRVN <> 'DART'");
    expect(query).toContain("RR_ABRVN <> 'TRE'");
  });
  it('returns null when no rail line is nearby', async () => {
    const { fetchImpl } = mockFetch([]);
    await expect(nearestRailroad(32.78, -96.81, fetchImpl)).resolves.toBeNull();
  });
});
