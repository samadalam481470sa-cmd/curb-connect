import type { Metadata } from 'next';
import { EnterpriseSuiteView } from '../../../../features/enterprise/EnterpriseSuiteView';

export const metadata: Metadata = { title: 'Bim — Enterprise Suite' };
export default function Page() { return <EnterpriseSuiteView area="bim" />; }
