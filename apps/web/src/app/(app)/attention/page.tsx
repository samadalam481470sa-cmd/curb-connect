import type { Metadata } from 'next';
import { AttentionView } from '../../../features/builderOps/AttentionView';

export const metadata: Metadata = { title: 'Attention Feed' };

export default function Page() {
  return <AttentionView />;
}
