import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CompareTakeoffRevisions,
  RenderTakeoffComparison,
  TakeoffComparisonRaster,
  TakeoffComparisonPreview,
  type TakeoffComparisonIssue,
} from '@fieldline/contracts';
import { dec } from '@fieldline/pricing';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { renderTakeoffRaster } from '../../services/takeoff-overlay';
import { checkEnabled, checkProject } from './access';
import { readVerifiedEnterpriseDocument } from './documentStorage';
import { estimateQuantity } from './estimateQuantity';
import { readTakeoffPlanSource } from './takeoffPlanSource';
import { currentCalibration, type TakeoffSheetScope } from './takeoffCalibration';

type Issue = z.infer<typeof TakeoffComparisonIssue>;
async function readComparisonSheet(tx: Tx, scope: TakeoffSheetScope) {
  const row = await readTakeoffPlanSource(tx, scope);
  const calibration = await currentCalibration(tx, scope);
  const calibratedMillimetresPerPoint = calibration
    ? estimateQuantity(
        {
          measurementKind: 'length',
          unit: calibration.input.unit,
          quantity: calibration.result.scale,
        },
        'mm',
        8,
      ).unrounded
    : null;
  return {
    documentSetId: row.documentSetId,
    file: row.file,
    calibrationId: calibration?.id ?? null,
    calibratedMillimetresPerPoint,
    dto: {
      planId: row.sheet.planId,
      sheetId: row.sheet.id,
      sourceVersionId: row.sheet.sourceVersionId,
      planTitle: row.planTitle,
      revisionLabel: row.revisionLabel,
      pageLabel: row.sheet.pageLabel,
      pageNumber: row.sheet.pageNumber,
      widthPoints: row.sheet.widthPoints,
      heightPoints: row.sheet.heightPoints,
      rotation: row.sheet.rotation,
    },
  };
}

export async function readTakeoffComparison(
  tx: Tx,
  orgId: string,
  projectId: string,
  input: z.infer<typeof CompareTakeoffRevisions>,
) {
  const { oldRevisionId, oldSheetId, newRevisionId, newSheetId, alignment } = input;
  const earlier = await readComparisonSheet(tx, {
    orgId,
    projectId,
    planId: oldRevisionId,
    sheetId: oldSheetId,
  });
  const current = await readComparisonSheet(tx, {
    orgId,
    projectId,
    planId: newRevisionId,
    sheetId: newSheetId,
  });
  const from = earlier.dto;
  const to = current.dto;
  if (from.sourceVersionId === to.sourceVersionId)
    throw problem('validation_failed', 'Choose another drawing revision to compare.');
  const alignmentIssues: Issue[] = [];
  if (
    earlier.documentSetId !== current.documentSetId ||
    from.pageNumber !== to.pageNumber ||
    from.pageLabel !== to.pageLabel
  ) {
    alignmentIssues.push('different_sheet');
  }
  if (
    from.widthPoints !== to.widthPoints ||
    from.heightPoints !== to.heightPoints ||
    from.rotation !== to.rotation
  ) {
    alignmentIssues.push('different_size');
  }
  const before = earlier.calibratedMillimetresPerPoint;
  const after = current.calibratedMillimetresPerPoint;
  if (before === null || after === null) alignmentIssues.push('unknown_scale');
  else {
    const first = dec(before);
    const second = dec(after);
    const larger = first.gt(second) ? first : second;
    if (first.minus(second).abs().gt(larger.times('0.000001')))
      alignmentIssues.push('different_scale');
  }
  const comparisonKey = createHash('sha256')
    .update(
      JSON.stringify([
        from.planId,
        from.sheetId,
        from.sourceVersionId,
        earlier.calibrationId,
        to.planId,
        to.sheetId,
        to.sourceVersionId,
        current.calibrationId,
        alignment.offsetX,
        alignment.offsetY,
        alignment.scale,
        alignment.rotation,
      ]),
    )
    .digest('hex');
  const preview: z.infer<typeof TakeoffComparisonPreview> = {
    earlier: from,
    current: to,
    alignment,
    alignmentIssues,
    comparisonKey,
    status: alignmentIssues.length && !alignment.reviewed ? 'alignment_review' : 'ready',
  };
  return { preview, earlier, current };
}

const root = '/enterprise/projects/:projectId/takeoff/compare';
const Params = z.object({ projectId: z.uuid() });
const config = {
  permission: 'estimate:write',
  rateLimit: { max: 30, timeWindow: '1 minute' },
} as const;
const takeoffComparison: FastifyPluginAsyncZod = async (app) => {
  app.post(
    root,
    {
      config,
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: CompareTakeoffRevisions,
        response: { 200: TakeoffComparisonPreview },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        return (await readTakeoffComparison(tx, orgId, projectId, request.body)).preview;
      });
    },
  );

  app.post(
    root + '/raster',
    {
      config,
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: RenderTakeoffComparison,
        response: { 200: TakeoffComparisonRaster },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const compared = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        return readTakeoffComparison(tx, orgId, projectId, request.body);
      });
      if (compared.preview.status !== 'ready')
        throw problem('conflict', 'Review the alignment before rendering both drawings.');
      if (compared.preview.comparisonKey !== request.body.comparisonKey) {
        throw problem(
          'conflict',
          'The drawings or alignment changed. Preview both revisions again.',
        );
      }
      const [earlier, current] = await Promise.all([
        readVerifiedEnterpriseDocument(app.storage, orgId, compared.earlier.file),
        readVerifiedEnterpriseDocument(app.storage, orgId, compared.current.file),
      ]);
      const output = await renderTakeoffRaster(
        new Uint8Array(earlier),
        new Uint8Array(current),
        compared.preview,
      );
      reply.header('cache-control', 'private, no-store');
      return output;
    },
  );
};
export default takeoffComparison;
