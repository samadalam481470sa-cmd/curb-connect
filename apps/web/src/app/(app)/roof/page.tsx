import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { RoofOrderList } from '../../../components/roof/RoofOrders';

export const metadata: Metadata = { title: BRAND.products.roof };

export default function Page() {
  return <RoofOrderList />;
}
