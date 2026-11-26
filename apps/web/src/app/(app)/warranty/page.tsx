import type { Metadata } from 'next';
import { WarrantyView } from '../../../features/builderOps/WarrantyView';

export const metadata: Metadata = { title: 'Warranty & Service' };

export default function Page() {
  return <WarrantyView />;
}
