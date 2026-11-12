'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { ErrorNotice, PageHeader } from '../../components/common';
import { ChangeOrderPipeline } from '../../components/enterprise/ChangeOrderPipeline';
import { RFITracker } from '../../components/enterprise/RFITracker';
import { useProjectControls } from '../../hooks/useProjectControls';
import { isApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { UUID_PATTERN } from '../../types/enterprise';

/** Project selector does not invent jobs or read data without a known project identifier. */
export function EnterpriseLanding() {
  return (
    <RouteGate routeId="enterprise">
      <EnterpriseSelector />
    </RouteGate>
  );
}

function EnterpriseSelector() {
  const router = useRouter();
  const [id, setId] = useState('');
  const valid = UUID_PATTERN.test(id.trim());

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid) router.push(`/enterprise/projects/${encodeURIComponent(id.trim())}`);
  };

  return (
    <>
      <PageHeader
        title="Commercial project controls"
        description="Track project RFIs, potential change orders and approval decisions."
      />
      <section className="ec-panel ec-selector" aria-labelledby="ec-select-heading">
        <h2 id="ec-select-heading">Open a project</h2>
        <p className="web-muted">
          Enter the ID of an existing project. Project discovery will be added when the
          commercial project API is available.
        </p>
        <form onSubmit={submit} className="ec-selector__form">
          <label className="ec-field">
            <span>Project ID</span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              aria-describedby="ec-project-help"
            />
          </label>
          <button type="submit" className="ec-button ec-button--primary" disabled={!valid}>
            Open controls
          </button>
        </form>
        <p id="ec-project-help" className="ec-hint">A valid project UUID is required.</p>
      </section>
    </>
  );
}

export function ProjectControlsView({ projectId }: { projectId: string }) {
  return (
    <RouteGate routeId="enterprise.project">
      {UUID_PATTERN.test(projectId) ? (
        <ProjectControlsContent projectId={projectId} />
      ) : (
        <>
          <PageHeader title="Commercial project controls" />
          <p role="alert" className="ec-error">Invalid project ID.</p>
        </>
      )}
    </RouteGate>
  );
}

function ProjectControlsContent({ projectId }: { projectId: string }) {
  const session = useSession();
  const {
    rfis,
    changeOrders,
    loading,
    error,
    actionError,
    rfiPendingId,
    coPendingId,
    updateRFIStatus,
    updateCOStatus,
    refresh,
  } = useProjectControls(projectId);

  const apiMissing = isApiError(error) && error.status === 404;

  return (
    <div className="ec-workspace">
      <PageHeader
        title="Project RFI & change order controls"
        description={<>Project <code>{projectId}</code></>}
        actions={<a href="/enterprise" className="ec-button ec-button--secondary">Switch project</a>}
      />
      {loading ? (
        <div className="ec-panel" role="status" aria-live="polite">Loading project controls…</div>
      ) : apiMissing ? (
        <div className="ec-panel ec-info" role="status">
          <h2>Project controls API not deployed</h2>
          <p>
            The RFI and change-order backend routes are not yet implemented. No demo records
            or approval results are being shown.
          </p>
          <button className="ec-button ec-button--secondary" type="button"
            onClick={() => void refresh()}>Try again</button>
        </div>
      ) : error ? (
        <ErrorNotice error={error} title="Could not load project controls"
          onRetry={() => void refresh()} />
      ) : (
        <>
          {actionError && (
            <div role="alert" className="ec-error">
              {actionError instanceof Error ? actionError.message : 'Unable to update project controls.'}
            </div>
          )}
          <RFITracker
            rfis={rfis}
            canRespond={session.can('job:write')}
            pendingId={rfiPendingId}
            onUpdateStatus={updateRFIStatus}
          />
          <ChangeOrderPipeline
            changeOrders={changeOrders}
            canAdvance={session.can('change_order:write')}
            canApprove={session.can('change_order:approve')}
            pendingId={coPendingId}
            onUpdateCOStatus={updateCOStatus}
          />
        </>
      )}
    </div>
  );
}
