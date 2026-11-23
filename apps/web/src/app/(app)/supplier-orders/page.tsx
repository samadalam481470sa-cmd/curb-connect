import type { Metadata } from 'next';
import { SupplierOrdersView } from '../../../features/jobs/SupplierOrdersView';

export const metadata: Metadata = { title: 'Supplier Orders' };

export default function Page() {
  return <SupplierOrdersView />;
}
