import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseJobsiteMedia } from '../../../../../../features/enterprise/EnterpriseJobsiteMedia';

export const metadata: Metadata = { title: 'Jobsite media — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  return <EnterpriseJobsiteMedia projectId={projectId.toLowerCase()} />;
}
