import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseCostForecastSnapshots as forecasts } from '../../db/schema/enterpriseCostForecasts';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifyCostForecast(
  tx: Tx,
  scope: { orgId: string; projectId: string; forecastId: string; eventId: string },
) {
  const [record] = await tx
    .select({ membershipId: memberships.id, status: forecasts.status })
    .from(forecasts)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, scope.orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, scope.orgId),
        eq(memberships.userId, forecasts.createdByUserId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    )
    .where(
      and(
        eq(forecasts.orgId, scope.orgId),
        eq(forecasts.projectId, scope.projectId),
        eq(forecasts.id, scope.forecastId),
      ),
    );
  if (!record) return;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: record.membershipId,
    title:
      record.status === 'complete'
        ? 'Project cost forecast saved'
        : 'Project cost forecast needs estimates',
    category: 'system',
    link: '/enterprise/projects/' + scope.projectId + '/budget#cost-forecasts',
    dedupeKey: 'forecast.snapshot_created:' + scope.forecastId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
