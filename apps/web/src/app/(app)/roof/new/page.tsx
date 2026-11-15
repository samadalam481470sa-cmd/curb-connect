import type { Metadata } from 'next';
import { OrderWizard } from '../../../../components/roof/OrderWizard';

export const metadata: Metadata = { title: 'New roof order' };

export default function Page() {
  return <OrderWizard />;
}
