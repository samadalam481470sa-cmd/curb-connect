import { describe, expect, it } from 'vitest';
import { generateLayout, interiorWallLength, splitLength } from './layout';
import { MATERIAL_IDS, PRICE_BOOK, referenceUnitPrice } from './prices';
import { DETAILED_MATERIALS } from './detailedCatalog';
import { DEFAULT_SPEC, computeTakeoff, priceTakeoff, slopeFactorFor } from './takeoff';

const area = (rooms: { w: number; h: number }[]) => rooms.reduce((s, r) => s + r.w * r.h, 0);

describe('House Builder layout (HB-001)', () => {
  it('splits a length into parts that sum exactly', () => {
    const parts = splitLength(47.3, [14, 11, 11, 8, 8]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(47.3, 6);
  });

  it('rooms tile every floor of the footprint exactly', () => {
    for (const stories of [1, 2] as const) {
      const layout = generateLayout({ ...DEFAULT_SPEC, stories, bedrooms: 4, bathrooms: 3 });
      for (const floor of layout.floors) {
        expect(area(floor.rooms)).toBeCloseTo(50 * 32, 4);
        for (const r of floor.rooms) {
          expect(r.x + r.w).toBeLessThanOrEqual(50 + 1e-6);
          expect(r.y + r.h).toBeLessThanOrEqual(32 + 1e-6);
        }
      }
      expect(layout.floors).toHaveLength(stories);
    }
  });

  it('places the requested number of bedrooms and baths', () => {
    const layout = generateLayout({ ...DEFAULT_SPEC, bedrooms: 4, bathrooms: 3 });
    const rooms = layout.floors.flatMap((f) => f.rooms);
    expect(rooms.filter((r) => r.kind === 'bedroom' || r.kind === 'primary')).toHaveLength(4);
    expect(rooms.filter((r) => r.kind === 'bath')).toHaveLength(3);
  });

  it('interior wall length of a 2 × 1 grid is the single shared wall', () => {
    const rooms = [
      { id: 'a', name: 'A', kind: 'flex' as const, x: 0, y: 0, w: 10, h: 10 },
      { id: 'b', name: 'B', kind: 'flex' as const, x: 10, y: 0, w: 10, h: 10 },
    ];
    expect(interiorWallLength(rooms, 20, 10)).toBe(10);
  });

  it('swaps width and length and clamps out-of-range footprints with a warning', () => {
    const layout = generateLayout({ ...DEFAULT_SPEC, lengthFt: 30, widthFt: 200 });
    expect(layout.footprint.lengthFt).toBe(120);
    expect(layout.footprint.widthFt).toBe(30);
    expect(layout.warnings.length).toBeGreaterThan(0);
  });
});

describe('House Builder takeoff (HB-002)', () => {
  it('slope factor for 6/12 is sqrt(1.25)', () => {
    expect(slopeFactorFor(6)).toBeCloseTo(Math.sqrt(1.25), 10);
    expect(slopeFactorFor(0)).toBe(1);
  });

  it('computes slab concrete and roof squares from the footprint', () => {
    const t = computeTakeoff({ ...DEFAULT_SPEC, garage: 'none', wastePercent: 0, overhangFt: 0 });
    // 50 × 32 slab: 1600 × 4/12 = 533.3 ft³; beam 164 LF × 1.667 = 273.3 ft³ → 29.9 yd³
    expect(t.summary.concreteYd3).toBeCloseTo(29.9, 1);
    expect(t.summary.roofAreaSqFt).toBeCloseTo(1600 * Math.sqrt(1.25), 0);
    const bundles = t.lines.find((l) => l.material === 'shingle_bundle')!;
    expect(bundles.quantity).toBe(Math.ceil(t.summary.roofSquares * 3));
  });

  it('a garage adds slab, trusses and an exterior door', () => {
    const without = computeTakeoff({ ...DEFAULT_SPEC, garage: 'none' });
    const withGarage = computeTakeoff({ ...DEFAULT_SPEC, garage: 'two_car' });
    expect(withGarage.summary.slabAreaSqFt - without.summary.slabAreaSqFt).toBeCloseTo(22 * 22, 4);
    expect(withGarage.summary.exteriorDoors).toBe(without.summary.exteriorDoors + 1);
    const trusses = (t: typeof without) =>
      t.lines.find((l) => l.material === 'roof_truss')!.quantity;
    expect(trusses(withGarage)).toBeGreaterThan(trusses(without));
  });

  it('two stories add subfloor and double the conditioned area', () => {
    const t = computeTakeoff({ ...DEFAULT_SPEC, stories: 2 });
    expect(t.layout.conditionedAreaSqFt).toBe(3200);
    expect(t.lines.some((l) => l.material === 'subfloor_23_32')).toBe(true);
  });

  it('prices lines from the reference book, leaves unknown prices unpriced, and applies overrides', () => {
    const t = computeTakeoff(DEFAULT_SPEC);
    const base = priceTakeoff(t.lines);
    expect(base.total).toBeGreaterThan(0);
    // Expanded catalog is honest: unquoted trades and individual fastener cartons stay unpriced.
    expect(base.unpriced).toBeGreaterThan(200);
    const patched = priceTakeoff(t.lines, {
      vapor_barrier: { unitPrice: 50, seller: 'Test', basis: 'manual' },
    });
    expect(patched.unpriced).toBe(base.unpriced - 1);
    const vb = patched.lines.find((l) => l.material === 'vapor_barrier')!;
    expect(vb.total).toBe(vb.quantity * 50);
  });

  it('enumerates detailed supplies for every trade, including individual nail boxes', () => {
    const t = computeTakeoff(DEFAULT_SPEC);
    expect(DETAILED_MATERIALS.length).toBeGreaterThan(200);
    expect(new Set(MATERIAL_IDS).size).toBe(MATERIAL_IDS.length);
    const groups = new Set(t.lines.map(line => line.group));
    for (const group of ['Sitework', 'Foundation', 'Framing', 'Roof', 'Electrical',
      'Plumbing', 'HVAC', 'Finishes', 'Hardware', 'Exterior']) expect(groups.has(group)).toBe(true);
    for (const part of ['roof_roofing_nails', 'hardware_nails_8d', 'hardware_nails_16d',
      'electrical_loadcenter', 'plumb_pex_hot', 'hvac_system', 'finish_kitchen_cabinets']) {
      const line = t.lines.find(row => row.material === part);
      expect(line?.quantity).toBeGreaterThan(0);
      expect(line?.provisional).toBe(true);
      expect(PRICE_BOOK[part as keyof typeof PRICE_BOOK].range).toBeNull();
    }
  });

  it('never invents complete final pricing for provisional catalog lines', () => {
    const priced = priceTakeoff(computeTakeoff(DEFAULT_SPEC).lines);
    const extra = priced.lines.find(l => l.material === 'roof_roofing_nails');
    expect(extra?.total).toBeNull();
    expect(extra?.basis).toBeNull();
    const withQuoted = priceTakeoff(computeTakeoff(DEFAULT_SPEC).lines, {
      roof_roofing_nails: { unitPrice: 41, seller: 'Verified local box quote', basis: 'manual' },
    });
    const row = withQuoted.lines.find(l => l.material === 'roof_roofing_nails');
    expect(row?.total).toBe(row!.quantity * 41);
    expect(withQuoted.unpriced).toBe(priced.unpriced - 1);
  });

  it('excludes nonapplicable second-story and garage quantities', () => {
    const t = computeTakeoff({ ...DEFAULT_SPEC, stories: 1, garage: 'none' });
    expect(t.lines.some(l => l.material === 'frame_joists')).toBe(false);
    expect(t.lines.some(l => l.material === 'frame_stair_stringers')).toBe(false);
    expect(t.lines.every(l => Number.isFinite(l.quantity) && l.quantity > 0)).toBe(true);
  });

  it('every material has a source and the cheapest listing wins over the typical price', () => {
    for (const id of MATERIAL_IDS) {
      const m = PRICE_BOOK[id];
      expect(m.id).toBe(id);
      expect(m.source.title.length).toBeGreaterThan(0);
    }
    const shingles = referenceUnitPrice(PRICE_BOOK.shingle_bundle)!;
    expect(shingles.basis).toBe('listing');
    expect(shingles.price).toBe(37.97);
    const underlayment = referenceUnitPrice(PRICE_BOOK.underlayment_roll)!;
    expect(underlayment.price).toBe(128.5);
  });
});
