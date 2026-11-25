import type { Metadata } from 'next';
import { CustomersView } from '../../../features/customers/CustomersView';

export const metadata: Metadata = { title: 'Customers' };

export default function Page() {
  return <CustomersView />;
}
