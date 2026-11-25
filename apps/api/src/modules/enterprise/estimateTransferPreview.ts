import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  EnterpriseTakeoffTransferPreview,
  PreviewEnterpriseTakeoffTransfer,
} from '@fieldline/contracts';
import { dec } from '@fieldline/pricing';
import type { z } from 'zod';
import {
  enterpriseEstimateLines as lines,
  type enterpriseEstimateRevisions as revisions,
} from '../../db/schema/enterpriseEstimates';
import { enterpriseTakeoffReviews as reviews } from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';
import { readMeasurement } from './takeoffMeasurements';
import { calibrationBlock } from './takeoffReviews';
import { estimateQuantity } from './estimateQuantity';
import { lineScope } from './estimates';

type Scope = { orgId: string; projectId: string };
type EstimateRevision = typeof revisions.$inferSelect;
type Preview = z.infer<typeof EnterpriseTakeoffTransferPreview>;
type PreviewInput = z.infer<typeof PreviewEnterpriseTakeoffTransfer>;

export function recordDigest(record: object): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

export async function approvedSource(tx: Tx, scope: Scope, id: string, lockCount: boolean) {
  const [review] = await tx
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.orgId, scope.orgId),
        eq(reviews.projectId, scope.projectId),
        eq(reviews.id, id),
      ),
    );
  if (!review) throw problem('not_found', 'Choose a reviewed measurement from this project.');
  if (review.status !== 'approved')
    throw problem('conflict', 'Approve the takeoff measurement before transferring its quantity.');
  const sheetScope = { ...scope, planId: review.planId, sheetId: review.sheetId };
  const measurement = await readMeasurement(
    tx,
    sheetScope,
    review.measurementKind,
    review.measurementId,
    lockCount,
  );
  if (
    measurement.revision !== review.measurementRevision ||
    measurement.calibrationId !== review.calibrationId ||
    (await calibrationBlock(tx, sheetScope, measurement))
  ) {
    throw problem(
      'conflict',
      'The takeoff measurement or its scale has changed. Review the current measurement before transferring.',
    );
  }
  return review;
}

export async function buildPreview(
  tx: Tx,
  scope: Scope,
  target: EstimateRevision,
  input: PreviewInput,
  lockCount = false,
): Promise<Preview> {
  if (target.status === 'superseded')
    throw problem('conflict', 'Choose an active draft to transfer quantities.');
  if (target.status === 'approved')
    throw problem('conflict', 'Approved estimates require a new draft revision.');
  const source = await approvedSource(tx, scope, input.takeoffRevisionId, lockCount);
  const requested = new Map(input.mappings.map((mapping) => [mapping.estimateLineId, mapping]));
  const selected = await tx
    .select()
    .from(lines)
    .where(and(lineScope(scope, target.id), inArray(lines.id, [...requested.keys()])))
    .orderBy(lines.ordinal);
  if (selected.length !== input.mappings.length)
    throw problem('not_found', 'Choose lines in this draft estimate revision.');
  const payload = {
    estimateRevisionId: target.id,
    revision: target.revision,
    quantityPrecision: target.quantityPrecision,
    sourceReviewId: source.id,
    sourceQuantity: source.quantity,
    sourceKind: source.measurementKind,
    sourceUnit: source.unit,
    mappings: selected.map((line): Preview['mappings'][number] => {
      const { unrounded, rounded } = estimateQuantity(source, line.unit, target.quantityPrecision);
      const replacementReason = requested.get(line.id)?.replacementReason ?? null;
      const current =
        line.sourceReviewId === source.id &&
        line.quantity !== null &&
        dec(line.quantity).eq(rounded);
      const protectedQuantity = line.quantity !== null && !replacementReason;
      return {
        estimateLineId: line.id,
        description: line.description,
        targetUnit: line.unit,
        oldQuantity: line.quantity,
        oldSourceReviewId: line.sourceReviewId,
        unroundedQuantity: unrounded,
        roundedQuantity: rounded,
        replacementReason,
        disposition: current
          ? 'already_applied'
          : protectedQuantity
            ? 'requires_replacement'
            : 'ready',
      };
    }),
  };
  return { ...payload, previewDigest: recordDigest(payload) };
}
