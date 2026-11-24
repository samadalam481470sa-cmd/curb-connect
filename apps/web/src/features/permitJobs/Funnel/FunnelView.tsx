'use client';
// Active Permits Funnel: live permits ranked into callable leads, kept fresh by the
// keep-alive worker (every 30 minutes in the workday, hourly overnight — see
// docs/active-permits-funnel.md). A phone number is shown only when a public record
// published it or it matches your own contacts; otherwise the lead says plainly
// "Phone not in public records" and the mailing address is the way to reach the owner.
// Nothing here is a prediction that the owner will hire you — call priority is a calling
// order (newest first, boosted when no contractor is on file yet).
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';
import {
  CALL_OUTCOME_LABEL,
  CALL_OUTCOMES,
  CALL_PRIORITY_LABEL,
  FUNNEL_NEXT_STAGES,
  FUNNEL_STAGE_LABEL,
  formatUsd,
  freshnessLabel,
  FunnelCadenceSchema,
  FunnelResultSchema,
  telHref,
  type CallOutcome,
  type FunnelLead,
  type FunnelResult,
  type FunnelStage,
} from './funnel';

const PRIORITY_STYLE: Record<FunnelLead['priority'], { background: string; color: string }> = {
  hot: { background: '#fde8e8', color: '#8a1f1f' },
  warm: { background: '#fdf3d7', color: '#7a5b00' },
  cool: { background: '#e8eef5', color: '#33506e' },
};

const TRADE_OPTIONS = [
  { value: 'roofing', label: 'Roofing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'framing', label: 'Framing' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'grading', label: 'Grading' },
  { value: 'general', label: 'General' },
] as const;

function LeadCard({
  lead,
  onStage,
  onLogCall,
  stagePending,
  callPending,
}: {
  lead: FunnelLead;
  onStage: (leadKey: string, stage: FunnelStage) => void;
  onLogCall: (leadKey: string, outcome: CallOutcome, note: string) => void;
  stagePending: boolean;
  callPending: boolean;
}) {
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<CallOutcome>('answered');
  const [noteError, setNoteError] = useState('');
  const href = telHref(lead.contact.phone);
  const nextStages = FUNNEL_NEXT_STAGES[lead.stage as FunnelStage] ?? [];
  const submitCall = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) {
      setNoteError('Write a short note about what the owner said.');
      return;
    }
    setNoteError('');
    onLogCall(lead.key, outcome, note.trim());
    setNote('');
  };
  return (
    <article className="web-card" aria-label={`${lead.address}, ${lead.city}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>
          {lead.address || 'Address not published'}, {lead.city}
        </strong>
        <span style={{ ...PRIORITY_STYLE[lead.priority], padding: '2px 8px', borderRadius: 999 }}>
          {CALL_PRIORITY_LABEL[lead.priority]}
        </span>
      </div>
      <p className="web-muted web-small">
        {lead.permitType || 'Permit'} · {lead.permitNumber || 'No permit number'} ·{' '}
        {lead.sourceName} · {formatUsd(lead.value)}
        {lead.daysSince !== null ? ` · issued ${lead.daysSince} day${lead.daysSince === 1 ? '' : 's'} ago` : ''}
        {' · '}
        {freshnessLabel(lead.freshness)}
      </p>
      <ul className="web-small">
        {lead.callReasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="web-small">
        <strong>Owner: </strong>
        {lead.owner.name ?? 'Not published for this permit'}
        {lead.owner.mailingAddress ? ` — ${lead.owner.mailingAddress}` : ''}
        {lead.owner.source === 'cad' ? ' (county appraisal district)' : ''}
        {lead.owner.vintage ? ` · ${lead.owner.vintage}` : ''}
        <br />
        <strong>Contractor on file: </strong>
        {lead.contractor || 'None yet'}
        <br />
        <strong>Phone: </strong>
        {href && lead.contact.phone ? (
          <a href={href}>{lead.contact.phone}</a>
        ) : (
          <>Phone not in public records</>
        )}
        {lead.contact.phoneSource === 'contacts' ? ' (from your contacts)' : ''}
        {!href && (
          <span className="web-muted">
            {' '}
            — no phone is published for this owner in the permit record or the county appraisal
            district. Mail the owner at the mailing address, or add the number to your contacts
            once you have it.
          </span>
        )}
      </p>
      <p className="web-small">
        <strong>Stage: </strong>
        {FUNNEL_STAGE_LABEL[lead.stage as FunnelStage] ?? lead.stage}
        {nextStages.length > 0 && (
          <>
            {' — '}
            {nextStages.map((s) => (
              <button
                key={s}
                type="button"
                disabled={stagePending}
                onClick={() => onStage(lead.key, s)}
              >
                Mark {FUNNEL_STAGE_LABEL[s]}
              </button>
            ))}
          </>
        )}
      </p>
      <form onSubmit={submitCall}>
        <label>
          Call note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did the owner say?"
            maxLength={1000}
          />
        </label>
        <label>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
            {CALL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {CALL_OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        {noteError ? <p className="web-error">{noteError}</p> : null}
        <button type="submit" disabled={callPending}>
          Log call
        </button>
      </form>
    </article>
  );
}

export function FunnelView() {
  const { api } = useApi();
  const [cities, setCities] = useState(
    'Dallas, Fort Worth, Austin, San Antonio, Houston, Plano, Frisco, Arlington, Denton',
  );
  const [days, setDays] = useState(30);
  const [trades, setTrades] = useState<string[]>([]);
  const search = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/permit-leads/funnel',
        {
          cities: cities.split(',').map((c) => c.trim()).filter(Boolean),
          days,
          trades,
          customFeeds: [],
        },
        { schema: FunnelResultSchema },
      ),
  });
  const cadence = useMutation({
    mutationFn: () => api.get('/v1/permit-leads/funnel/cadence', { schema: FunnelCadenceSchema }),
  });
  const stage = useMutation({
    mutationFn: ({ leadKey, stage: next }: { leadKey: string; stage: FunnelStage }) =>
      api.post(
        '/v1/permit-leads/funnel/stage',
        { leadKey, stage: next },
        { schema: z.object({ ok: z.boolean(), stage: z.string() }) },
      ),
    onSuccess: () => search.mutate(),
  });
  const logCall = useMutation({
    mutationFn: ({
      leadKey,
      outcome,
      note,
    }: {
      leadKey: string;
      outcome: CallOutcome;
      note: string;
    }) =>
      api.post(
        '/v1/permit-leads/funnel/call',
        { leadKey, outcome, note },
        {
          schema: z.object({
            ok: z.boolean(),
            outcome: z.string(),
            note: z.string(),
            createdAt: z.string(),
          }),
        },
      ),
    onSuccess: () => search.mutate(),
  });
  const r: FunnelResult | undefined = search.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search.mutate();
    cadence.mutate();
  };
  const toggleTrade = (value: string) =>
    setTrades((t) => (t.includes(value) ? t.filter((x) => x !== value) : [...t, value]));
  return (
    <section className="web-card" aria-labelledby="funnel-heading">
      <h2 id="funnel-heading">Active Permits Funnel</h2>
      <p className="web-muted web-small">
        Every live permit from the Texas feeds, funneled into leads you can call — newest first,
        hottest first. The keep-alive worker re-checks the feeds every 30 minutes during the
        workday so the list is never a day old; cities publish daily at best (Houston weekly), so
        more frequent fetching would add nothing. A phone number is shown only when a public
        record published it or it matches your own contacts.
      </p>
      <form onSubmit={submit}>
        <label>
          Cities (comma separated)
          <input value={cities} onChange={(e) => setCities(e.target.value)} />
        </label>
        <label>
          Permits from the last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Trades (optional — leave empty for all trades)</legend>
          {TRADE_OPTIONS.map((t) => (
            <label key={t.value}>
              <input
                type="checkbox"
                checked={trades.includes(t.value)}
                onChange={() => toggleTrade(t.value)}
              />{' '}
              {t.label}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={search.isPending}>
          {search.isPending ? 'Fetching live permits…' : 'Run the funnel'}
        </button>
      </form>
      {search.error ? <ErrorNotice error={search.error} /> : null}
      {stage.error ? <ErrorNotice error={stage.error} /> : null}
      {logCall.error ? <ErrorNotice error={logCall.error} /> : null}
      {r ? (
        <>
          <p className="web-small">
            {r.summary.leads} callable leads from {r.summary.permitsScanned} permits scanned ·{' '}
            {r.summary.hot} call now · {r.summary.warm} call this week · {r.summary.cool} follow
            up later · fetched {new Date(r.fetchedAt).toLocaleString()}
          </p>
          {cadence.data ? (
            <details>
              <summary className="web-small">Feed freshness — last checked</summary>
              <ul className="web-small">
                {cadence.data.sources.map((s) => (
                  <li key={s.id}>
                    {s.name}: {s.lastCheckedText}
                    {s.due ? ' — due a re-check' : ''}
                    {` — ${s.note}`}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {r.feeds
            .filter((f) => f.freshness === 'stale' || f.status === 'unavailable')
            .map((f) => (
              <p key={f.id} className="web-small">
                {f.name}: {f.message}
              </p>
            ))}
          {r.leads.map((lead) => (
            <LeadCard
              key={lead.key}
              lead={lead}
              onStage={(leadKey, next) => stage.mutate({ leadKey, stage: next })}
              onLogCall={(leadKey, outcome, note) => logCall.mutate({ leadKey, outcome, note })}
              stagePending={stage.isPending}
              callPending={logCall.isPending}
            />
          ))}
          {r.caveats.map((c) => (
            <p key={c} className="web-muted web-small">
              {c}
            </p>
          ))}
        </>
      ) : null}
    </section>
  );
}
