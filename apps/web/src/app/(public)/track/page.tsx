import type { Metadata } from 'next';
import { JobStatusView } from '../../../features/portal/JobStatusView';

export const metadata: Metadata = {
  title: 'Job status',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return <JobStatusView />;
}
