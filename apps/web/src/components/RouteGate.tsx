'use client';

import { getRoute, type RouteId } from '@fieldline/contracts';
import { EmptyState } from '@fieldline/ui';
import { useEffect, type ReactNode } from 'react';
import { trackView } from '../lib/analytics';
import { FLAG_OFF_REASON } from '../lib/navigation';
import { useSession } from '../lib/session';
import { PageHeader } from './common';

/**
 * Page-level gate from the route registry: the member's permission and the org's feature flag.
 * A direct link to a page the role cannot open explains why instead of rendering it (PLT-011 G
 * "direct-link entry", PLT-015 A). The API still refuses the data either way.
 */
export function RouteGate({ routeId, children }: { routeId: RouteId; children: ReactNode }) {
  const route = getRoute(routeId);
  const session = useSession();
  const permission = session.check(route.permission);
  const flagOn = !route.featureFlag || session.flag(route.featureFlag);

  useEffect(() => {
    if (permission.allowed && flagOn) trackView(route.analyticsEvent, { routeId: route.id });
  }, [permission.allowed, flagOn, route.analyticsEvent, route.id]);

  if (!permission.allowed) {
    return (
      <>
        <PageHeader title={route.label} />
        <EmptyState
          tone="denied"
          title={`You cannot open ${route.label}`}
          description={permission.reason}
        />
      </>
    );
  }
  if (!flagOn) {
    return (
      <>
        <PageHeader title={route.label} />
        <EmptyState
          title={`${route.label} is ${FLAG_OFF_REASON}`}
          description="An owner or admin can ask for it to be enabled. Nothing is shown here until it is."
        />
      </>
    );
  }
  return <>{children}</>;
}
