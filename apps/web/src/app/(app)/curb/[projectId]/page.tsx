import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { CurbWorkspace } from '../../../../features/curb/CurbWorkspace';

export const metadata: Metadata = { title: `${BRAND.products.curb} · Project` };

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <CurbWorkspace projectId={projectId} />;
}
