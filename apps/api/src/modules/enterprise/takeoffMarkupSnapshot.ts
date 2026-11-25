import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { TakeoffMarkupPreview } from '@fieldline/contracts';
import { TAKEOFF_SCALE_WARNING_PERCENT } from '@fieldline/contracts';
import { canonicalJson, sha256Hex } from '@fieldline/pdf';
import { dec } from '@fieldline/pricing';
import type { z } from 'zod';
import {
  enterpriseTakeoffAreas as areas,
  enterpriseTakeoffCountMarkers as markers,
  enterpriseTakeoffCountSets as counts,
  enterpriseTakeoffLengths as lengths,
  enterpriseTakeoffReviews as reviews,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import type { MarkupGeometry } from '../../services/takeoff-markup';
import { readTakeoffPlanSource } from './takeoffPlanSource';
import { currentCalibration, type TakeoffSheetScope } from './takeoffCalibration';
import { sheetScope } from './takeoffMeasurements';

type Preview = z.infer<typeof TakeoffMarkupPreview>;
type Layer = Preview['visibleLayers'][number];
type Approved = Pick<typeof reviews.$inferSelect, 'id' | 'measurementKind' | 'quantity' | 'unit'>;

function summarize(rows: Approved[]): Preview['totals'] {
  const sums = new Map<string, { layer: Layer; unit: string; quantity: ReturnType<typeof dec> }>();
  for (const row of rows) {
    const layer = row.measurementKind;
    const unit = row.unit ? row.unit + (layer === 'area' ? '²' : '') : 'each';
    const key = layer + '/' + unit;
    const quantity = (sums.get(key)?.quantity ?? dec(0)).add(row.quantity);
    sums.set(key, { layer, unit, quantity });
  }
  return [...sums.values()].map(({ layer, unit, quantity }) => ({
    layer,
    unit,
    quantity: quantity.toString(),
  }));
}

export async function readMarkupSnapshot(
  tx: Tx,
  scope: TakeoffSheetScope,
  selected: Layer[],
  includeGeometry = false,
) {
  const source = await readTakeoffPlanSource(tx, scope);
  const calibration = await currentCalibration(tx, scope);
  const calibrationId = calibration?.id ?? null;
  const scaleIncorrect =
    (calibration?.result.verificationResult?.errorPercent ?? 0) >= TAKEOFF_SCALE_WARNING_PERCENT;
  const scaleLabel = calibration
    ? dec(calibration.result.scale).toSignificantDigits(10).toString() +
      ' ' +
      calibration.input.unit +
      ' per drawing point · Calibration ' +
      calibration.revision +
      (scaleIncorrect ? ' (verification failed)' : '')
    : 'Uncalibrated';
  const visibleLayers = [...selected].sort();
  const approved = await tx
    .select()
    .from(reviews)
    .where(
      and(
        sheetScope(reviews, scope),
        eq(reviews.status, 'approved'),
        inArray(reviews.measurementKind, visibleLayers),
      ),
    )
    .orderBy(asc(reviews.measurementKind), asc(reviews.unit), asc(reviews.id));

  const measured = approved.filter(
    (row) =>
      row.measurementKind !== 'count' &&
      calibrationId &&
      !scaleIncorrect &&
      row.calibrationId === calibrationId,
  );
  const candidateCountIds = approved.flatMap((row) => (row.countId ? [row.countId] : []));
  const countSets = candidateCountIds.length
    ? await tx
        .select({ id: counts.id, revision: counts.revision, symbol: counts.symbol })
        .from(counts)
        .where(and(sheetScope(counts, scope), inArray(counts.id, candidateCountIds)))
    : [];
  const countById = new Map(countSets.map((row) => [row.id, row]));
  const currentCounts = approved.filter(
    (row) => row.countId && countById.get(row.countId)?.revision === row.measurementRevision,
  );
  const included = [...measured, ...currentCounts];
  const summary = {
    sheetId: scope.sheetId,
    revisionId: scope.planId,
    revisionLabel: source.revisionLabel,
    scaleLabel,
    visibleLayers,
    approvedCount: included.length,
    totals: summarize(included),
  };
  const reviewIds = included.map((row) => row.id);
  const selectionDigest = sha256Hex(
    canonicalJson({
      ...summary,
      calibrationId,
      sourceVersionId: source.sheet.sourceVersionId,
      sourceDigest: source.file.sha256Hex,
      reviewIds,
    }),
  );
  const preview: Preview = { ...summary, selectionDigest };
  const geometry: MarkupGeometry[] = [];
  if (includeGeometry) {
    const lengthIds = measured.flatMap((row) => (row.lengthId ? [row.lengthId] : []));
    const areaIds = measured.flatMap((row) => (row.areaId ? [row.areaId] : []));
    const countIds = currentCounts.flatMap((row) => (row.countId ? [row.countId] : []));
    if (lengthIds.length) {
      const rows = await tx
        .select({ id: lengths.id, points: lengths.vertices })
        .from(lengths)
        .where(and(sheetScope(lengths, scope), inArray(lengths.id, lengthIds)))
        .orderBy(asc(lengths.id));
      geometry.push(
        ...rows.map((row): MarkupGeometry => ({ kind: 'length', id: row.id, rings: [row.points] })),
      );
    }
    if (areaIds.length) {
      const rows = await tx
        .select({ id: areas.id, exterior: areas.exterior, holes: areas.holes })
        .from(areas)
        .where(and(sheetScope(areas, scope), inArray(areas.id, areaIds)))
        .orderBy(asc(areas.id));
      geometry.push(
        ...rows.map((row): MarkupGeometry => ({
          kind: 'area',
          id: row.id,
          rings: [row.exterior, ...row.holes],
        })),
      );
    }
    if (countIds.length) {
      const rows = await tx
        .select({ id: markers.id, setId: markers.countSetId, x: markers.x, y: markers.y })
        .from(markers)
        .where(
          and(
            sheetScope(markers, scope),
            inArray(markers.countSetId, countIds),
            isNull(markers.removedAt),
          ),
        )
        .orderBy(asc(markers.countSetId), asc(markers.ordinal));
      for (const { id, setId, x, y } of rows) {
        const set = countById.get(setId);
        if (set) geometry.push({ kind: 'count', id, point: { x, y }, symbol: set.symbol });
      }
    }
  }

  return { source, calibrationId, preview, reviewIds, geometry };
}
