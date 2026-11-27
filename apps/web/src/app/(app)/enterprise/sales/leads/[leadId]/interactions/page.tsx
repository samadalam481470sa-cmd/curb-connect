import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSalesInteractions } from '../../../../../../../features/enterprise/EnterpriseSalesInteractions';

export const metadata: Metadata = { title: 'Lead interactions — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  if (!UuidSchema.safeParse(leadId).success) notFound();
  return <EnterpriseSalesInteractions leadId={leadId.toLowerCase()} />;
}
