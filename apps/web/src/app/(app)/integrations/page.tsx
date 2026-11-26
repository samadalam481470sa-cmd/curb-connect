import type { Metadata } from 'next';
import { IntegrationsView } from '../../../features/builderOps/IntegrationsView';

export const metadata: Metadata = { title: 'Integrations' };

export default function Page() {
  return <IntegrationsView />;
}
