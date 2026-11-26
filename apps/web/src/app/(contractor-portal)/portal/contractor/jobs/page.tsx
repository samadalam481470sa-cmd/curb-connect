import type { Metadata } from 'next';
import { ContractorMediaPortal } from '../../../../../features/portal/ContractorMediaPortal';

export const metadata: Metadata = {
  title: 'Assigned contractor jobs',
  robots: 'noindex, nofollow',
};

export default function Page() {
  return <ContractorMediaPortal />;
}
