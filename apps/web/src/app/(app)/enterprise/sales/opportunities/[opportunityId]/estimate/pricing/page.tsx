import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EnterpriseSalesEstimatePricing } from '../../../../../../../../features/enterprise/EnterpriseSalesEstimatePricing';

export const metadata: Metadata = { title: 'Sales estimate pricing — Enterprise Suite' };
export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  if (!UuidSchema.safeParse(opportunityId).success) notFound();
  return <EnterpriseSalesEstimatePricing opportunityId={opportunityId.toLowerCase()} />;
}
