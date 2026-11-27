import type { Metadata } from 'next';
import { EnterpriseSalesProposalTemplates } from '../../../../../features/enterprise/EnterpriseSalesProposalTemplates';

export const metadata: Metadata = { title: 'Sales proposal templates — Enterprise Suite' };
export default function Page() {
  return <EnterpriseSalesProposalTemplates />;
}
