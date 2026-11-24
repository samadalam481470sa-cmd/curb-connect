import type { Metadata } from 'next';
import { PlanToBidView } from '../../../features/planToBid/PlanToBidView';

export const metadata: Metadata = { title: 'Plan to Bid' };

export default function Page() {
  return <PlanToBidView />;
}
