import type { Metadata } from 'next';
import { EnterpriseChangeOrderQueue } from '../../../../../features/enterprise/EnterpriseChangeOrders';

export const metadata: Metadata = { title: 'Change Orders — Enterprise Suite' };

export default async function Page({ searchParams }: PageProps<'/enterprise/change-orders/queue'>) {
  const { cursor, status, search } = await searchParams;
  return <EnterpriseChangeOrderQueue cursor={cursor} status={status} search={search} />;
}
