'use client';

// Curb project workspace (separate from roof): Intake -> Capture -> Measure (calibration,
// segments, measurements) -> Risks & permits -> Estimate & approval. One autosave indicator for
// every command; the approval panel is always visible on the estimate tab so the blocking gate
// is never hidden.
import { getRoute } from '@fieldline/contracts';
import { StatusPill, Tabs } from '@fieldline/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '../../lib/session';
import { ErrorNotice, PageHeader } from '../common';
import { RouteGate } from '../RouteGate';
import { ApprovalPanel } from './ApprovalPanel';
import { CalibrationPanel, type PhotoRef } from './CalibrationPanel';
import { CaptureShotList } from './CaptureShotList';
import { AutosaveStatus, Panel } from './CurbCommon';
import { EstimatesPanel } from './EstimatesPanel';
import { IntakeForm } from './IntakeForm';
import { MeasurementForm } from './MeasurementForm';
import { serviceTaxon } from './model';
import { RiskPermitChecklist } from './RiskPermitChecklist';
import { SegmentEditor } from './SegmentEditor';
import { ServiceDiagram } from './ServiceDiagram';
import { CurbProjectProvider, curbKeys, useCurbProject } from './useCurbProject';

export const CURB_TABS = ['intake', 'capture', 'measure', 'risks', 'estimate'] as const;
export type CurbTab = (typeof CURB_TABS)[number];

export function CurbProjectView({ projectId }: { projectId: string }) {
  return (
    <RouteGate routeId="curb.project">
      <CurbProjectProvider projectId={projectId}>
        <ProjectContent />
      </CurbProjectProvider>
    </RouteGate>
  );
}

export function usePhotos(): PhotoRef[] {
  const { projectId, curb } = useCurbProject();
  const session = useSession();
  const q = useQuery({ queryKey: curbKeys(session.orgId, projectId).photos, queryFn: () => curb.photos(projectId) });
  return (q.data?.items ?? [])
    .filter((m) => m.kind === 'photo' && m.status !== 'deleted' && m.status !== 'rejected')
    .map((m) => ({ id: m.id, label: `${(m.viewType ?? 'photo').replace(/_/g, ' ')} · ${m.id.slice(0, 6)}`, viewUrl: m.viewUrl }));
}

function ProjectContent() {
  const { detail, detailQuery, save, retry, reload, lastError, readiness, projectId } = useCurbProject();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const photos = usePhotos();
  const raw = search?.get('tab') ?? 'intake';
  const tab: CurbTab = (CURB_TABS as readonly string[]).includes(raw) ? (raw as CurbTab) : 'intake';
  const setTab = (t: string) => router.replace(`/curb/projects/${projectId}?tab=${t}`);

  if (detailQuery.error) return <ErrorNotice error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  if (!detail) return <p className="web-muted">Loading project…</p>;
  const p = detail.project;
  const taxon = serviceTaxon(p.serviceCode);
  const openBlocking = detail.riskFlags.filter((f) => f.status === 'open' && f.severity === 'blocking').length;
  const captureAllowed = session.check(getRoute('curb.capture').permission).allowed;

  return (
    <div className="curb-root">
      <PageHeader
        title={`Curb project ${p.number}`}
        description={taxon?.summary}
        actions={<AutosaveStatus state={save} onRetry={() => void retry()} onReload={reload} error={lastError} />}
      />
      <div className="curb-summary">
        <ServiceDiagram code={p.serviceCode} title={taxon?.label ?? p.serviceCode} />
        <div>
          <p>
            <strong>{taxon?.label}</strong> <StatusPill status={p.status} />
          </p>
          <p className="web-muted">
            Right-of-way: {p.isPublicRightOfWay === null ? 'Unknown' : p.isPublicRightOfWay ? 'Public' : 'Private'} · Jurisdiction rules {p.jurisdictionRulesVersion ?? 'unresolved'}
          </p>
          <p>
            {openBlocking} blocking flag(s) open · Dispatch {readiness ? (readiness.canDispatch ? 'ready' : 'blocked') : '…'}
          </p>
        </div>
      </div>
      <Tabs
        label="Curb project sections"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'intake', label: 'Intake', panel: <Panel title="Eligibility, permit and site questions" id="intake"><IntakeForm /></Panel> },
          { value: 'capture', label: 'Capture', disabled: !captureAllowed, panel: <CaptureShotList /> },
          {
            value: 'measure',
            label: 'Measure',
            panel: (
              <>
                <CalibrationPanel photos={photos} />
                <SegmentEditor photos={photos} />
                <MeasurementForm />
              </>
            ),
          },
          { value: 'risks', label: 'Risks & permits', badge: openBlocking || undefined, panel: <RiskPermitChecklist /> },
          {
            value: 'estimate',
            label: 'Estimate',
            panel: (
              <>
                <EstimatesPanel onTab={setTab} />
                <ApprovalWithEstimate onTab={setTab} onApproved={() => void qc.invalidateQueries({ queryKey: curbKeys(session.orgId, projectId).estimates })} />
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

function ApprovalWithEstimate({ onTab, onApproved }: { onTab: (t: string) => void; onApproved: () => void }) {
  const { projectId, curb } = useCurbProject();
  const session = useSession();
  const list = useQuery({ queryKey: curbKeys(session.orgId, projectId).estimates, queryFn: () => curb.estimates(projectId) });
  return <ApprovalPanel estimate={list.data?.items[0]} onTab={onTab} onApproved={onApproved} />;
}
