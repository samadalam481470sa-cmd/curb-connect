import type { Metadata } from 'next';
import { ProjectControlsView } from '../../../../../features/enterprise/ProjectControlsView';

export const metadata: Metadata = { title: 'Project RFIs & change orders' };

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectControlsView projectId={projectId} />;
}
