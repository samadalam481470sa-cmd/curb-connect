import type { Metadata } from 'next';
import { BuildEstimatorView } from '../../../features/build/BuildEstimatorView';

export const metadata: Metadata = { title: 'House Builder' };

export default function Page() {
  return <BuildEstimatorView />;
}
