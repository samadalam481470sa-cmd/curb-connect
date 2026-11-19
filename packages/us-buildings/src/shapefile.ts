// Dependency-free ESRI shapefile (.shp) and dBASE (.dbf) reader. Only what the structures ingest
// needs: header validation, point and polygon/polyline records, and dBASE attribute rows. Every
// length and offset is bounds-checked, so a truncated or corrupted file throws instead of producing
// partial data.

export const SHP_FILE_CODE = 9994;

export const SHAPE_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'null',
  1: 'point',
  3: 'polyline',
  5: 'polygon',
  11: 'point',
  13: 'polyline',
  15: 'polygon',
  21: 'point',
  23: 'polyline',
  25: 'polygon',
};

export interface ShpHeader {
  byteLength: number;
  version: number;
  shapeType: number;
  bbox: readonly [number, number, number, number];
}

export type ShpShape =
  | { kind: 'null' }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'polygon' | 'polyline'; parts: number[]; points: [number, number][] };

export class ShapefileError extends Error {}

function need(buf: Buffer, offset: number, length: number, what: string): void {
  if (offset < 0 || offset + length > buf.length) {
    throw new ShapefileError(`Truncated file while reading ${what} at byte ${offset}.`);
  }
}

export function readShpHeader(buf: Buffer): ShpHeader {
  need(buf, 0, 100, 'header');
  if (buf.readInt32BE(0) !== SHP_FILE_CODE) throw new ShapefileError('Not a shapefile (bad file code).');
  const words = buf.readInt32BE(24);
  if (words * 2 !== buf.length) {
    throw new ShapefileError(`Header declares ${words * 2} bytes but the file has ${buf.length}.`);
  }
  const shapeType = buf.readInt32LE(32);
  if (!(shapeType in SHAPE_TYPE_NAMES)) throw new ShapefileError(`Unsupported shape type ${shapeType}.`);
  return {
    byteLength: buf.length,
    version: buf.readInt32LE(28),
    shapeType,
    bbox: [buf.readDoubleLE(36), buf.readDoubleLE(44), buf.readDoubleLE(52), buf.readDoubleLE(60)],
  };
}

/** Yield each record's shape in file order. Record numbers are checked to be sequential. */
export function* readShpRecords(buf: Buffer): Generator<{ recordNumber: number; shape: ShpShape }> {
  readShpHeader(buf);
  let offset = 100;
  let expected = 1;
  while (offset < buf.length) {
    need(buf, offset, 8, 'record header');
    const recordNumber = buf.readInt32BE(offset);
    const contentBytes = buf.readInt32BE(offset + 4) * 2;
    if (recordNumber !== expected) throw new ShapefileError(`Record ${recordNumber} out of sequence (expected ${expected}).`);
    const start = offset + 8;
    need(buf, start, contentBytes, `record ${recordNumber} content`);
    yield { recordNumber, shape: readShape(buf, start, contentBytes, recordNumber) };
    offset = start + contentBytes;
    expected += 1;
  }
}

function readShape(buf: Buffer, at: number, length: number, recordNumber: number): ShpShape {
  const type = buf.readInt32LE(at);
  const family = SHAPE_TYPE_NAMES[type];
  if (family === undefined) throw new ShapefileError(`Record ${recordNumber}: unsupported shape type ${type}.`);
  if (family === 'null') return { kind: 'null' };
  if (family === 'point') {
    need(buf, at + 4, 16, `record ${recordNumber} point`);
    return { kind: 'point', x: buf.readDoubleLE(at + 4), y: buf.readDoubleLE(at + 12) };
  }
  // Polyline and polygon: type, box (4 doubles), numParts, numPoints, parts[], points[] (x,y doubles).
  need(buf, at + 4, 40, `record ${recordNumber} header`);
  const numParts = buf.readInt32LE(at + 36);
  const numPoints = buf.readInt32LE(at + 40);
  if (numParts < 0 || numPoints < 0) throw new ShapefileError(`Record ${recordNumber}: negative counts.`);
  const partsAt = at + 44;
  const pointsAt = partsAt + numParts * 4;
  const expectedLength = 44 + numParts * 4 + numPoints * 16;
  if (expectedLength > length) throw new ShapefileError(`Record ${recordNumber}: content length mismatch.`);
  need(buf, pointsAt, numPoints * 16, `record ${recordNumber} points`);
  const parts: number[] = [];
  for (let i = 0; i < numParts; i += 1) parts.push(buf.readInt32LE(partsAt + i * 4));
  const points: [number, number][] = [];
  for (let i = 0; i < numPoints; i += 1) {
    points.push([buf.readDoubleLE(pointsAt + i * 16), buf.readDoubleLE(pointsAt + i * 16 + 8)]);
  }
  return { kind: family as 'polygon' | 'polyline', parts, points };
}

export interface DbfField {
  name: string;
  type: string;
  length: number;
  decimals: number;
}

export interface DbfTable {
  fields: DbfField[];
  rows: Record<string, string>[];
  deleted: number;
}

export interface DbfPhysicalRecord {
  deleted: boolean;
  values: Record<string, string>;
}

/**
 * Stream every physical dBASE record in order, including deleted ones, so the position of each record
 * still matches the shapefile record with the same index. Use this for pairing; readDbf drops deleted rows.
 */
export function* readDbfRecords(buf: Buffer): Generator<DbfPhysicalRecord> {
  need(buf, 0, 32, 'dBASE header');
  const count = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const fields: DbfField[] = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    need(buf, offset, 32, 'field descriptor');
    const raw = buf.subarray(offset, offset + 11);
    const nul = raw.indexOf(0);
    fields.push({
      name: raw.subarray(0, nul < 0 ? 11 : nul).toString('latin1'),
      type: String.fromCharCode(buf[offset + 11]!),
      length: buf[offset + 16]!,
      decimals: buf[offset + 17]!,
    });
  }
  need(buf, headerLength, count * recordLength, 'records');
  for (let r = 0; r < count; r += 1) {
    const base = headerLength + r * recordLength;
    const values: Record<string, string> = {};
    let cursor = base + 1;
    for (const field of fields) {
      values[field.name] = buf.subarray(cursor, cursor + field.length).toString('latin1').trim();
      cursor += field.length;
    }
    yield { deleted: buf[base] === 0x2a, values };
  }
}

/** Read a dBASE III/IV table. Deleted rows are counted but not returned. */
export function readDbf(buf: Buffer): DbfTable {
  need(buf, 0, 32, 'dBASE header');
  const count = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const fields: DbfField[] = [];
  let offset = 32;
  while (offset < headerLength - 1) {
    need(buf, offset, 32, 'field descriptor');
    const raw = buf.subarray(offset, offset + 11);
    const nul = raw.indexOf(0);
    fields.push({
      name: raw.subarray(0, nul < 0 ? 11 : nul).toString('latin1'),
      type: String.fromCharCode(buf[offset + 11]!),
      length: buf[offset + 16]!,
      decimals: buf[offset + 17]!,
    });
    offset += 32;
  }
  const rowsStart = headerLength;
  need(buf, rowsStart, count * recordLength, 'records');
  const rows: Record<string, string>[] = [];
  let deleted = 0;
  for (let r = 0; r < count; r += 1) {
    const base = rowsStart + r * recordLength;
    if (buf[base] === 0x2a) {
      deleted += 1;
      continue;
    }
    const row: Record<string, string> = {};
    let cursor = base + 1;
    for (const field of fields) {
      row[field.name] = buf.subarray(cursor, cursor + field.length).toString('latin1').trim();
      cursor += field.length;
    }
    rows.push(row);
  }
  return { fields, rows, deleted };
}
