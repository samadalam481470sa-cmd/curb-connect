import type { Metadata } from 'next';
import { EnterpriseSuiteView } from '../../../../features/enterprise/EnterpriseSuiteView';

export const metadata: Metadata = { title: 'Costing — Enterprise Suite' };
export default function Page() { return <EnterpriseSuiteView area="costing" />; }
