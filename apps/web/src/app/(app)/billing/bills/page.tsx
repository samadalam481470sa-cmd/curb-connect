import type { Metadata } from 'next';
import { BillingView } from '../../../../features/billing/BillingView';

export const metadata: Metadata = { title: 'Bills received' };

export default function Page() {
  return <BillingView routeId="billing.bills" />;
}
