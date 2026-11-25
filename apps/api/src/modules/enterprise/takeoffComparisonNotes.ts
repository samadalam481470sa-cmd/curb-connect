import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateTakeoffComparisonNote,
  TakeoffComparisonKey,
  TakeoffComparisonNote,
  TakeoffComparisonNotePage,
} from '@fieldline/contracts';
import { enterpriseTakeoffComparisonNotes as notes } from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { audit, checkEnabled, checkProject } from './access';
import { readTakeoffComparison } from './takeoffComparison';

const root = '/enterprise/projects/:projectId/takeoff/comparison-notes';
const Project = z.object({ projectId: z.uuid() });
function dto(row: typeof notes.$inferSelect) {
  return {
    id: row.id,
    comparisonKey: row.comparisonKey,
    x: row.x,
    y: row.y,
    body: row.body,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

const takeoffComparisonNotes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    root,
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: Project,
        querystring: z.object({
          comparisonKey: TakeoffComparisonKey,
          cursor: z.string().max(256).optional(),
        }),
        response: { 200: TakeoffComparisonNotePage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const limit = 30;
        const rows = await tx
          .select()
          .from(notes)
          .where(
            and(
              eq(notes.orgId, orgId),
              eq(notes.projectId, projectId),
              eq(notes.comparisonKey, request.query.comparisonKey),
              beforeCursor(notes.createdAt, notes.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(notes.createdAt)), desc(notes.id))
          .limit(limit + 1);
        return pageResult(rows, limit, (row) => ({ at: row.createdAt, id: row.id }), dto);
      });
    },
  );

  app.post(
    root,
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: Project,
        body: CreateTakeoffComparisonNote,
        response: { 200: TakeoffComparisonNote, 201: TakeoffComparisonNote },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { x, y, body, clientRequestId, comparisonKey, ...input } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ comparisonKey, input, x, y, body }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const [prior] = await tx
          .select()
          .from(notes)
          .where(
            and(
              eq(notes.orgId, orgId),
              eq(notes.projectId, projectId),
              eq(notes.clientRequestId, clientRequestId),
            ),
          );
        if (prior) {
          if (prior.requestHash !== requestHash || prior.createdByUserId !== userId)
            throw problem('conflict', 'This request already recorded a different comparison note.');
          return { entry: dto(prior), created: false };
        }
        const compared = await readTakeoffComparison(tx, orgId, projectId, input);
        if (compared.preview.status !== 'ready')
          throw problem('conflict', 'Review the alignment before adding a note.');
        if (compared.preview.comparisonKey !== comparisonKey)
          throw problem(
            'conflict',
            'The comparison has changed. Preview both revisions again before saving a note.',
          );
        const [saved] = await tx
          .insert(notes)
          .values({
            orgId,
            projectId,
            comparisonKey,
            oldPlanId: input.oldRevisionId,
            oldSheetId: input.oldSheetId,
            oldCalibrationId: compared.earlier.calibrationId,
            newPlanId: input.newRevisionId,
            newSheetId: input.newSheetId,
            newCalibrationId: compared.current.calibrationId,
            alignment: input.alignment,
            x,
            y,
            body,
            clientRequestId,
            requestHash,
            createdByUserId: userId,
          })
          .returning();
        if (!saved) throw new Error('Comparison note creation failed.');
        const entry = dto(saved);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_comparison_note',
          saved.id,
          'takeoff.comparison_annotated',
          null,
          {
            ...entry,
            oldPlanId: saved.oldPlanId,
            oldSheetId: saved.oldSheetId,
            newPlanId: saved.newPlanId,
            newSheetId: saved.newSheetId,
            alignment: saved.alignment,
          },
        );
        return { entry, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(result.entry);
    },
  );
};
export default takeoffComparisonNotes;
