import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CompareTakeoffRevisions,
  TakeoffComparisonPreview,
  type TakeoffComparisonIssue,
} from '@fieldline/contracts';
import { enterpriseDocumentVersions as versions } from '../../db/schema/enterpriseDocuments';
import {
  enterpriseTakeoffPlanSets as plans,
  enterpriseTakeoffPlanSheets as sheets,
} from '../../db/schema/enterpriseTakeoff';
import { dec } from '@fieldline/pricing';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { checkEnabled, checkProject } from './access';
import { estimateQuantity } from './estimateQuantity';
import { currentCalibration, type TakeoffSheetScope } from './takeoffCalibration';

type Issue = z.infer<typeof TakeoffComparisonIssue>;
async function readComparisonSheet(tx: Tx, scope: TakeoffSheetScope) {
  const [row] = await tx
    .select({
      sheet: sheets,
      planTitle: plans.title,
      revisionLabel: plans.revisionLabel,
      documentSetId: versions.documentSetId,
    })
    .from(sheets)
    .innerJoin(
      plans,
      and(
        eq(plans.id, sheets.planId),
        eq(plans.orgId, sheets.orgId),
        eq(plans.projectId, sheets.projectId),
      ),
    )
    .innerJoin(
      versions,
      and(
        eq(versions.id, sheets.sourceVersionId),
        eq(versions.orgId, sheets.orgId),
        eq(versions.projectId, sheets.projectId),
      ),
    )
    .where(
      and(
        eq(sheets.id, scope.sheetId),
        eq(sheets.orgId, scope.orgId),
        eq(sheets.projectId, scope.projectId),
        eq(sheets.planId, scope.planId),
      ),
    );
  if (!row)
    throw problem('not_found', 'Choose a sheet from the selected project and plan revision.');
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

const takeoffComparison: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/enterprise/projects/:projectId/takeoff/compare',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: z.object({ projectId: z.uuid() }),
        body: CompareTakeoffRevisions,
        response: { 200: TakeoffComparisonPreview },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const { oldRevisionId, oldSheetId, newRevisionId, newSheetId, alignment } = request.body;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
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
        if (from.sourceVersionId === to.sourceVersionId) {
          throw problem('validation_failed', 'Choose another drawing revision to compare.');
        }
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
        return {
          earlier: from,
          current: to,
          alignment,
          alignmentIssues,
          status:
            alignmentIssues.length && !alignment.reviewed
              ? ('alignment_review' as const)
              : ('ready' as const),
        };
      });
    },
  );
};
export default takeoffComparison;
