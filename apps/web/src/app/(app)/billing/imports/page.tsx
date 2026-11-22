import type { Metadata } from 'next';
import { RouteGate } from '../../../../components/RouteGate';
import { InvoiceIntelligence } from '../../../../features/billing/InvoiceIntelligence';

export const metadata: Metadata = { title: 'Invoice import' };

export default function Page() {
  return (
    <RouteGate routeId="billing.imports">
      <InvoiceIntelligence />
    </RouteGate>
  );
}
