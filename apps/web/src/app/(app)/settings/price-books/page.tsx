import type { Metadata } from 'next';
import { AreaPage } from '../../../../components/AreaPage';

export const metadata: Metadata = { title: 'Price books' };

export default function Page() {
  return <AreaPage routeId="settings.price_books" />;
}
