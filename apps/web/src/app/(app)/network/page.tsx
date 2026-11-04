import type { Metadata } from 'next';
import { NetworkView } from '../../../features/network/NetworkView';

export const metadata: Metadata = { title: 'Network' };

export default function Page() {
  return <NetworkView />;
}
