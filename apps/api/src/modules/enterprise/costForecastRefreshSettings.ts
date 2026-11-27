import { createHash } from 'node:crypto';
import {
  EnterpriseForecastRefreshSettings,
  SetEnterpriseForecastRefresh,
} from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Tx } from '../../db/runtime';
import { forecastRefreshRevisions as rules } from '../../db/schema/enterpriseForecastRefresh';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import { currentForecastRefreshRules, latestApprovedForecast } from './costForecastRefreshData';

const path = '/enterprise/projects/:projectId/forecasts/settings/refresh';
type Scope = { orgId: string; projectId: string };

async function policy(tx: Tx, scope: Scope) {
  const [rows, forecast] = await Promise.all([
    currentForecastRefreshRules(tx, scope, 20),
    latestApprovedForecast(tx, scope),
  ]);
  const history = rows.map(({ id, revision, enabled, reason, recordedAt }) => ({
    id,
    revision,
    enabled,
    reason,
    recordedAt: recordedAt.toISOString(),
  }));
  return {
    enabled: rows[0]?.enabled ?? true,
    revision: rows[0]?.revision ?? 0,
    ready: Boolean(forecast),
    history,
  };
}

const costForecastRefreshSettings: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        response: { 200: EnterpriseForecastRefreshSettings },
      },
    },
    async (request, reply) => {
      const result = await tenantTx(request, async (tx) => {
        const { projectId } = request.params;
        const { org } = await requireBudgetProject(request, tx, projectId);
        return policy(tx, { orgId: org.orgId, projectId });
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path,
    {
      config: { permission: 'enterprise_budget:approve' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: SetEnterpriseForecastRefresh,
        response: { 200: EnterpriseForecastRefreshSettings },
      },
    },
    async (request, reply) => {
      const expected = parseIfMatch(request);
      const { enabled, reason, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ expected, enabled, reason }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { projectId } = request.params;
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const [prior] = await tx
          .select()
          .from(rules)
          .where(
            and(
              eq(rules.orgId, org.orgId),
              eq(rules.projectId, projectId),
              eq(rules.clientRequestId, clientRequestId),
            ),
          );
        if (prior) {
          if (prior.requestHash !== requestHash || prior.changedByUserId !== org.userId)
            throw problem('conflict', 'This request already changed a different forecast setting.');
          return policy(tx, scope);
        }
        const [current] = await currentForecastRefreshRules(tx, scope, 1);
        assertRevision(current?.revision ?? 0, expected);
        const [saved] = await tx
          .insert(rules)
          .values({
            ...scope,
            enabled,
            reason,
            revision: expected + 1,
            changedByUserId: org.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_forecast_refresh_policy',
          resourceId: saved.id,
          action: 'forecast.refresh_setting_changed',
          reason,
          before: { projectId, enabled: current?.enabled ?? true, revision: expected },
          after: { projectId, enabled, revision: saved.revision },
        });
        return policy(tx, scope);
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default costForecastRefreshSettings;
