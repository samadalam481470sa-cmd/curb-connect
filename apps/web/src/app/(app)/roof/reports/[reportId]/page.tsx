import type { Metadata } from 'next';
import { RoofReportPage } from '../../../../../components/roof/RoofReport';

export const metadata: Metadata = { title: 'Roof report' };

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <RoofReportPage key={reportId} reportId={reportId} />;
}
