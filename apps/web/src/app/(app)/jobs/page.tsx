import type { Metadata } from 'next';
import { AreaPage } from '../../../components/AreaPage';

export const metadata: Metadata = { title: 'Jobs' };

export default function Page() {
  return <AreaPage routeId="jobs" />;
}
