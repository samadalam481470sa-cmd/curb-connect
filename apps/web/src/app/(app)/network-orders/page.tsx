import type { Metadata } from 'next';
import { NetworkOrdersView } from '../../../features/builderOps/NetworkOrdersView';

export const metadata: Metadata = { title: 'Network Orders' };

export default function Page() {
  return <NetworkOrdersView />;
}
