import type { Metadata } from 'next';
import { JobCostView } from '../../../features/builderOps/JobCostView';

export const metadata: Metadata = { title: 'Job Cost' };

export default function Page() {
  return <JobCostView />;
}
