import type { Metadata } from 'next';
import { BiddingWorkspace } from '../../../features/jobs/JobsBidding';

export const metadata: Metadata = { title: 'Bidding' };
export default function Page(){ return <BiddingWorkspace/>; }
