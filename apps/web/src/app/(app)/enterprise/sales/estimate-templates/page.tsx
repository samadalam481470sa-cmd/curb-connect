import type { Metadata } from 'next';
import { EnterpriseSalesEstimateTemplates } from '../../../../../features/enterprise/EnterpriseSalesEstimateTemplates';

export const metadata: Metadata = { title: 'Sales estimate templates — Enterprise Suite' };
export default function Page() {
  return <EnterpriseSalesEstimateTemplates />;
}
