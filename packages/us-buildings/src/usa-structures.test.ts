import { describe, expect, it } from 'vitest';
import { analyzeStructures, keepAllowedFields, percentile, ringIsValid, shapeRings, LAUNCH_BOUNDS } from './usa-structures';
import { readDbfRecords, readShpRecords } from './shapefile';

const SQ_M_PER_DEGREE_LAT = 111_195;
/** A square of `sideM` metres near Dallas, as a closed ring of [lon, lat]. */
function squareRing(sideM: number, lon = -96.8, lat = 32.78): [number, number][] {
  const dLat = sideM / SQ_M_PER_DEGREE_LAT;
  const dLon = sideM / (SQ_M_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lon, lat],
    [lon + dLon, lat],
    [lon + dLon, lat + dLat],
    [lon, lat + dLat],
    [lon, lat],
  ];
}

function polygonContent(points: [number, number][], parts = [0]): Buffer {
  const size = 44 + parts.length * 4 + points.length * 16;
  const c = Buffer.alloc(size);
  c.writeInt32LE(5, 0);
  c.writeInt32LE(parts.length, 36);
  c.writeInt32LE(points.length, 40);
  parts.forEach((p, i) => c.writeInt32LE(p, 44 + i * 4));
  points.forEach(([x, y], i) => {
    c.writeDoubleLE(x, 44 + parts.length * 4 + i * 16);
    c.writeDoubleLE(y, 44 + parts.length * 4 + i * 16 + 8);
  });
  return c;
}

function pointContent(x: number, y: number): Buffer {
  const c = Buffer.alloc(20);
  c.writeInt32LE(1, 0);
  c.writeDoubleLE(x, 4);
  c.writeDoubleLE(y, 12);
  return c;
}

function buildShp(shapeType: number, contents: Buffer[]): Buffer {
  const body = contents.map((c, i) => {
    const h = Buffer.alloc(8);
    h.writeInt32BE(i + 1, 0);
    h.writeInt32BE(c.length / 2, 4);
    return Buffer.concat([h, c]);
  });
  const total = 100 + body.reduce((s, b) => s + b.length, 0);
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE(total / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(shapeType, 32);
  return Buffer.concat([header, ...body]);
}

/** dBASE table with string-typed fields; each row is a map from field name to text. */
function buildDbf(fieldNames: string[], rows: Record<string, string>[], deleted: number[] = []): Buffer {
  const width = 40;
  const recordLength = 1 + fieldNames.length * width;
  const headerLength = 32 + fieldNames.length * 32 + 1;
  const head = Buffer.alloc(32);
  head.writeUInt8(3, 0);
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(headerLength, 8);
  head.writeUInt16LE(recordLength, 10);
  const descriptors = fieldNames.map((name) => {
    const d = Buffer.alloc(32);
    d.write(name, 0, 'latin1');
    d.write('C', 11, 'latin1');
    d.writeUInt8(width, 16);
    return d;
  });
  const records = rows.map((row, i) => {
    const r = Buffer.alloc(recordLength, 0x20);
    if (deleted.includes(i)) r[0] = 0x2a;
    let cursor = 1;
    for (const name of fieldNames) {
      r.write((row[name] ?? '').padEnd(width).slice(0, width), cursor, 'latin1');
      cursor += width;
    }
    return r;
  });
  return Buffer.concat([head, ...descriptors, Buffer.from([0x0d]), ...records]);
}

function run(shpContents: Buffer[], rows: Record<string, string>[], deleted: number[] = [], options = {}) {
  const shp = buildShp(5, shpContents);
  const dbf = buildDbf(['sqfeet', 'occ_cls', 'uuid', 'prop_addr', 'height'], rows, deleted);
  const shapes = readShpRecords(shp);
  const attrs = readDbfRecords(dbf);
  return analyzeStructures(shapes, attrs, options);
}

const sqft = (sideM: number) => (sideM * sideM) * 10.763910416709722;

describe('analyzeStructures: valid data', () => {
  it('pairs records, checks counts and agrees with the dataset square footage', () => {
    const a = polygonContent(squareRing(10));
    const b = polygonContent(squareRing(20, -96.7));
    const result = run(
      [a, b],
      [
        { sqfeet: String(sqft(10).toFixed(2)), occ_cls: 'RES1', uuid: 'u1', prop_addr: '123 Main St', height: '6.5' },
        { sqfeet: String(sqft(20).toFixed(2)), occ_cls: 'COM1', uuid: 'u2', prop_addr: '9 Elm', height: '' },
      ],
      [],
      { keepSample: 2 },
    );
    expect(result.countsMatch).toBe(true);
    expect(result.shapeRecords).toBe(2);
    expect(result.dbfRecords).toBe(2);
    expect(result.invalidGeometry).toBe(0);
    expect(result.outsideBounds).toBe(0);
    expect(result.belowMinimumSqFt).toBe(0); // a 10 m square is about 1,076 sq ft, above the 450 sq ft threshold
    expect(result.areaCheck.compared).toBe(2);
    expect(result.areaCheck.medianRelErr!).toBeLessThan(0.01);
    expect(result.occupancy).toEqual({ RES1: 1, COM1: 1 });
    expect(result.height.withHeight).toBe(1);
    expect(result.duplicateUuids).toBe(0);
    expect(result.kept[0]).not.toHaveProperty('prop_addr');
    expect(result.kept[0]).toMatchObject({ uuid: 'u1', occ_cls: 'RES1' });
  });
});

describe('analyzeStructures: problems are counted, not hidden', () => {
  it('flags non-closed rings, bad part indices, and points in a polygon file', () => {
    const open = polygonContent([[-96.8, 32.78], [-96.79, 32.78], [-96.79, 32.79], [-96.8, 32.79]]);
    const badParts = polygonContent(squareRing(10), [2]);
    const row = { sqfeet: '100', occ_cls: '', uuid: '', prop_addr: '', height: '' };
    const polygonsResult = run([open, badParts], [row, row]);
    expect(polygonsResult.invalidGeometry).toBe(2);

    // A point record where a polygon is expected is counted as invalid geometry, not silently accepted.
    const pointResult = analyzeStructures(
      readShpRecords(buildShp(1, [pointContent(-96.8, 32.78)])),
      readDbfRecords(buildDbf(['sqfeet'], [{ sqfeet: '1' }])),
    );
    expect(pointResult.invalidGeometry).toBe(1);
  });

  it('counts geometry outside the launch bounds and small structures below 450 sq ft', () => {
    const farAway = polygonContent(squareRing(10, 2.35, 48.85)); // Paris: outside the launch region
    const tiny = polygonContent(squareRing(3)); // about 97 sq ft: below the 450 sq ft threshold
    const row = { sqfeet: '1', occ_cls: 'RES1', uuid: '', prop_addr: '', height: '' };
    const result = run([farAway, tiny], [row, row]);
    expect(result.outsideBounds).toBe(1);
    expect(result.belowMinimumSqFt).toBe(1);
    expect(LAUNCH_BOUNDS.minLon).toBeLessThan(-96);
  });

  it('reports a count mismatch when the attribute table is short or long', () => {
    const shp = buildShp(5, [polygonContent(squareRing(10)), polygonContent(squareRing(10, -96.7))]);
    const short = analyzeStructures(readShpRecords(shp), readDbfRecords(buildDbf(['sqfeet'], [{ sqfeet: '1' }])));
    expect(short.countsMatch).toBe(false);
    const long = analyzeStructures(
      readShpRecords(buildShp(5, [polygonContent(squareRing(10))])),
      readDbfRecords(buildDbf(['sqfeet'], [{ sqfeet: '1' }, { sqfeet: '2' }, { sqfeet: '3' }])),
    );
    expect(long.countsMatch).toBe(false);
    expect(long.dbfRecords).toBe(3);
  });

  it('pairs deleted rows by position and counts them, and counts duplicate uuids', () => {
    const result = run(
      [polygonContent(squareRing(10)), polygonContent(squareRing(10, -96.7)), polygonContent(squareRing(10, -96.6))],
      [
        { sqfeet: '1', occ_cls: 'RES1', uuid: 'same', prop_addr: '', height: '' },
        { sqfeet: '1', occ_cls: 'RES1', uuid: 'gone', prop_addr: '', height: '' },
        { sqfeet: '1', occ_cls: 'RES1', uuid: 'same', prop_addr: '', height: '' },
      ],
      [1],
    );
    expect(result.deletedRows).toBe(1);
    expect(result.dbfRecords).toBe(3);
    expect(result.countsMatch).toBe(true);
    expect(result.duplicateUuids).toBe(1);
  });

  it('computes a total and a height statistic and ignores non-positive heights', () => {
    const result = run(
      [polygonContent(squareRing(10)), polygonContent(squareRing(10, -96.7))],
      [
        { sqfeet: '1', occ_cls: '', uuid: '1', prop_addr: '', height: '4' },
        { sqfeet: '1', occ_cls: '', uuid: '2', prop_addr: '', height: '-1' },
      ],
    );
    expect(result.height).toEqual({ withHeight: 1, medianM: 4, maxM: 4 });
    expect(result.totalSqFt).toBeGreaterThan(2000);
    expect(result.occupancy).toEqual({ unknown: 2 });
  });
});

describe('helpers', () => {
  it('splits polygon parts into rings and rejects malformed parts', () => {
    const ring = squareRing(10);
    const twoRings = [...ring, ...squareRing(5, -96.7)];
    const shape = { parts: [0, ring.length], points: twoRings as [number, number][] };
    expect(shapeRings(shape)).toHaveLength(2);
    expect(shapeRings({ ...shape, parts: [] })).toHaveLength(1);
    expect(shapeRings({ ...shape, parts: [1] })).toBeNull();
    expect(shapeRings({ ...shape, parts: [0, 0] })).toBeNull();
    expect(shapeRings({ ...shape, parts: [0, 99] })).toBeNull();
    expect(shapeRings({ parts: [], points: [] })).toBeNull();
  });

  it('validates rings and computes percentiles', () => {
    expect(ringIsValid(squareRing(10))).toBe(true);
    expect(ringIsValid([[0, 0], [1, 0], [0, 0]])).toBe(false);
    expect(ringIsValid([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
  });

  it('keeps only allow-listed attributes and never addresses', () => {
    const kept = keepAllowedFields({ uuid: 'x', prop_addr: '1 Main', prop_zip: '75201', occ_cls: 'RES1', unknown: 'y' });
    expect(kept).toEqual({ uuid: 'x', occ_cls: 'RES1' });
  });
});
