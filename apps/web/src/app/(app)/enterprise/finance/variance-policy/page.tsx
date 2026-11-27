import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseFinanceVariancePolicy } from '../../../../../features/enterprise/EnterpriseFinanceVariancePolicy';

export const metadata: Metadata = { title: 'Variance alert settings — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const project = UuidSchema.safeParse(query.projectId);
  const order = UuidSchema.safeParse(query.orderId);
  const scope =
    project.success && order.success
      ? { projectId: project.data.toLowerCase(), orderId: order.data.toLowerCase() }
      : undefined;
  return <EnterpriseFinanceVariancePolicy order={scope} />;
}
