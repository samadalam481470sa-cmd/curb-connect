import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, max } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EnterpriseEstimateDetail, ReviseEnterpriseEstimate } from '@fieldline/contracts';
import {
  enterpriseEstimateLines as lines,
  enterpriseEstimateRevisions as revisions,
} from '../../db/schema/enterpriseEstimates';
import { requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { problem } from '../../http/problem';
import { audit, checkEnabled, checkProject } from './access';
import { checkedRevision, detail, lineScope, revisionDto, revisionScope } from './estimates';

const path = '/enterprise/projects/:projectId/estimates/:revisionId/revise';
const estimateRevisions: FastifyPluginAsyncZod = async (app) => {
  app.post(
    path,
    {
      config: { permission: 'estimate:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: z.object({ projectId: z.uuid(), revisionId: z.uuid() }),
        body: ReviseEnterpriseEstimate,
        response: { 200: EnterpriseEstimateDetail, 201: EnterpriseEstimateDetail },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const expected = parseIfMatch(request);
      const { reason, clientRequestId } = request.body;
      const hash = createHash('sha256')
        .update(JSON.stringify({ revisionId, expected, reason }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const original = await checkedRevision(tx, scope, revisionId, 'update');
        const base = original.revision;
        const estimate = and(
          eq(revisions.orgId, orgId),
          eq(revisions.projectId, projectId),
          eq(revisions.estimateId, base.estimateId),
        );
        const [prior] = await tx
          .select()
          .from(revisions)
          .where(and(estimate, eq(revisions.revisionRequestId, clientRequestId)));
        if (prior) {
          if (prior.createdByUserId !== userId || prior.revisionRequestHash !== hash) {
            throw problem(
              'conflict',
              'This request already created a different estimate revision.',
            );
          }
          return {
            entry: await detail(tx, scope, { title: original.title, revision: prior }),
            created: false,
          };
        }
        assertRevision(base.revision, expected);
        const [latest] = await tx
          .select({ number: max(revisions.revisionNumber) })
          .from(revisions)
          .where(estimate);
        const [draft] = await tx
          .insert(revisions)
          .values({
            ...scope,
            estimateId: base.estimateId,
            revisionNumber: (latest?.number ?? base.revisionNumber) + 1,
            sourceRevisionId: base.id,
            revisionReason: reason,
            revisionRequestId: clientRequestId,
            revisionRequestHash: hash,
            currency: base.currency,
            quantityPrecision: base.quantityPrecision,
            createdByUserId: userId,
          })
          .returning();
        if (!draft) throw new Error('Estimate revision creation failed.');
        const originalLines = await tx
          .select()
          .from(lines)
          .where(lineScope(scope, revisionId))
          .orderBy(asc(lines.ordinal));
        const batchSize = 300;
        for (let start = 0; start < originalLines.length; start += batchSize) {
          await tx.insert(lines).values(
            originalLines.slice(start, start + batchSize).map((line) => ({
              ...scope,
              estimateRevisionId: draft.id,
              lineageId: line.lineageId ?? line.id,
              ordinal: line.ordinal,
              description: line.description,
              unit: line.unit,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              lastChangeReason: line.lastChangeReason,
              sourceReviewId: line.sourceReviewId,
              createdByUserId: userId,
              clientRequestId: randomUUID(),
              requestHash: hash,
            })),
          );
        }
        if (base.status === 'draft') {
          const [historical] = await tx
            .update(revisions)
            .set({ status: 'superseded', revision: base.revision + 1 })
            .where(revisionScope(scope, base.id))
            .returning();
          if (!historical) throw new Error('The earlier draft could not be preserved.');
          await audit(
            tx,
            orgId,
            userId,
            'project_estimate_revision',
            base.id,
            'estimating.draft_superseded',
            revisionDto(original),
            {
              ...revisionDto({ ...original, revision: historical }),
              replacementRevisionId: draft.id,
              reason,
            },
          );
        }
        const entry = await detail(tx, scope, { title: original.title, revision: draft });
        await audit(
          tx,
          orgId,
          userId,
          'project_estimate_revision',
          draft.id,
          'estimating.draft_revised',
          null,
          {
            ...revisionDto({ title: original.title, revision: draft }),
            lineCount: entry.lines.length,
          },
        );
        return { entry, created: true };
      });
      setEtag(reply, result.entry.revision);
      return reply.code(result.created ? 201 : 200).send(result.entry);
    },
  );
};
export default estimateRevisions;
