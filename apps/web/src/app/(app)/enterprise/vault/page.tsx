import type { Metadata } from 'next';
import { EnterpriseSuiteView } from '../../../../features/enterprise/EnterpriseSuiteView';

export const metadata: Metadata = { title: 'Vault — Enterprise Suite' };
export default function Page() { return <EnterpriseSuiteView area="vault" />; }
