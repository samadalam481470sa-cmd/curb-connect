import type { Metadata } from 'next';
import { EnterpriseSuiteView } from '../../../../features/enterprise/EnterpriseSuiteView';

export const metadata: Metadata = { title: 'Vendor Bidding — Enterprise Suite' };

export default function Page() {
  return <EnterpriseSuiteView area="bids" />;
}
