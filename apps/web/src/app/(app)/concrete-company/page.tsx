import type { Metadata } from 'next';
import { ConcreteCompanyWorkspace } from '../../../features/concrete/ConcreteCompanyWorkspace';

export const metadata: Metadata = {
  title: 'Concrete Company | Curb Connect',
  description: 'Ready-mix fleet, driver, dispatch, quality and concrete operations management.',
};

export default function ConcreteCompanyPage() {
  return <ConcreteCompanyWorkspace />;
}
