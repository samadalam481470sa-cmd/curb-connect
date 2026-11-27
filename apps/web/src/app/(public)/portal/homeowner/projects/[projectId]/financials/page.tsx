import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectHomeownerFinanceView } from '../../../../../../../features/portal/ProjectHomeownerFinanceView';

export const metadata: Metadata = {
  title: 'Shared project financials',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  return <ProjectHomeownerFinanceView projectId={projectId.toLowerCase()} />;
}
