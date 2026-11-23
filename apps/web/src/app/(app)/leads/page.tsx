import type { Metadata } from 'next';
import { RouteGate } from '../../../components/RouteGate';
import { PermitJobSearch } from '../../../features/permitJobs/PermitJobSearch';

// Same unified permit search as /permit-jobs (the canonical screen), kept behind
// this route's RouteGate (crm.leads / lead:read) so gating is unchanged.
export const metadata: Metadata = { title: 'Permit Job Search' };

export default function Page() {
  return (
    <RouteGate routeId="leads">
      <PermitJobSearch />
    </RouteGate>
  );
}
