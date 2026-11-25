import type { Metadata } from 'next';
import { EnterpriseChangeOrderQueue } from '../../../../../../features/enterprise/EnterpriseChangeOrders';

export const metadata: Metadata = { title: 'Project Change Orders — Enterprise Suite' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/enterprise/projects/[projectId]/change-orders'>) {
  const { projectId } = await params;
  const { cursor, status, search } = await searchParams;
  return (
    <EnterpriseChangeOrderQueue
      projectId={projectId}
      cursor={cursor}
      status={status}
      search={search}
    />
  );
}
