import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseCostScenarios as scenarios } from '../../db/schema/enterpriseCostScenarios';
import { memberships } from '../../db/schema/team';
import { notify } from '../../services/notifications';

export async function notifyCostScenario(
  tx: Tx,
  scope: { orgId: string; projectId: string; scenarioId: string; eventId: string },
) {
  const [record] = await tx
    .select({ membershipId: memberships.id })
    .from(scenarios)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, scope.orgId), eq(enterpriseSettings.enabled, true)),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.orgId, scope.orgId),
        eq(memberships.userId, scenarios.createdByUserId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'finance']),
      ),
    )
    .where(
      and(
        eq(scenarios.orgId, scope.orgId),
        eq(scenarios.projectId, scope.projectId),
        eq(scenarios.id, scope.scenarioId),
      ),
    );
  if (!record) return;
  await notify(tx, {
    orgId: scope.orgId,
    recipientMembershipId: record.membershipId,
    title: 'Project cost scenario saved',
    category: 'system',
    link: '/enterprise/projects/' + scope.projectId + '/budget#cost-forecasts',
    dedupeKey: 'forecast.scenario_created:' + scope.scenarioId,
    channels: ['in_app'],
    correlationId: scope.eventId,
  });
}
