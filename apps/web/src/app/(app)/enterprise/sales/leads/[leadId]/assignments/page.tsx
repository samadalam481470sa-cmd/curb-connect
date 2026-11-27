import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSalesAssignments } from '../../../../../../../features/enterprise/EnterpriseSalesAssignments';

export const metadata: Metadata = { title: 'Lead assignment — Enterprise Suite' };

export default async function Page({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  if (!UuidSchema.safeParse(leadId).success) notFound();
  return <EnterpriseSalesAssignments leadId={leadId.toLowerCase()} />;
}
