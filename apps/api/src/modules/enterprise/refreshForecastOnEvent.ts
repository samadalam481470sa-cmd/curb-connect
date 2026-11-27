import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { EnterpriseForecastRefreshSource, ForecastCostInput } from '@fieldline/contracts';
import type { Tx } from '../../db/runtime';
import {
  enterpriseProjects as projects,
  enterpriseSettings as settings,
} from '../../db/schema/enterprise';
import { enterpriseCostForecastSnapshots as forecasts } from '../../db/schema/enterpriseCostForecasts';
import { organizations } from '../../db/schema/orgs';
import { enqueue } from '../../jobs/outbox';
import { writeAudit } from '../../services/audit';
import { buildForecastBasis, loadForecastLines, writeForecastSnapshot } from './costForecastData';
import { currentForecastRefreshRules, latestApprovedForecast } from './costForecastRefreshData';

type Trigger = {
  orgId: string;
  projectId: string;
  eventId: string;
  kind: z.infer<typeof EnterpriseForecastRefreshSource>['kind'];
  resourceId: string;
  actorUserId: string;
  effectiveOn: string | null;
  settingRevision: number;
};

export async function refreshForecastForApprovedEvent(tx: Tx, trigger: Trigger, ipSecret: string) {
  const { orgId, projectId, eventId } = trigger;
  const scope = { orgId, projectId };
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
    .for('update');
  if (!project) return;
  const [enabled] = await tx
    .select({ active: settings.enabled })
    .from(settings)
    .where(eq(settings.orgId, orgId));
  if (!enabled?.active) return;
  const [rule] = await currentForecastRefreshRules(tx, scope, 1);
  if (rule?.enabled === false || (rule?.revision ?? 0) !== trigger.settingRevision) return;

  const [receipt] = await tx
    .select({ id: forecasts.id })
    .from(forecasts)
    .where(
      and(
        eq(forecasts.orgId, orgId),
        eq(forecasts.projectId, projectId),
        eq(forecasts.refreshEventId, eventId),
      ),
    );
  if (receipt) return;
  const precedent = await latestApprovedForecast(tx, scope);
  const basis = await buildForecastBasis(tx, scope);
  if (!precedent || !basis || precedent.currency !== basis.budget.currency) return;

  const [companyDate] = await tx
    .select({
      today: sql<string>`(current_timestamp at time zone (case when exists (
        select 1 from pg_catalog.pg_timezone_names where name = ${organizations.timezone}
      ) then ${organizations.timezone} else 'UTC' end))::date::text`,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!companyDate) return;
  const [asOf] = [
    precedent.asOf,
    basis.budget.effectiveOn,
    companyDate.today,
    trigger.effectiveOn ?? '',
  ]
    .sort()
    .slice(-1);
  if (!asOf) return;
  const ready = await loadForecastLines(tx, scope, [precedent.id]);
  const estimates: z.infer<typeof ForecastCostInput>[] = [];
  for (const line of ready) {
    if (line.method === 'remaining_cost' && line.remainingMinor !== null)
      estimates.push({
        costCodeId: line.costCode.id,
        method: 'remaining_cost',
        remainingMinor: Number(line.remainingMinor),
      });
    if (line.method === 'percent_complete' && line.percentCompleteBps !== null)
      estimates.push({
        costCodeId: line.costCode.id,
        method: 'percent_complete',
        percentCompleteBps: line.percentCompleteBps,
      });
  }
  const saved = await writeForecastSnapshot(tx, scope, basis, {
    asOf,
    estimates,
    assumptions: precedent.assumptions,
    originalContractMinor: project.originalContractMinor,
    actorUserId: trigger.actorUserId,
    clientRequestId: eventId,
    requestHash: createHash('sha256')
      .update(JSON.stringify({ eventId, priorForecastId: precedent.id, asOf }))
      .digest('hex'),
    refresh: {
      kind: trigger.kind,
      resourceId: trigger.resourceId,
      sourceEventId: eventId,
      priorForecastId: precedent.id,
    },
  });
  await writeAudit(
    tx,
    { actorUserId: null, correlationId: eventId, ip: undefined, userAgent: undefined, ipSecret },
    {
      orgId,
      resourceType: 'enterprise_cost_forecast',
      resourceId: saved.id,
      action: 'forecast.snapshot_refreshed',
      before: { forecastId: precedent.id },
      after: saved,
    },
  );
  await enqueue(tx, {
    orgId,
    task: 'forecast.snapshot_created',
    aggregateType: 'enterprise_cost_forecast',
    aggregateId: saved.id,
    payload: { projectId, forecastId: saved.id },
    correlationId: eventId,
    jobKey: 'forecast.snapshot_created:' + saved.id,
  });
}
