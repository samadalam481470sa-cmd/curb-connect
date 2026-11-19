import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { RoofWorkspace } from '../../../../features/roof/RoofWorkspace';

export const metadata: Metadata = { title: `${BRAND.products.roof} · Order` };

export default async function Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <RoofWorkspace orderId={orderId} />;
}
