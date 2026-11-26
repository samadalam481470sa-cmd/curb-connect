import type { Metadata } from 'next';
import { FieldInspectionsView } from '../../../features/builderOps/FieldInspectionsView';

export const metadata: Metadata = { title: 'Field Inspections' };

export default function Page() {
  return <FieldInspectionsView />;
}
