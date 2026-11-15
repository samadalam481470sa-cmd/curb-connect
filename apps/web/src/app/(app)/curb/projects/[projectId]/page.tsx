import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CurbProjectView } from '../../../../../components/curb/CurbProjectView';

export const metadata: Metadata = { title: 'Curb project' };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <Suspense fallback={<p className="web-muted">Loading project…</p>}>
      <CurbProjectView projectId={projectId} />
    </Suspense>
  );
}
