import type { Metadata } from 'next';
import { PermitJobSearch } from '../../../features/permitJobs/PermitJobSearch';

export const metadata: Metadata = { title: 'Permit Job Search' };
export default function Page() {
  return <PermitJobSearch />;
}
