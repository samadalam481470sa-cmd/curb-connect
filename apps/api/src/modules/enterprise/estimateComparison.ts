import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EditEnterpriseEstimateLine,
  EnterpriseEstimateComparison,
  EnterpriseEstimateLineEditResult,
} from '@fieldline/contracts';
import { dec } from '@fieldline/pricing';
import {
  enterpriseEstimateLineEdits as edits,
  enterpriseEstimateLines as lines,
  enterpriseEstimateRevisions as revisions,
} from '../../db/schema/enterpriseEstimates';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import { checkedRevision, lineDto, lineScope, revisionDto, revisionScope } from './estimates';

const Params = z.object({ projectId: z.uuid(), revisionId: z.uuid() });
const LineParams = Params.extend({ lineId: z.uuid() });
const root = '/enterprise/projects/:projectId/estimates/:revisionId';
type Row = typeof lines.$inferSelect;

function comparable(row: Row) {
  return [row.description, row.unit, row.quantity, row.unitPriceMinor, row.sourceReviewId];
}

function compareRows(beforeRows: Row[], afterRows: Row[]) {
  const before = new Map(beforeRows.map((row) => [row.lineageId ?? row.id, row]));
  const after = new Map(afterRows.map((row) => [row.lineageId ?? row.id, row]));
  return [...new Set([...after.keys(), ...before.keys()])].map((lineageId) => {
    const oldLine = before.get(lineageId);
    const newLine = after.get(lineageId);
    const change = !oldLine
      ? 'added'
      : !newLine
        ? 'removed'
        : JSON.stringify(comparable(oldLine)) === JSON.stringify(comparable(newLine))
          ? 'unchanged'
          : 'changed';
    return {
      lineageId,
      change,
      before: oldLine ? lineDto(oldLine) : null,
      after: newLine ? lineDto(newLine) : null,
    } as const;
  });
}

const estimateComparison: FastifyPluginAsyncZod = async (app) => {
  app.get(
    root + '/comparison',
    {
      config: { permission: 'estimate:read' },
      schema: {
        tags: ['enterprise'],
        params: Params,
        querystring: z.object({ sourceRevisionId: z.uuid().optional() }),
        response: { 200: EnterpriseEstimateComparison },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const target = await checkedRevision(tx, scope, revisionId, 'share');
        const sourceId = request.query.sourceRevisionId ?? target.revision.sourceRevisionId;
        if (!sourceId || sourceId === revisionId)
          throw problem('validation_failed', 'Choose another revision of the same estimate.');
        const source = await checkedRevision(tx, scope, sourceId, 'share');
        if (source.revision.estimateId !== target.revision.estimateId)
          throw problem('not_found', 'Choose a revision of this estimate.');
        const before = await tx
          .select()
          .from(lines)
          .where(lineScope(scope, sourceId))
          .orderBy(asc(lines.ordinal));
        const after = await tx
          .select()
          .from(lines)
          .where(lineScope(scope, revisionId))
          .orderBy(asc(lines.ordinal));
        return {
          source: revisionDto(source),
          target: revisionDto(target),
          rows: compareRows(before, after),
        };
      });
      setEtag(reply, result.target.revision);
      return result;
    },
  );

  app.patch(
    root + '/lines/:lineId',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: LineParams,
        body: EditEnterpriseEstimateLine,
        response: { 200: EnterpriseEstimateLineEditResult },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, revisionId, lineId } = request.params;
      const scope = { orgId, projectId };
      const expected = parseIfMatch(request);
      const { description, unit, quantity, unitPriceMinor, reason, clientRequestId } = request.body;
      const suppliedQuantity = typeof quantity === 'string' ? dec(quantity).toFixed() : quantity;
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            lineId,
            expected,
            description,
            unit,
            suppliedQuantity,
            unitPriceMinor,
            reason,
          }),
        )
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const { revision } = await checkedRevision(tx, scope, revisionId, 'update');
        const [prior] = await tx
          .select()
          .from(edits)
          .where(
            and(
              eq(edits.orgId, orgId),
              eq(edits.projectId, projectId),
              eq(edits.estimateRevisionId, revisionId),
              eq(edits.clientRequestId, clientRequestId),
            ),
          );
        if (prior) {
          if (prior.actorUserId !== userId || prior.requestHash !== hash)
            throw problem('conflict', 'This request already changed a different estimate line.');
          return { revision: prior.resultingRevision, line: prior.afterLine };
        }
        assertRevision(revision.revision, expected);
        if (revision.status !== 'draft')
          throw problem('conflict', 'Create an active draft before editing estimate lines.');
        const rowScope = and(lineScope(scope, revisionId), eq(lines.id, lineId));
        const [original] = await tx.select().from(lines).where(rowScope);
        if (!original) throw problem('not_found');
        if (
          original.unit !== unit &&
          original.quantity !== null &&
          suppliedQuantity === undefined
        ) {
          throw problem('validation_failed', 'Enter the quantity in the new unit.');
        }
        const value = suppliedQuantity === undefined ? original.quantity : suppliedQuantity;
        const changesQuantity = original.quantity !== value || original.unit !== unit;
        if (
          !changesQuantity &&
          original.description === description &&
          original.unitPriceMinor === unitPriceMinor
        ) {
          return { revision: expected, line: lineDto(original) };
        }
        const [updated] = await tx
          .update(lines)
          .set({
            description,
            unit,
            quantity: value,
            unitPriceMinor,
            lastChangeReason: reason,
            sourceReviewId: changesQuantity ? null : original.sourceReviewId,
          })
          .where(rowScope)
          .returning();
        if (!updated) throw new Error('Estimate line update failed.');
        const next = expected + 1;
        await tx.update(revisions).set({ revision: next }).where(revisionScope(scope, revisionId));
        const beforeLine = lineDto(original);
        const afterLine = lineDto(updated);
        await tx.insert(edits).values({
          ...scope,
          estimateRevisionId: revisionId,
          estimateLineId: lineId,
          resultingRevision: next,
          reason,
          actorUserId: userId,
          clientRequestId,
          requestHash: hash,
          beforeLine,
          afterLine,
        });
        await audit(
          tx,
          orgId,
          userId,
          'project_estimate_revision',
          revisionId,
          'estimating.line_edited',
          { revision: expected, line: beforeLine },
          { revision: next, line: afterLine, reason },
        );
        return { revision: next, line: afterLine };
      });
      setEtag(reply, result.revision);
      return result;
    },
  );
};
export default estimateComparison;
