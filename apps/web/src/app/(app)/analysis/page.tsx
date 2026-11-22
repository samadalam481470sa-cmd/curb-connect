import type { Metadata } from 'next';
import { RouteGate } from '../../../components/RouteGate';
import { AnalysisView } from '../../../features/billing/AnalysisView';

export const metadata: Metadata = { title: 'Analysis' };

export default function Page() {
  return (
    <RouteGate routeId="analysis">
      <AnalysisView />
    </RouteGate>
  );
}
