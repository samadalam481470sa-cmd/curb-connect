import { SalesPipelineFilterFields, SalesPipelineFilters } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseSalesReports } from '../../../../../features/enterprise/EnterpriseSalesReports';

export const metadata: Metadata = { title: 'Sales reports — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filters = SalesPipelineFilters.safeParse(
    Object.fromEntries(
      Object.keys(SalesPipelineFilterFields.shape).map((key) => [key, query[key] || undefined]),
    ),
  );
  return <EnterpriseSalesReports filters={filters.success ? filters.data : null} />;
}
