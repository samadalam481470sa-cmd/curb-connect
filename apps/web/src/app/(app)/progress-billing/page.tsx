import type { Metadata } from 'next';
import { ProgressBillingView } from '../../../features/progressBilling/ProgressBillingView';

export const metadata: Metadata = { title: 'Progress Billing' };

export default function Page() {
  return <ProgressBillingView />;
}
