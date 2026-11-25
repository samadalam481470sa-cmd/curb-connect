import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConfirmEnterpriseTakeoffTransfer,
  EnterpriseTakeoffTransferPreview,
  EnterpriseTakeoffTransferResult,
  PreviewEnterpriseTakeoffTransfer,
} from '@fieldline/contracts';
import {
  enterpriseEstimateLines as lines,
  enterpriseEstimateRevisions as revisions,
  enterpriseEstimateTransferMappings as mappings,
  enterpriseEstimateTransfers as transfers,
} from '../../db/schema/enterpriseEstimates';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';
import { checkedRevision, lineScope, revisionScope } from './estimates';
import { buildPreview, recordDigest } from './estimateTransferPreview';

const Params = z.object({ projectId: z.uuid(), revisionId: z.uuid() });
const root = '/enterprise/projects/:projectId/estimates/:revisionId/takeoff-transfers';
const config = {
  permission: 'estimate:write',
  rateLimit: { max: 45, timeWindow: '1 minute' },
} as const;
type Receipt = z.infer<typeof EnterpriseTakeoffTransferResult>;

const estimateTransfers: FastifyPluginAsyncZod = async (app) => {
  app.post(
    root + '/preview',
    {
      config,
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: PreviewEnterpriseTakeoffTransfer,
        response: { 200: EnterpriseTakeoffTransferPreview },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const expected = parseIfMatch(request);
      const preview = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const { revision } = await checkedRevision(tx, scope, revisionId, 'share');
        assertRevision(revision.revision, expected);
        return buildPreview(tx, scope, revision, request.body);
      });
      setEtag(reply, preview.revision);
      return preview;
    },
  );

  app.post(
    root + '/confirm',
    {
      config,
      schema: {
        tags: ['enterprise'],
        params: Params,
        body: ConfirmEnterpriseTakeoffTransfer,
        response: { 200: EnterpriseTakeoffTransferResult, 201: EnterpriseTakeoffTransferResult },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, revisionId } = request.params;
      const scope = { orgId, projectId };
      const expected = parseIfMatch(request);
      const {
        clientRequestId,
        previewDigest,
        takeoffRevisionId,
        mappings: selected,
      } = request.body;
      const input = { takeoffRevisionId, mappings: selected };
      const requestHash = recordDigest({
        ...input,
        mappings: [...input.mappings].sort((a, b) =>
          a.estimateLineId.localeCompare(b.estimateLineId),
        ),
        previewDigest,
        expected,
      });
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const { revision } = await checkedRevision(tx, scope, revisionId, 'update');
        const [prior] = await tx
          .select()
          .from(transfers)
          .where(
            and(
              eq(transfers.orgId, orgId),
              eq(transfers.projectId, projectId),
              eq(transfers.estimateRevisionId, revisionId),
              eq(transfers.clientRequestId, clientRequestId),
            ),
          );
        if (prior) {
          if (prior.createdByUserId !== userId || prior.requestHash !== requestHash) {
            throw problem(
              'conflict',
              'This request already recorded a different quantity transfer.',
            );
          }
          return { receipt: prior.receipt, created: false };
        }
        assertRevision(revision.revision, expected);
        const preview = await buildPreview(tx, scope, revision, input, true);
        if (preview.previewDigest !== previewDigest) {
          throw problem(
            'conflict',
            'The preview has changed. Review the latest quantities before confirming.',
          );
        }
        if (preview.mappings.some(({ disposition }) => disposition === 'requires_replacement')) {
          throw problem(
            'conflict',
            'Confirm replacement with a reason for each line that already has a quantity.',
          );
        }
        const work = preview.mappings.filter(({ disposition }) => disposition === 'ready');
        const receipt: Receipt = {
          estimateRevisionId: revisionId,
          sourceReviewId: preview.sourceReviewId,
          revision: revision.revision,
          transferId: null,
          applied: false,
          mappings: preview.mappings,
        };
        if (work.length === 0) return { receipt, created: false };
        const transferId = randomUUID();
        const appliedRevision = revision.revision + 1;
        const saved = { ...receipt, applied: true, revision: appliedRevision, transferId };
        await tx.insert(transfers).values({
          id: transferId,
          ...scope,
          estimateRevisionId: revisionId,
          sourceReviewId: preview.sourceReviewId,
          appliedRevision,
          createdByUserId: userId,
          clientRequestId,
          requestHash,
          receipt: saved,
        });
        await tx.insert(mappings).values(
          work.map((entry) => ({
            ...scope,
            estimateRevisionId: revisionId,
            transferId,
            estimateLineId: entry.estimateLineId,
            oldQuantity: entry.oldQuantity,
            oldSourceReviewId: entry.oldSourceReviewId,
            newQuantity: entry.roundedQuantity,
            unroundedQuantity: entry.unroundedQuantity,
            replacementReason: entry.replacementReason,
          })),
        );
        for (const entry of work) {
          await tx
            .update(lines)
            .set({ quantity: entry.roundedQuantity, sourceReviewId: preview.sourceReviewId })
            .where(and(lineScope(scope, revisionId), eq(lines.id, entry.estimateLineId)));
        }
        await tx
          .update(revisions)
          .set({ revision: appliedRevision })
          .where(revisionScope(scope, revisionId));
        await audit(
          tx,
          orgId,
          userId,
          'project_estimate_revision',
          revisionId,
          'takeoff.quantity_transferred',
          {
            revision: revision.revision,
            lines: work.map(({ estimateLineId, oldQuantity, oldSourceReviewId }) => ({
              estimateLineId,
              oldQuantity,
              oldSourceReviewId,
            })),
          },
          saved,
        );
        return { receipt: saved, created: true };
      });
      setEtag(reply, result.receipt.revision);
      return reply.code(result.created ? 201 : 200).send(result.receipt);
    },
  );
};

export default estimateTransfers;
