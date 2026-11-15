import type { Metadata } from 'next';
import { RoofWorkbenchPage } from '../../../../../../components/roof/RoofWorkbench';

export const metadata: Metadata = { title: 'Roof workbench' };

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <RoofWorkbenchPage key={reportId} reportId={reportId} />;
}
