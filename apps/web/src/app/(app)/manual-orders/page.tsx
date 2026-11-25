import type { Metadata } from 'next';
import { ManualOrdersView } from '../../../features/jobs/ManualOrdersView';

export const metadata: Metadata = { title: 'Manual Orders' };

export default function Page() {
  return <ManualOrdersView />;
}
