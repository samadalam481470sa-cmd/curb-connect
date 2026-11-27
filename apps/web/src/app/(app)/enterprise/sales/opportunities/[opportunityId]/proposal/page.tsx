import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSalesProposal } from '../../../../../../../features/enterprise/EnterpriseSalesProposal';

export const metadata: Metadata = { title: 'Sales proposal — Enterprise Suite' };
export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  if (!UuidSchema.safeParse(opportunityId).success) notFound();
  return <EnterpriseSalesProposal opportunityId={opportunityId.toLowerCase()} />;
}
