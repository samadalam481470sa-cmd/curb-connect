import type { Metadata } from 'next';
import { ElectricalEstimatorView } from '../../../features/electrical/ElectricalEstimatorView';

export const metadata: Metadata = { title: 'Electrical' };

export default function Page() {
  return <ElectricalEstimatorView />;
}
