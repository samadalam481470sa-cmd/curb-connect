import type { Metadata } from 'next';
import { AreaPage } from '../../../components/AreaPage';

export const metadata: Metadata = { title: 'Leads' };

export default function Page() {
  return <AreaPage routeId="leads" />;
}
