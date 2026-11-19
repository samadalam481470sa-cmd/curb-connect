// Offline verification of USA Structures footprints for one launch state.
//
// Usage: npx tsx scripts/verify-usa-structures.ts <state-zip> <STATE> <report-dir> [work-dir]
//
// Reads the National Map state package, extracts one footprint part at a time into the work directory,
// checks it with analyzeStructures, deletes the extracted files, and writes aggregate JSON reports.
// It does NOT load the data into the product and writes no addresses or per-building rows.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  analyzeStructures,
  LAUNCH_BOUNDS,
  readDbfRecords,
  readShpRecords,
  requireLaunchState,
  USA_STRUCTURES_ATTRIBUTION,
  type StructuresAnalysis,
} from '../src/index';

const TAR = 'C:\\Windows\\System32\\tar.exe';

function listParts(zip: string): number[] {
  const listing = execFileSync(TAR, ['-tf', zip], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const parts = [...listing.matchAll(/Poly_FEMA_(\d+)\.shp$/gm)].map((m) => Number(m[1]));
  return parts.sort((a, b) => a - b);
}

function extract(zip: string, entries: string[], dest: string): void {
  mkdirSync(dest, { recursive: true });
  execFileSync(TAR, ['-xf', zip, '-C', dest, ...entries], { stdio: 'ignore' });
}

interface PartReport extends StructuresAnalysis {
  part: number;
  seconds: number;
}

function main(): void {
  const [zip, stateArg, reportDir, workArg] = process.argv.slice(2);
  if (!zip || !stateArg || !reportDir) {
    throw new Error('Usage: verify-usa-structures.ts <state-zip> <STATE> <report-dir> [work-dir]');
  }
  const state = requireLaunchState(stateArg);
  const work = workArg ?? join(reportDir, 'work');
  mkdirSync(reportDir, { recursive: true });
  const parts = listParts(zip);
  if (parts.length === 0) throw new Error(`No USA Structures polygon parts found in ${basename(zip)}.`);

  const reports: PartReport[] = [];
  for (const part of parts) {
    const started = Date.now();
    const shpEntry = `Shape/Struct_Poly_FEMA_${part}.shp`;
    const dbfEntry = `Shape/Struct_Poly_FEMA_${part}.dbf`;
    extract(zip, [shpEntry, dbfEntry], work);
    const shpBuf = readFileSync(join(work, shpEntry));
    const dbfBuf = readFileSync(join(work, dbfEntry));
    const analysis = analyzeStructures(readShpRecords(shpBuf), readDbfRecords(dbfBuf), { bounds: LAUNCH_BOUNDS });
    reports.push({ ...analysis, part, seconds: Math.round((Date.now() - started) / 100) / 10 });
    rmSync(join(work, shpEntry), { force: true });
    rmSync(join(work, dbfEntry), { force: true });
    writeFileSync(join(reportDir, `${state}-part-${part}.json`), JSON.stringify({ part, ...analysis, kept: [] }, null, 2));
    console.log(`${state} part ${part}: ${analysis.shapeRecords} records, countsMatch=${analysis.countsMatch}, invalid=${analysis.invalidGeometry}, outside=${analysis.outsideBounds}, medianAreaErr=${analysis.areaCheck.medianRelErr}`);
  }

  const sum = (f: (r: PartReport) => number) => reports.reduce((s, r) => s + f(r), 0);
  const occupancy: Record<string, number> = {};
  for (const r of reports) for (const [k, v] of Object.entries(r.occupancy)) occupancy[k] = (occupancy[k] ?? 0) + v;
  const summary = {
    state,
    source: 'USA Structures (state package from The National Map)',
    attribution: USA_STRUCTURES_ATTRIBUTION,
    zip: basename(zip),
    parts: parts.length,
    shapeRecords: sum((r) => r.shapeRecords),
    dbfRecords: sum((r) => r.dbfRecords),
    deletedRows: sum((r) => r.deletedRows),
    allPartsCountsMatch: reports.every((r) => r.countsMatch),
    invalidGeometry: sum((r) => r.invalidGeometry),
    outsideBounds: sum((r) => r.outsideBounds),
    belowMinimumSqFt: sum((r) => r.belowMinimumSqFt),
    duplicateUuidsWithinParts: sum((r) => r.duplicateUuids),
    totalSqFt: sum((r) => r.totalSqFt),
    areaCheck: {
      compared: sum((r) => r.areaCheck.compared),
      // Approximate: median and 95th percentile of the per-part values, not recomputed across all records.
      medianOfPartMedians: medianOf(reports.map((r) => r.areaCheck.medianRelErr).filter((v): v is number => v !== null)),
      worstPartP95: maxOf(reports.map((r) => r.areaCheck.p95RelErr).filter((v): v is number => v !== null)),
    },
    occupancy,
    heightWithValues: sum((r) => r.height.withHeight),
    perPart: reports.map(({ kept: _kept, ...r }) => r),
  };
  writeFileSync(join(reportDir, `${state}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, perPart: undefined }, null, 2));
  rmSync(work, { recursive: true, force: true });
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function maxOf(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

main();
