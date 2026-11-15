import type { Metadata } from 'next';
import { RoofOrderDetail } from '../../../../../components/roof/RoofOrders';

export const metadata: Metadata = { title: 'Roof order' };

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <RoofOrderDetail key={orderId} orderId={orderId} />;
}
