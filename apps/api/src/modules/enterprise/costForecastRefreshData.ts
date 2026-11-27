import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { EnterpriseForecastRefreshSource } from '@fieldline/contracts';
import type { Tx } from '../../db/runtime';
import { enterpriseCostForecastSnapshots as snapshots } from '../../db/schema/enterpriseCostForecasts';
import { forecastRefreshRevisions as rules } from '../../db/schema/enterpriseForecastRefresh';
import { enqueue } from '../../jobs/outbox';

type Scope = { orgId: string; projectId: string };
type Kind = z.infer<typeof EnterpriseForecastRefreshSource>['kind'];

export function currentForecastRefreshRules(tx: Tx, scope: Scope, limit: number) {
  return tx
    .select()
    .from(rules)
    .where(and(eq(rules.orgId, scope.orgId), eq(rules.projectId, scope.projectId)))
    .orderBy(desc(rules.revision))
    .limit(limit);
}

export async function latestApprovedForecast(tx: Tx, scope: Scope) {
  const [row] = await tx
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.orgId, scope.orgId), eq(snapshots.projectId, scope.projectId)))
    .orderBy(desc(snapshots.createdAt), desc(snapshots.id))
    .limit(1);
  return row;
}

type Signal = {
  kind: Kind;
  resourceId: string;
  actorUserId: string;
  effectiveOn?: string;
  correlationId: string;
};

export async function queueForecastRefresh(tx: Tx, scope: Scope, signal: Signal) {
  const [settings] = await currentForecastRefreshRules(tx, scope, 1);
  if (settings?.enabled === false || !(await latestApprovedForecast(tx, scope))) return;
  const { kind, resourceId, actorUserId, effectiveOn, correlationId } = signal;
  await enqueue(tx, {
    orgId: scope.orgId,
    task: 'forecast.refresh_requested',
    aggregateType: 'enterprise_forecast_refresh',
    aggregateId: resourceId,
    payload: {
      projectId: scope.projectId,
      kind,
      resourceId,
      actorUserId,
      effectiveOn: effectiveOn ?? null,
      settingRevision: settings?.revision ?? 0,
    },
    correlationId,
    jobKey: 'forecast.refresh_requested:' + kind + ':' + resourceId,
  });
}
