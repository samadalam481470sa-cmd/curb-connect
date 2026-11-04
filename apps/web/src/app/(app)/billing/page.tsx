import type { Metadata } from 'next';
import { BillingView } from '../../../features/billing/BillingView';

export const metadata: Metadata = { title: 'Billing' };

export default function Page() {
  return <BillingView />;
}
