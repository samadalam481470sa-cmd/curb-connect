import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseFinanceCompliance } from '../../../../../features/enterprise/EnterpriseFinanceCompliance';

export const metadata: Metadata = { title: 'Finance compliance — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const query = await searchParams;
  const project = UuidSchema.safeParse(query.projectId);
  const projectId = project.success ? project.data.toLowerCase() : '';
  return <EnterpriseFinanceCompliance key={projectId} projectId={projectId} />;
}
