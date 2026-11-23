import type { Metadata } from 'next';
import { PermitJobSearch } from '../../../features/permitJobs/PermitJobSearch';

// Canonical home of the unified Texas permit search. /leads renders the same
// screen behind its own RouteGate (crm.leads) so lead permissions still apply there.
export const metadata: Metadata = { title: 'Permit Job Search' };
export default function Page() {
  return <PermitJobSearch />;
}
