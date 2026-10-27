import type { Metadata } from 'next';
import { AreaPage } from '../../../components/AreaPage';

export const metadata: Metadata = { title: 'Billing' };

export default function Page() {
  return <AreaPage routeId="billing" />;
}
