import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContractorMediaPortal } from '../../../../../../../features/portal/ContractorMediaPortal';

export const metadata: Metadata = {
  title: 'Contractor job media',
  robots: 'noindex, nofollow',
};

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UuidSchema.safeParse(projectId).success) notFound();
  return <ContractorMediaPortal projectId={projectId.toLowerCase()} />;
}
