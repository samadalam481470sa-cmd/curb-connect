'use client';

// /curb/projects/:projectId/capture (CV-043, PLT-018): the phone-first capture screen on its own.
import { ButtonLink, PageHeader } from '../common';
import { RouteGate } from '../RouteGate';
import { CaptureShotList } from './CaptureShotList';
import { AutosaveStatus } from './CurbCommon';
import { CurbProjectProvider, useCurbProject } from './useCurbProject';

export function CurbCaptureView({ projectId }: { projectId: string }) {
  return (
    <RouteGate routeId="curb.capture">
      <CurbProjectProvider projectId={projectId}>
        <Content />
      </CurbProjectProvider>
    </RouteGate>
  );
}

function Content() {
  const { detail, projectId, save, retry, reload } = useCurbProject();
  return (
    <div className="curb-root">
      <PageHeader
        title={detail ? `Capture: project ${detail.project.number}` : 'Photo capture'}
        actions={
          <>
            <AutosaveStatus state={save} onRetry={() => void retry()} onReload={reload} />
            <ButtonLink href={`/curb/projects/${projectId}?tab=measure`} variant="secondary">
              Done, go to calibration
            </ButtonLink>
          </>
        }
      />
      <CaptureShotList />
    </div>
  );
}
