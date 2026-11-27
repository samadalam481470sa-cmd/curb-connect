import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseProjectBudget } from '../../../../../../features/enterprise/EnterpriseProjectBudget';

export const metadata: Metadata = { title: 'Project financials — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  return <EnterpriseProjectBudget projectId={projectId.toLowerCase()} financials />;
}
