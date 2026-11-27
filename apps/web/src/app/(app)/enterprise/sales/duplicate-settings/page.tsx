import type { Metadata } from 'next';
import { SalesDuplicateSettings } from '../../../../../features/enterprise/SalesDuplicateSettings';

export const metadata: Metadata = { title: 'Sales duplicate warning — Enterprise Suite' };

export default function Page() {
  return <SalesDuplicateSettings />;
}
