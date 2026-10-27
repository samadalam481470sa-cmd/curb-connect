import type { Metadata } from 'next';
import { AreaPage } from '../../../components/AreaPage';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return <AreaPage routeId="reports" />;
}
