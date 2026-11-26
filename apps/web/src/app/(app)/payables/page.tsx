import type { Metadata } from 'next';
import { PayablesView } from '../../../features/builderOps/PayablesView';

export const metadata: Metadata = { title: 'Payables' };

export default function Page() {
  return <PayablesView />;
}
