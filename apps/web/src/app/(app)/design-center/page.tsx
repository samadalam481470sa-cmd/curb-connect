import type { Metadata } from 'next';
import { DesignCenterView } from '../../../features/builderOps/DesignCenterView';

export const metadata: Metadata = { title: 'Design Center' };

export default function Page() {
  return <DesignCenterView />;
}
