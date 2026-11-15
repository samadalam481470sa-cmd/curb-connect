import type { Metadata } from 'next';
import { CurbCaptureView } from '../../../../../../components/curb/CurbCaptureView';

export const metadata: Metadata = { title: 'Photo capture' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <CurbCaptureView projectId={projectId} />;
}
