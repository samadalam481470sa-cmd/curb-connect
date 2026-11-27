import type { Metadata } from 'next';
import { RouteGate } from '../../../../../components/RouteGate';
import { EnterpriseSalesLeads } from '../../../../../features/enterprise/EnterpriseSalesLeads';

export const metadata: Metadata = { title: 'Sales leads — Enterprise Suite' };

export default function Page() {
  return (
    <RouteGate routeId="enterprise.salesLeads">
      <EnterpriseSalesLeads />
    </RouteGate>
  );
}
