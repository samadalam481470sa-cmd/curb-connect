import type { Metadata } from 'next';
import { LandManagementView } from '../../../features/builderOps/LandManagementView';

export const metadata: Metadata = { title: 'Land Management' };

export default function Page() {
  return <LandManagementView />;
}
