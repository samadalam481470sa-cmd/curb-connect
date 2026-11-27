import { SalesStageKey } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { EnterpriseSalesPipeline } from '../../../../../features/enterprise/EnterpriseSalesPipeline';

export const metadata: Metadata = { title: 'Sales pipeline — Enterprise Suite' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const { stage } = await searchParams;
  const selected = SalesStageKey.safeParse(stage);
  return <EnterpriseSalesPipeline stageFilter={selected.success ? selected.data : null} />;
}
