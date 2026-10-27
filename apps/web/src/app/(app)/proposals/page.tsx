import type { Metadata } from 'next';
import { AreaPage } from '../../../components/AreaPage';

export const metadata: Metadata = { title: 'Proposals' };

export default function Page() {
  return <AreaPage routeId="proposals" />;
}
