import type { Metadata } from 'next';
import { ConcreteDispatchView } from '../../../features/concrete/ConcreteDispatchView';

export const metadata: Metadata = { title: 'Concrete Dispatch' };

export default function Page() {
  return <ConcreteDispatchView />;
}
