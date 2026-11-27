import { SalesPipelineFilterFields, SalesPipelineFilters } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseSalesPipeline } from '../../../../../features/enterprise/EnterpriseSalesPipeline';

export const metadata: Metadata = { title: 'Sales pipeline — Enterprise Suite' };

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
  return <EnterpriseSalesPipeline filters={filters.success ? filters.data : null} />;
}
