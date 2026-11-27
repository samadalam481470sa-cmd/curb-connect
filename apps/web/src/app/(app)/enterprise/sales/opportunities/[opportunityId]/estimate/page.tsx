import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSalesEstimate } from '../../../../../../../features/enterprise/EnterpriseSalesEstimate';

export const metadata: Metadata = { title: 'Sales estimate — Enterprise Suite' };
export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  if (!UuidSchema.safeParse(opportunityId).success) notFound();
  return <EnterpriseSalesEstimate opportunityId={opportunityId.toLowerCase()} />;
}
