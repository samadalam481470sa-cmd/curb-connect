import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { AreaPage } from '../../../components/AreaPage';

export const metadata: Metadata = { title: BRAND.products.roof };

export default function Page() {
  return <AreaPage routeId="roof" />;
}
