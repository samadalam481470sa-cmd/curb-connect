import type { Metadata } from 'next';
import { AssignmentsView } from '../../../features/builderOps/AssignmentsView';

export const metadata: Metadata = { title: 'Assignments' };

export default function Page() {
  return <AssignmentsView />;
}
