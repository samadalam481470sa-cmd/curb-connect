import type { Metadata } from 'next';
import { EnterpriseChangeOrderDetail } from '../../../../../features/enterprise/EnterpriseChangeOrders';

export const metadata: Metadata = { title: 'Change Order — Enterprise Suite' };

export default async function Page({ params }: PageProps<'/enterprise/change-orders/[id]'>) {
  const { id } = await params;
  return <EnterpriseChangeOrderDetail id={id} />;
}
