// Follow-Up Queue: due re-contacts for dry roofing leads, with complete / snooze
// actions and a template picker. Not wired into any page or nav yet — the dashboard
// work wires it in later.
//
// Nothing is sent from here: completing a follow-up only logs what the person did
// (outcome + note) and optionally moves the lead stage. Automation is off (see the
// banner) and templates are text to use when contacting the lead yourself.
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../../components/common';
import { errorHint, isApiError } from '../../../lib/api';
import { orgKey, useApi, useSession } from '../../../lib/session';
import {
  CALL_OUTCOMES,
  callOutcomeLabel,
  CompleteFollowUpResponseSchema,
  FOLLOW_UP_STAGE_LABELS,
  FOLLOW_UP_STAGES,
  followUpTitle,
  FollowUpListSchema,
  FollowUpTemplateListSchema,
  FUNNEL_ADVANCE_STAGES,
  ROOF_ORDER_ADVANCE_STAGES,
  SnoozeFollowUpResponseSchema,
  type CallOutcome,
  type FollowUpItem,
} from './followups';

const SNOOZE_OPTIONS = [3, 7, 14, 30];

export function FollowUpQueue() {
  const { api } = useApi();
  const { orgId } = useSession();
  const [stageFilter, setStageFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome>('answered');
  const [note, setNote] = useState('');
  const [advanceStage, setAdvanceStage] = useState('');
  const [snoozeDays, setSnoozeDays] = useState(7);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [copied, setCopied] = useState(false);

  const queue = useQuery({
    queryKey: orgKey(orgId, 'follow-ups', stageFilter || 'all'),
    queryFn: () =>
      api.get('/v1/follow-ups', {
        schema: FollowUpListSchema,
        query: stageFilter ? { stage: stageFilter } : {},
      }),
    staleTime: 60_000,
  });

  const templates = useQuery({
    queryKey: orgKey(orgId, 'follow-up-templates'),
    queryFn: () => api.get('/v1/follow-ups/templates', { schema: FollowUpTemplateListSchema }),
    staleTime: 300_000,
  });

  if (queue.isError) {
    return (
      <ErrorNotice
        error={queue.error}
        title="Follow-ups could not be loaded"
        onRetry={() => void queue.refetch()}
      />
    );
  }

  const items = queue.data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const suggestedTemplate = templates.data?.templates.find(
    (t) => t.id === (templateId || selected?.suggestedTemplateId),
  );

  const refresh = async () => {
    await queue.refetch();
  };

  const complete = async () => {
    if (!selected) return;
    if (note.trim().length === 0) {
      setActionError('Add a short note about what happened before completing this follow-up.');
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setActionResult(null);
    try {
      const data = await api.post(
        `/v1/follow-ups/${encodeURIComponent(selected.id)}/complete`,
        {
          outcome,
          note: note.trim(),
          ...(advanceStage ? { stage: advanceStage } : {}),
        },
        { schema: CompleteFollowUpResponseSchema },
      );
      setActionResult(
        `Logged: ${callOutcomeLabel(outcome)}${data.stage ? ` — moved to ${data.stage}` : ''}. Next check-in is due one cadence after today.`,
      );
      setNote('');
      setAdvanceStage('');
      await refresh();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : errorHint(err));
    } finally {
      setActionBusy(false);
    }
  };

  const snooze = async () => {
    if (!selected) return;
    setActionBusy(true);
    setActionError(null);
    setActionResult(null);
    try {
      const data = await api.post(
        `/v1/follow-ups/${encodeURIComponent(selected.id)}/snooze`,
        { days: snoozeDays },
        { schema: SnoozeFollowUpResponseSchema },
      );
      setActionResult(`Snoozed until ${new Date(data.snoozedUntil).toLocaleDateString()}.`);
      await refresh();
    } catch (err) {
      setActionError(isApiError(err) ? err.message : errorHint(err));
    } finally {
      setActionBusy(false);
    }
  };

  const copyTemplate = async () => {
    if (!suggestedTemplate) return;
    try {
      await navigator.clipboard.writeText(suggestedTemplate.body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const advanceOptions =
    selected?.source === 'roof_order' ? ROOF_ORDER_ADVANCE_STAGES : FUNNEL_ADVANCE_STAGES;

  return (
    <section aria-labelledby="follow-ups-title" className="cc-panel">
      <div className="cc-panel__body">
        <h2 id="follow-ups-title" style={{ marginBottom: 'var(--fl-space-3)' }}>
          Follow-up queue
        </h2>
        {queue.data && (
          <p style={{ marginBottom: 'var(--fl-space-3)' }}>
            {queue.data.automation.note} Quoted leads come due after{' '}
            {queue.data.cadenceDays.quoted} days, interested after{' '}
            {queue.data.cadenceDays.interested}, lost after {queue.data.cadenceDays.lost}.
          </p>
        )}
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="follow-ups-stage-filter" style={{ marginRight: 'var(--fl-space-2)' }}>
            Filter by stage
          </label>
          <select
            id="follow-ups-stage-filter"
            className="cc-input"
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value)}
          >
            <option value="">All stages</option>
            {FOLLOW_UP_STAGES.map((s) => (
              <option key={s} value={s}>
                {FOLLOW_UP_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {queue.isPending ? (
          <p>Loading follow-ups…</p>
        ) : items.length === 0 ? (
          <p>Nothing is due. Quoted leads and dry funnel leads will appear here when their check-in comes due.</p>
        ) : (
          <table className="cc-table">
            <thead>
              <tr>
                <th scope="col">Lead</th>
                <th scope="col">Stage</th>
                <th scope="col">Due</th>
                <th scope="col">Last contact</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: FollowUpItem) => (
                <tr key={item.id}>
                  <td>{followUpTitle(item)}</td>
                  <td>{item.stageLabel}</td>
                  <td>
                    {item.overdueDays > 0
                      ? `${item.overdueDays} day${item.overdueDays === 1 ? '' : 's'} overdue`
                      : 'Due today'}
                  </td>
                  <td>{item.lastContactAt ? new Date(item.lastContactAt).toLocaleDateString() : 'None recorded'}</td>
                  <td>
                    <button
                      type="button"
                      className="cc-btn cc-btn--sm"
                      onClick={() => {
                        setSelectedId(item.id);
                        setActionError(null);
                        setActionResult(null);
                        setTemplateId('');
                      }}
                    >
                      Work this lead
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selected && (
          <div style={{ marginTop: 'var(--fl-space-4)' }}>
            <h3 id="follow-up-detail-title" style={{ marginBottom: 'var(--fl-space-2)' }}>
              {followUpTitle(selected)}
            </h3>
            <p style={{ marginBottom: 'var(--fl-space-3)' }}>{selected.dueReason}</p>
            {selected.lastNote && (
              <p style={{ marginBottom: 'var(--fl-space-3)' }}>Last note: {selected.lastNote}</p>
            )}
            <div style={{ marginBottom: 'var(--fl-space-3)' }}>
              <label htmlFor="follow-up-outcome" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
                Outcome
              </label>
              <select
                id="follow-up-outcome"
                className="cc-input"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as CallOutcome)}
              >
                {CALL_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {callOutcomeLabel(o)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 'var(--fl-space-3)' }}>
              <label htmlFor="follow-up-note" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
                Note (required)
              </label>
              <textarea
                id="follow-up-note"
                className="cc-input"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                rows={3}
              />
            </div>
            <div style={{ marginBottom: 'var(--fl-space-3)' }}>
              <label htmlFor="follow-up-stage" style={{ display: 'block', marginBottom: 'var(--fl-space-1)' }}>
                Move stage (optional)
              </label>
              <select
                id="follow-up-stage"
                className="cc-input"
                value={advanceStage}
                onChange={(event) => setAdvanceStage(event.target.value)}
              >
                <option value="">Leave the stage as it is</option>
                {advanceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 'var(--fl-space-2)', flexWrap: 'wrap', marginBottom: 'var(--fl-space-3)' }}>
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                onClick={() => void complete()}
                disabled={actionBusy}
              >
                Complete follow-up
              </button>
              <label htmlFor="follow-up-snooze-days" style={{ alignSelf: 'center' }}>
                Snooze for
              </label>
              <select
                id="follow-up-snooze-days"
                className="cc-input"
                value={snoozeDays}
                onChange={(event) => setSnoozeDays(Number(event.target.value))}
              >
                {SNOOZE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
              <button type="button" className="cc-btn" onClick={() => void snooze()} disabled={actionBusy}>
                Snooze
              </button>
            </div>
            {actionError && <p role="alert">{actionError}</p>}
            {actionResult && <p role="status">{actionResult}</p>}

            <div style={{ marginTop: 'var(--fl-space-4)' }}>
              <h4 id="follow-up-template-title" style={{ marginBottom: 'var(--fl-space-2)' }}>
                Message template
              </h4>
              <div style={{ marginBottom: 'var(--fl-space-2)' }}>
                <label htmlFor="follow-up-template" style={{ marginRight: 'var(--fl-space-2)' }}>
                  Template
                </label>
                <select
                  id="follow-up-template"
                  className="cc-input"
                  value={templateId || selected.suggestedTemplateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {(templates.data?.templates ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {suggestedTemplate && (
                <>
                  <p style={{ marginBottom: 'var(--fl-space-2)' }}>{suggestedTemplate.body}</p>
                  <p style={{ marginBottom: 'var(--fl-space-2)' }}>
                    Edit the details before sending — nothing is sent from Field Pro.
                  </p>
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => void copyTemplate()}>
                    {copied ? 'Copied' : 'Copy message'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
