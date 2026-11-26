import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseJobsiteMedia } from '../../../../../../features/enterprise/EnterpriseJobsiteMedia';

export const metadata: Metadata = { title: 'Jobsite media — Enterprise Suite' };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ evidenceTask?: string | string[] }>;
}) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  const task = UuidSchema.safeParse((await searchParams).evidenceTask);
  return (
    <EnterpriseJobsiteMedia
      projectId={projectId.toLowerCase()}
      initialEvidenceTaskId={task.success ? task.data.toLowerCase() : undefined}
    />
  );
}
