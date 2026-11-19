import { describe, expect, it } from 'vitest';
import { readDbf, readShpHeader, readShpRecords, ShapefileError } from './shapefile';

/** Build a valid .shp (header + records). `records` are functions writing each record's content. */
function buildShp(shapeType: number, contents: Buffer[], bbox = [0, 0, 0, 0]): Buffer {
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
  bbox.forEach((v, i) => header.writeDoubleLE(v, 36 + i * 8));
  return Buffer.concat([header, ...body]);
}

function pointContent(x: number, y: number): Buffer {
  const c = Buffer.alloc(20);
  c.writeInt32LE(1, 0);
  c.writeDoubleLE(x, 4);
  c.writeDoubleLE(y, 12);
  return c;
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

/** Build a dBASE III table. Each row is an array of strings matching the field widths. */
function buildDbf(fields: [string, string, number][], rows: string[][], deletedRows: number[] = []): Buffer {
  const recordLength = 1 + fields.reduce((s, [, , len]) => s + len, 0);
  const headerLength = 32 + fields.length * 32 + 1;
  const head = Buffer.alloc(32);
  head.writeUInt8(3, 0);
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(headerLength, 8);
  head.writeUInt16LE(recordLength, 10);
  const descriptors = fields.map(([name, type, len]) => {
    const d = Buffer.alloc(32);
    d.write(name, 0, 'latin1');
    d.write(type, 11, 'latin1');
    d.writeUInt8(len, 16);
    return d;
  });
  const records = rows.map((row, i) => {
    const r = Buffer.alloc(recordLength, 0x20);
    if (deletedRows.includes(i)) r[0] = 0x2a;
    let cursor = 1;
    fields.forEach(([, , len], f) => {
      r.write((row[f] ?? '').padEnd(len).slice(0, len), cursor, 'latin1');
      cursor += len;
    });
    return r;
  });
  return Buffer.concat([head, ...descriptors, Buffer.from([0x0d]), ...records, Buffer.from([0x1a])]);
}

describe('shapefile header', () => {
  it('reads shape type, version and bounding box from a valid header', () => {
    const shp = buildShp(1, [pointContent(-97.5, 31.2)], [-97.5, 31.2, -97.5, 31.2]);
    const header = readShpHeader(shp);
    expect(header.shapeType).toBe(1);
    expect(header.version).toBe(1000);
    expect(header.bbox[0]).toBeCloseTo(-97.5, 9);
  });

  it('rejects a wrong file code, a length mismatch and an unknown shape type', () => {
    const good = buildShp(1, [pointContent(1, 2)]);
    const badCode = Buffer.from(good);
    badCode.writeInt32BE(1234, 0);
    expect(() => readShpHeader(badCode)).toThrow(/bad file code/);

    const badLength = Buffer.from(good);
    badLength.writeInt32BE(999, 24);
    expect(() => readShpHeader(badLength)).toThrow(/declares/);

    const badType = buildShp(1, [pointContent(1, 2)]);
    badType.writeInt32LE(77, 32);
    expect(() => readShpHeader(badType)).toThrow(/Unsupported shape type 77/);

    expect(() => readShpHeader(Buffer.alloc(50))).toThrow(/Truncated/);
  });
});

describe('shapefile records', () => {
  it('reads point records in order', () => {
    const shp = buildShp(1, [pointContent(-97.5, 31.2), pointContent(-98, 32)]);
    const records = [...readShpRecords(shp)];
    expect(records.map((r) => r.recordNumber)).toEqual([1, 2]);
    expect(records[1]!.shape).toEqual({ kind: 'point', x: -98, y: 32 });
  });

  it('reads polygon rings with parts', () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const shp = buildShp(5, [polygonContent(ring, [0])]);
    const [rec] = [...readShpRecords(shp)];
    expect(rec!.shape).toMatchObject({ kind: 'polygon', parts: [0] });
    expect((rec!.shape as { points: unknown[] }).points).toHaveLength(4);
  });

  it('detects out-of-sequence records, truncated content and bad polygon counts', () => {
    const shp = buildShp(1, [pointContent(1, 2), pointContent(3, 4)]);
    // Renumber the second record so it breaks the sequence.
    const broken = Buffer.from(shp);
    broken.writeInt32BE(9, 100 + 8 + 20 + 0);
    expect(() => [...readShpRecords(broken)]).toThrow(/out of sequence/);

    const truncated = shp.subarray(0, shp.length - 4);
    expect(() => [...readShpRecords(truncated)]).toThrow(/Truncated|mismatch|declares/);

    const badPoly = buildShp(5, [polygonContent([[0, 0], [1, 1]])]);
    // numPoints sits 40 bytes into the content, which starts after the 100-byte header and 8-byte record header.
    badPoly.writeInt32LE(100000, 100 + 8 + 40); // numPoints too large
    expect(() => [...readShpRecords(badPoly)]).toThrow();
  });

  it('rejects unsupported record shape types inside a file', () => {
    const shp = buildShp(1, [pointContent(1, 2)]);
    shp.writeInt32LE(8, 100 + 8); // MultiPoint is not supported
    expect(() => [...readShpRecords(shp)]).toThrow(ShapefileError);
  });
});

describe('dBASE table', () => {
  it('reads field descriptors and trimmed rows', () => {
    const dbf = buildDbf(
      [
        ['STRUCT_ID', 'C', 10],
        ['HEIGHT_M', 'N', 6],
      ],
      [
        ['A1', '12.5'],
        ['B2', '7'],
      ],
    );
    const table = readDbf(dbf);
    expect(table.fields.map((f) => f.name)).toEqual(['STRUCT_ID', 'HEIGHT_M']);
    expect(table.rows).toEqual([
      { STRUCT_ID: 'A1', HEIGHT_M: '12.5' },
      { STRUCT_ID: 'B2', HEIGHT_M: '7' },
    ]);
    expect(table.deleted).toBe(0);
  });

  it('skips deleted rows but counts them', () => {
    const dbf = buildDbf([['NAME', 'C', 8]], [['keep'], ['gone'], ['also']], [1]);
    const table = readDbf(dbf);
    expect(table.rows.map((r) => r.NAME)).toEqual(['keep', 'also']);
    expect(table.deleted).toBe(1);
  });

  it('rejects a table whose record area is truncated', () => {
    const dbf = buildDbf([['NAME', 'C', 8]], [['one'], ['two']]);
    expect(() => readDbf(dbf.subarray(0, dbf.length - 30))).toThrow(/Truncated/);
    expect(() => readDbf(Buffer.alloc(10))).toThrow(/Truncated/);
  });
});
