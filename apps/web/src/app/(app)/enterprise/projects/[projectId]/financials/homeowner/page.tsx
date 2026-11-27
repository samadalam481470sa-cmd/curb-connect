import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseHomeownerFinanceSettings } from '../../../../../../../features/enterprise/EnterpriseHomeownerFinanceSettings';

export const metadata: Metadata = { title: 'Homeowner finance visibility — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  return <EnterpriseHomeownerFinanceSettings projectId={projectId.toLowerCase()} />;
}
