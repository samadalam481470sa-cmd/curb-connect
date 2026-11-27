import type { Metadata } from 'next';
import { RequisitionsView } from '../../../features/requisitions/RequisitionsView';

export const metadata: Metadata = { title: 'Requisitions' };

export default function Page() {
  return <RequisitionsView />;
}
