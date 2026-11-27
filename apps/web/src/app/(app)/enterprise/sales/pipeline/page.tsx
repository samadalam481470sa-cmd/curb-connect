import {
  SalesPipelineColumns,
  SalesPipelineFilterFields,
  SalesPipelineFilters,
} from '@fieldline/contracts';
import type { Metadata } from 'next';
import { z } from 'zod';
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
  const requestedView = z.uuid().safeParse(query.view);
  const requestedColumns =
    typeof query.columns === 'string'
      ? SalesPipelineColumns.safeParse(query.columns === 'none' ? [] : query.columns.split(','))
      : undefined;
  return (
    <EnterpriseSalesPipeline
      filters={filters.success ? filters.data : null}
      viewId={requestedView.success ? requestedView.data : undefined}
      columns={requestedColumns?.success ? requestedColumns.data : undefined}
    />
  );
}
