'use client';

import { getRoute, type RouteId } from '@fieldline/contracts';
import { ComingSoon, PageHeader } from './common';
import { RouteGate } from './RouteGate';

/** What each not-yet-built area will do, stated plainly (no sample records, STR-005). */
export const AREA_SUMMARIES: Partial<Record<RouteId, string>> = {
  roof: 'Roof Measurements will let you confirm a building, sketch each roof facet with its pitch, review quantities and issue a measurement report.',
  curb: 'Curb Cutting will guide job-site photo capture, reference calibration and field dimensions, and produce clearly preliminary low/base/high estimates with permit and utility gates.',
  leads: 'Leads will collect new enquiries and convert them into customers and jobs.',
  jobs: 'Jobs will track every job through your pipeline, including dispatch readiness checks.',
  proposals: 'Proposals will turn approved estimates into customer proposals with e-signature.',
  billing: 'Billing will issue invoices from accepted proposals and record payments.',
  reports: 'Reports will show KPIs derived from audited events, with their baselines and targets.',
  'settings.price_books':
    'Price books will hold your regional, versioned rates. Approved revisions are immutable.',
};

export function AreaPage({ routeId }: { routeId: RouteId }) {
  const route = getRoute(routeId);
  return (
    <RouteGate routeId={routeId}>
      <PageHeader title={route.label} />
      <ComingSoon
        area={route.label}
        summary={AREA_SUMMARIES[routeId] ?? ''}
        requirementIds={route.requirementIds}
      />
    </RouteGate>
  );
}
