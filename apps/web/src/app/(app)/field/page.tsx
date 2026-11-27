import type { Metadata } from 'next';
import { FieldHomeView } from '../../../features/field/FieldHomeView';

export const metadata: Metadata = { title: 'Field' };

export default function Page() {
  return <FieldHomeView />;
}
