import type { Metadata } from 'next';
import { RouteGate } from '../../../components/RouteGate';
import { PermitJobSearch } from '../../../features/permitJobs/PermitJobSearch';

export const metadata: Metadata = { title: 'Job Leads | Texas Construction Intelligence' };

export default function Page() {
  return (
    <RouteGate routeId="leads">
      <PermitJobSearch />
    </RouteGate>
  );
}
