import type { Metadata } from 'next';
import { ProposalsView } from '../../../features/proposals/ProposalsView';

export const metadata: Metadata = { title: 'Proposals' };

export default function Page() {
  return <ProposalsView />;
}
