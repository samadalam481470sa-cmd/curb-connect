import type { Metadata } from 'next';
import { CurbEstimatePage } from '../../../../../../../components/curb/CurbEstimatePage';

export const metadata: Metadata = { title: 'Curb estimate' };

export default async function Page({ params }: { params: Promise<{ projectId: string; estimateId: string }> }) {
  const { projectId, estimateId } = await params;
  return <CurbEstimatePage projectId={projectId} estimateId={estimateId} />;
}
