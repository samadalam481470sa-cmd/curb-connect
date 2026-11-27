import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSalesOpportunity } from '../../../../../../features/enterprise/EnterpriseSalesOpportunity';

export const metadata: Metadata = { title: 'Sales opportunity — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  if (!UuidSchema.safeParse(opportunityId).success) notFound();
  return <EnterpriseSalesOpportunity opportunityId={opportunityId.toLowerCase()} />;
}
