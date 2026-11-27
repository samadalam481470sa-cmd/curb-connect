import type { Metadata } from 'next';
import { EnterpriseSalesAssignmentSettings } from '../../../../../features/enterprise/EnterpriseSalesAssignmentSettings';

export const metadata: Metadata = { title: 'Sales assignment settings — Enterprise Suite' };

export default function Page() {
  return <EnterpriseSalesAssignmentSettings />;
}
