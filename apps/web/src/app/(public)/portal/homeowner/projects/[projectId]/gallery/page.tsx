import type { Metadata } from 'next';
import { JobsiteHomeownerGallery } from '../../../../../../../features/portal/JobsiteHomeownerGallery';

export const metadata: Metadata = {
  title: 'Shared project photos',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <JobsiteHomeownerGallery projectId={projectId} />;
}
