import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  SetTakeoffSymbolDetection,
  TakeoffSymbolDetectionRevision,
  TakeoffSymbolDetectionSetting,
} from '@fieldline/contracts';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseTakeoffSymbolDetectionRevisions as revisions } from '../../db/schema/enterpriseTakeoff';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { audit, checkEnabled } from './access';

const path = '/enterprise/takeoff/symbol-detection';

function dto(row: typeof revisions.$inferSelect) {
  return {
    enabled: row.enabled,
    revision: row.revision,
    reason: row.reason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

const takeoffSymbolDetection: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'job:read' },
      schema: { tags: ['enterprise'], response: { 200: TakeoffSymbolDetectionSetting } },
    },
    async (request, reply) => {
      const { orgId, permissions } = requireOrg(request);
      const canManage = permissions.has('org:settings_update');
      const records = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        return tx
          .select()
          .from(revisions)
          .where(eq(revisions.orgId, orgId))
          .orderBy(desc(revisions.revision))
          .limit(canManage ? 20 : 1);
      });
      const [current] = records;
      const revision = current?.revision ?? 0;
      setEtag(reply, revision);
      return {
        enabled: current?.enabled ?? false,
        revision,
        recentChanges: canManage ? records.map(dto) : [],
      };
    },
  );

  app.put(
    path,
    {
      config: { permission: 'org:settings_update', rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        body: SetTakeoffSymbolDetection,
        response: { 200: TakeoffSymbolDetectionRevision },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const expected = parseIfMatch(request);
      const { enabled, reason, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ enabled, reason, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const [suite] = await tx
          .select({ enabled: enterpriseSettings.enabled })
          .from(enterpriseSettings)
          .where(eq(enterpriseSettings.orgId, orgId))
          .for('update');
        if (!suite?.enabled)
          throw problem('forbidden', 'Enable the Enterprise Suite for your company first.');
        const [prior] = await tx
          .select()
          .from(revisions)
          .where(and(eq(revisions.orgId, orgId), eq(revisions.clientRequestId, clientRequestId)));
        if (prior) {
          if (prior.requestHash !== requestHash || prior.createdByUserId !== userId)
            throw problem(
              'conflict',
              'This request already recorded a different detection setting.',
            );
          return dto(prior);
        }
        const [current] = await tx
          .select()
          .from(revisions)
          .where(eq(revisions.orgId, orgId))
          .orderBy(desc(revisions.revision))
          .limit(1);
        const revision = current?.revision ?? 0;
        assertRevision(revision, expected);
        const [row] = await tx
          .insert(revisions)
          .values({
            orgId,
            revision: revision + 1,
            enabled,
            reason,
            clientRequestId,
            requestHash,
            createdByUserId: userId,
          })
          .returning();
        if (!row) throw new Error('Takeoff detection setting insertion failed.');
        const saved = dto(row);
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_symbol_detection_setting',
          row.id,
          'takeoff.symbol_detection_setting_changed',
          current ? dto(current) : { enabled: false, revision: 0 },
          saved,
        );
        return saved;
      });
      setEtag(reply, result.revision);
      return result;
    },
  );
};
export default takeoffSymbolDetection;
