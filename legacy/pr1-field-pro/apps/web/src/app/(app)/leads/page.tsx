import type { Metadata } from 'next';
import { CustomersLeadsView } from '../../../features/customers/CustomersLeadsView';

export const metadata: Metadata = { title: 'Customers & leads' };

export default function Page() {
  return <CustomersLeadsView />;
}
