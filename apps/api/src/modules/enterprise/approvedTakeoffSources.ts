import { and, desc, eq, exists, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EnterpriseApprovedTakeoffSources } from '@fieldline/contracts';
import {
  enterpriseTakeoffCalibrations as calibrations,
  enterpriseTakeoffCountSets as counts,
  enterpriseTakeoffPlanSets as plans,
  enterpriseTakeoffPlanSheets as sheets,
  enterpriseTakeoffReviews as reviews,
} from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { checkEnabled, checkProject } from './access';

const path = '/enterprise/projects/:projectId/takeoff/approved-measurements';
const approvedTakeoffSources: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'estimate:write' },
      schema: {
        tags: ['enterprise'],
        params: z.object({ projectId: z.uuid() }),
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseApprovedTakeoffSources },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const latest = tx
          .select({ id: calibrations.id })
          .from(calibrations)
          .where(
            and(
              eq(calibrations.orgId, reviews.orgId),
              eq(calibrations.projectId, reviews.projectId),
              eq(calibrations.planId, reviews.planId),
              eq(calibrations.sheetId, reviews.sheetId),
            ),
          )
          .orderBy(desc(calibrations.revision))
          .limit(1);
        const currentCount = tx
          .select({ id: counts.id })
          .from(counts)
          .where(
            and(
              eq(counts.orgId, reviews.orgId),
              eq(counts.projectId, reviews.projectId),
              eq(counts.planId, reviews.planId),
              eq(counts.sheetId, reviews.sheetId),
              eq(counts.id, reviews.countId),
              eq(counts.revision, reviews.measurementRevision),
            ),
          );
        const limit = 30;
        const rows = await tx
          .select({
            id: reviews.id,
            measurementKind: reviews.measurementKind,
            quantity: reviews.quantity,
            unit: reviews.unit,
            planTitle: plans.title,
            revisionLabel: plans.revisionLabel,
            sheetLabel: sheets.pageLabel,
            createdAt: reviews.createdAt,
          })
          .from(reviews)
          .innerJoin(
            plans,
            and(
              eq(plans.orgId, reviews.orgId),
              eq(plans.projectId, reviews.projectId),
              eq(plans.id, reviews.planId),
            ),
          )
          .innerJoin(
            sheets,
            and(
              eq(sheets.orgId, reviews.orgId),
              eq(sheets.projectId, reviews.projectId),
              eq(sheets.planId, reviews.planId),
              eq(sheets.id, reviews.sheetId),
            ),
          )
          .where(
            and(
              eq(reviews.orgId, orgId),
              eq(reviews.projectId, projectId),
              eq(reviews.status, 'approved'),
              or(exists(currentCount), eq(reviews.calibrationId, sql`(${latest})`)),
              beforeCursor(reviews.createdAt, reviews.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(reviews.createdAt)), desc(reviews.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          (row) => ({ at: row.createdAt, id: row.id }),
          ({ createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString() }),
        );
      });
    },
  );
};
export default approvedTakeoffSources;
