import type { Metadata } from 'next';
import { RouteGate } from '../../../../components/RouteGate';
import { ProjectWizard } from '../../../../components/curb/ProjectWizard';

export const metadata: Metadata = { title: 'New curb project' };

export default function Page() {
  return (
    <RouteGate routeId="curb.new">
      <ProjectWizard />
    </RouteGate>
  );
}
