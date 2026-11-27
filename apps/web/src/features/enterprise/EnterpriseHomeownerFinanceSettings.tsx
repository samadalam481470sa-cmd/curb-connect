'use client';

import {
  HomeownerFinanceVisibilityPreview,
  PreviewHomeownerFinanceVisibility,
  ProjectHomeownerFinanceReceipt,
  ProjectHomeownerFinanceSettings,
  SetHomeownerFinanceVisibility,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Settings = z.infer<typeof ProjectHomeownerFinanceSettings>;

export function EnterpriseHomeownerFinanceSettings({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'homeowner-finance', projectId);
  const target = '/v1/enterprise/projects/' + projectId + '/financials/homeowner';
  const allowed = session.can('enterprise_budget:manage_grants');
  const view = useQuery({
    queryKey: key,
    enabled: allowed,
    refetchOnMount: 'always',
    queryFn: () => api.get(target, { schema: ProjectHomeownerFinanceSettings }),
  });
  const denied =
    !allowed || (isApiError(view.error) && [401, 403, 404].includes(view.error.status));
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href={'/enterprise/projects/' + projectId + '/financials'}>← Project financials</Link>
        <h1>Homeowner finance visibility</h1>
        {!denied && view.data && <p>{view.data.projectName}</p>}
      </header>
      {denied && <p role="alert">These finance settings are unavailable.</p>}
      {!denied && view.isPending && <Skeleton variant="card" label="Loading finance visibility" />}
      {!denied && view.isError && (
        <section className="enterprise-panel" role="alert">
          <p>{errorHint(view.error)}</p>
          {isApiError(view.error) && <p>Support reference {view.error.correlationId}</p>}
          <button type="button" onClick={() => void view.refetch()}>
            Retry finance visibility
          </button>
        </section>
      )}
      {!denied && view.data && (
        <VisibilityForm
          target={target}
          projectId={projectId}
          data={view.data}
          refresh={() => void client.invalidateQueries({ queryKey: key })}
        />
      )}
    </main>
  );
}

function VisibilityForm({
  target,
  projectId,
  data,
  refresh,
}: {
  target: string;
  projectId: string;
  data: Settings;
  refresh: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const [selectionId, setSelection] = useState('');
  const [cost, setCost] = useState(false);
  const [margin, setMargin] = useState(false);
  const [expires, setExpires] = useState('30');
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(data.current?.revision ?? 0);
  const [confirmed, setConfirmed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const accepted = data.eligibleContracts.find(({ versionId }) => versionId === selectionId);
  const currentVersion = data.current?.revision ?? 0;
  const stale = currentVersion > version;
  const money = (minor: number | string, currency: string) =>
    formatMinorUnits(BigInt(minor), currency, me.user.locale);

  function selectedSource() {
    if (!accepted) throw new Error('Choose an accepted proposal for an assigned contact.');
    return PreviewHomeownerFinanceVisibility.parse({
      contactId: accepted.contactId,
      acceptedProposalId: accepted.id,
      acceptedProposalVersionId: accepted.versionId,
      discloseInternalCost: cost,
      discloseMargin: margin,
      expiresInDays: Number(expires),
    });
  }

  const preview = useMutation({
    mutationFn: () =>
      api.post(target + '/preview', selectedSource(), {
        schema: HomeownerFinanceVisibilityPreview,
      }),
  });
  const save = useMutation({
    mutationFn: () => {
      if (!closing && (!preview.data || !confirmed))
        throw new Error('Review and confirm the selected contractual disclosure.');
      const command = closing
        ? { enabled: false, reason }
        : {
            ...selectedSource(),
            enabled: true,
            contractDisclosureConfirmed: confirmed,
            reason,
            previewFingerprint: preview.data?.previewFingerprint,
          };
      const signature = JSON.stringify([version, command]);
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, id: crypto.randomUUID() };
      const input = SetHomeownerFinanceVisibility.safeParse({
        ...command,
        clientRequestId: receipt.current.id,
      });
      if (!input.success)
        throw new Error(
          input.error.issues[0]?.message ?? 'Review the finance visibility settings.',
        );
      return api.put(target, input.data, {
        ifMatch: version,
        schema: ProjectHomeownerFinanceReceipt,
      });
    },
    onSuccess: (saved) => {
      setVersion(saved.revision);
      setStatus(
        saved.enabled ? 'Finance link published.' : 'Homeowner finance visibility turned off.',
      );
      setReason('');
      setClosing(false);
      setConfirmed(false);
      preview.reset();
      refresh();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 412) refresh();
    },
  });
  const busy = save.isPending || preview.isPending;
  function clearPreview() {
    preview.reset();
    setConfirmed(false);
    setStatus('');
  }

  return (
    <div className="enterprise-stack">
      <section className="enterprise-panel" aria-label="Current finance visibility">
        <h2>Current finance visibility</h2>
        <p>
          {data.current?.enabled ? 'On' : 'Off'}
          {currentVersion > 0 ? ' · Version ' + currentVersion : ' · Project default'}
        </p>
        {status && <p role="status">{status}</p>}
        {data.shareUrl && (
          <div className="enterprise-media-toolbar">
            <Link href={data.shareUrl} target="_blank" rel="noreferrer">
              Open current homeowner link
            </Link>
            <button
              type="button"
              onClick={async () => {
                try {
                  if (!navigator.clipboard || !data.shareUrl) throw new Error();
                  await navigator.clipboard.writeText(data.shareUrl);
                  setStatus('Homeowner finance link copied.');
                } catch {
                  setStatus('Copy the address from the open homeowner link.');
                }
              }}
            >
              Copy current link
            </button>
          </div>
        )}
        {data.current?.enabled && !data.shareUrl && (
          <p>Review the homeowner assignment and publish a new link.</p>
        )}
        {!closing && data.current?.enabled && (
          <button
            type="button"
            onClick={() => {
              setClosing(true);
              setReason('');
              setStatus('');
            }}
          >
            Turn off homeowner finance visibility
          </button>
        )}
      </section>
      <section
        className="enterprise-panel"
        aria-label={
          closing ? 'Turn off finance visibility' : 'Publish homeowner finance visibility'
        }
      >
        {stale && (
          <div role="alert">
            <p>
              Version {currentVersion} is active. Review its scope before saving another version.
            </p>
            <button
              type="button"
              onClick={() => {
                setVersion(currentVersion);
                clearPreview();
                save.reset();
              }}
            >
              Review the current version
            </button>
          </div>
        )}
        <form
          className="enterprise-form"
          aria-label={
            closing ? 'Turn off finance visibility' : 'Publish homeowner finance visibility'
          }
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !stale) save.mutate();
          }}
        >
          {!closing && (
            <>
              <label>
                Accepted project proposal
                <select
                  disabled={busy}
                  value={selectionId}
                  onChange={(event) => {
                    clearPreview();
                    setSelection(event.target.value);
                  }}
                >
                  <option value="">Choose an accepted proposal</option>
                  {data.eligibleContracts.map((contract) => (
                    <option key={contract.versionId} value={contract.versionId}>
                      {contract.number} · {contract.title}
                    </option>
                  ))}
                </select>
              </label>
              {data.eligibleContracts.length === 0 && (
                <p>
                  Assign the project homeowner in{' '}
                  <Link href={'/enterprise/projects/' + projectId + '/media'}>Jobsite Media</Link>{' '}
                  and record their accepted proposal before publishing.
                </p>
              )}
              <label className="enterprise-finance-disclosure-choice">
                <input
                  type="checkbox"
                  checked={cost}
                  disabled={busy}
                  onChange={(event) => {
                    clearPreview();
                    setCost(event.target.checked);
                  }}
                />
                Include approved internal posted cost
              </label>
              <label className="enterprise-finance-disclosure-choice">
                <input
                  type="checkbox"
                  checked={margin}
                  disabled={busy}
                  onChange={(event) => {
                    clearPreview();
                    setMargin(event.target.checked);
                  }}
                />
                Include approved forecast margin
              </label>
              <label>
                Link expires after days
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={expires}
                  disabled={busy}
                  onChange={(event) => {
                    clearPreview();
                    setExpires(event.target.value);
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy || Boolean(stale) || !accepted}
                onClick={() => preview.mutate()}
              >
                Preview allowed figures
              </button>
              {preview.isError && <p role="alert">{errorHint(preview.error)}</p>}
              {preview.data && (
                <section aria-label="Homeowner finance preview">
                  <h2>Homeowner finance preview</h2>
                  <p>
                    {preview.data.recipientName} · {preview.data.proposalNumber} · Version{' '}
                    {preview.data.proposalVersion}
                  </p>
                  <dl>
                    <dt>Accepted contract total</dt>
                    <dd>
                      {money(
                        preview.data.disclosure.contractMinor,
                        preview.data.disclosure.currency,
                      )}
                    </dd>
                    {preview.data.disclosure.approvedInternalCostMinor !== undefined && (
                      <>
                        <dt>Approved posted project cost</dt>
                        <dd>
                          {money(
                            preview.data.disclosure.approvedInternalCostMinor,
                            preview.data.disclosure.currency,
                          )}
                        </dd>
                      </>
                    )}
                    {preview.data.disclosure.approvedMarginMinor !== undefined && (
                      <>
                        <dt>Approved forecast margin</dt>
                        <dd>
                          {money(
                            preview.data.disclosure.approvedMarginMinor,
                            preview.data.disclosure.currency,
                          )}
                        </dd>
                      </>
                    )}
                  </dl>
                </section>
              )}
              {preview.data && (
                <label className="enterprise-finance-disclosure-choice">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  The accepted contract permits sharing these selected figures
                </label>
              )}
            </>
          )}
          <label>
            Reason
            <textarea
              value={reason}
              minLength={3}
              maxLength={1000}
              required
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {save.isError && <p role="alert">{errorHint(save.error)}</p>}
          <button
            type="submit"
            disabled={
              busy ||
              stale ||
              reason.trim().length < 3 ||
              (!closing && (!preview.data || !confirmed))
            }
          >
            {closing ? 'Save visibility off' : 'Publish homeowner finance link'}
          </button>
          {closing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setClosing(false);
                setReason('');
              }}
            >
              Cancel
            </button>
          )}
        </form>
      </section>
      {data.history.length > 0 && (
        <section className="enterprise-panel" aria-label="Finance visibility history">
          <h2>Finance visibility history</h2>
          <ol className="enterprise-change-history">
            {data.history.map((item) => (
              <li key={item.id}>
                <strong>
                  Version {item.revision} · {item.enabled ? 'On' : 'Off'}
                </strong>
                <p>{item.reason}</p>
                <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
