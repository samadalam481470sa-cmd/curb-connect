import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSuiteView } from '../../../../../../features/enterprise/EnterpriseSuiteView';

export const metadata: Metadata = { title: 'Project estimate — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  return <EnterpriseSuiteView area="estimating" fixedProjectId={projectId} />;
}
