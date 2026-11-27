import { SalesPipelineFilters } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseSalesReports } from '../../../../../features/enterprise/EnterpriseSalesReports';

export const metadata: Metadata = { title: 'Sales reports — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stage, sourceId, communityId, ownerMembershipId, search } = await searchParams;
  const filters = SalesPipelineFilters.safeParse({
    stage,
    sourceId,
    communityId,
    ownerMembershipId,
    search,
  });
  return <EnterpriseSalesReports filters={filters.success ? filters.data : null} />;
}
