import type { Metadata } from 'next';
import { PlumbingEstimatorView } from '../../../features/plumbing/PlumbingEstimatorView';

export const metadata: Metadata = { title: 'Plumbing' };

export default function Page() {
  return <PlumbingEstimatorView />;
}
