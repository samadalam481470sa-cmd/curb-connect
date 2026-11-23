import type { Metadata } from 'next';
import { HvacEstimatorView } from '../../../features/hvac/HvacEstimatorView';

export const metadata: Metadata = { title: 'HVAC' };

export default function Page() {
  return <HvacEstimatorView />;
}
