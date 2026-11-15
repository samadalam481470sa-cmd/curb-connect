'use client';

// /curb/projects/:projectId/estimates/:estimateId (CP-052, CP-058, CP-059): one estimate with the
// non-dismissible preliminary banner, range, lines, unknowns, and the approval / dispatch gates.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orgKey, useSession } from '../../lib/session';
import { ButtonLink, ErrorNotice, PageHeader } from '../common';
import { RouteGate } from '../RouteGate';
import { ApprovalPanel } from './ApprovalPanel';
import { EstimateView } from './EstimateView';
import { CurbProjectProvider, useCurbProject } from './useCurbProject';

export function CurbEstimatePage({ projectId, estimateId }: { projectId: string; estimateId: string }) {
  return (
    <RouteGate routeId="curb.estimate">
      <CurbProjectProvider projectId={projectId}>
        <Content estimateId={estimateId} />
      </CurbProjectProvider>
    </RouteGate>
  );
}

function Content({ estimateId }: { estimateId: string }) {
  const { curb, projectId } = useCurbProject();
  const session = useSession();
  const qc = useQueryClient();
  const key = orgKey(session.orgId, 'curb', 'estimate', estimateId);
  const q = useQuery({ queryKey: key, queryFn: () => curb.estimate(estimateId) });
  return (
    <div className="curb-root">
      <PageHeader title={q.data ? `Curb estimate ${q.data.number}` : 'Curb estimate'} actions={<ButtonLink href={`/curb/projects/${projectId}?tab=estimate`} variant="secondary">Back to project</ButtonLink>} />
      {q.error && <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <EstimateView estimate={q.data} />}
      {q.data && (
        <ApprovalPanel
          estimate={q.data}
          onTab={(t) => window.location.assign(`/curb/projects/${projectId}?tab=${t}`)}
          onApproved={() => void qc.invalidateQueries({ queryKey: key })}
        />
      )}
    </div>
  );
}
