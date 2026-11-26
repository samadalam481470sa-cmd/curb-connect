'use client';

// Proactive attention feed (builder operations): what needs a human, computed by the API
// from this company's records — slipping schedules, outstanding POs, overdue AP, warranty
// tickets waiting, draws awaiting a decision, contracts at risk, SWPPP due, orders awaiting
// a response. Each item links to its source record and carries a provenance label
// (Observed / Estimated / Modeled). The AI summary is optional and reports honestly when
// no model is connected; the feed itself works without AI.
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateTime } from './shared';

const AttentionItem = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.enum(['high', 'normal', 'low']),
  title: z.string(),
  detail: z.string(),
  provenance: z.enum(['observed', 'estimated', 'modeled']),
  sourceType: z.string(),
  sourceId: z.string().nullable(),
  href: z.string().nullable(),
  observedAt: z.string(),
});
const AttentionFeed = z.object({
  items: z.array(AttentionItem),
  generatedAt: z.string(),
  counts: z.record(z.string(), z.number()),
});
const AttentionSummary = z.object({
  summary: z.string().nullable(),
  state: z.enum(['ok', 'not_connected']),
  note: z.string(),
});

const PROVENANCE_LABEL: Record<string, string> = {
  observed: 'Observed',
  estimated: 'Estimated',
  modeled: 'Modeled',
};

export function AttentionView() {
  return (
    <RouteGate routeId="attention">
      <AttentionContent />
    </RouteGate>
  );
}

function AttentionContent() {
  const session = useSession();
  const { api } = useApi();
  const feed = useQuery({
    queryKey: orgKey(session.orgId, 'attention', 'feed'),
    queryFn: () => api.get('/v1/attention/feed', { schema: AttentionFeed }),
  });
  const summary = useMutation({
    mutationFn: () => api.post('/v1/attention/summary', {}, { schema: AttentionSummary }),
  });

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Attention Feed"
        description="What needs you, computed from your own records: slipping schedules, outstanding purchase orders, overdue payables, warranty tickets waiting, draws awaiting a decision, contracts at risk, and SWPPP inspections due. Every item links to its source record."
      />
      <section className="web-card" aria-labelledby="attention-summary-title">
        <h2 id="attention-summary-title">AI summary</h2>
        <p className="web-muted">
          An optional plain-language summary of the feed below. It only uses the feed items —
          it never invents records.
        </p>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          onClick={() => summary.mutate()}
          disabled={summary.isPending}
        >
          {summary.isPending ? 'Summarizing…' : 'Summarize with AI'}
        </button>
        {summary.isError && <ErrorNotice error={summary.error} title="Could not summarize" />}
        {summary.data && (
          <div>
            {summary.data.summary ? <p>{summary.data.summary}</p> : null}
            <p className="web-muted">{summary.data.note}</p>
          </div>
        )}
      </section>

      <section className="web-card" aria-labelledby="attention-feed-title">
        <h2 id="attention-feed-title">Needs attention</h2>
        {feed.isError && <ErrorNotice error={feed.error} title="Could not load the feed" />}
        {feed.isPending && <p className="web-muted">Loading…</p>}
        {feed.data && feed.data.items.length === 0 && (
          <p className="web-muted">Nothing needs attention right now. Checked {dateTime(feed.data.generatedAt)}.</p>
        )}
        {feed.data && feed.data.items.length > 0 && (
          <>
            <p className="web-muted">
              {feed.data.items.length} item{feed.data.items.length === 1 ? '' : 's'} · checked{' '}
              {dateTime(feed.data.generatedAt)}
            </p>
            <ul className="cc-attention-list">
              {feed.data.items.map((item) => (
                <li key={item.id} className="cc-attention-item">
                  <div>
                    <strong>{item.title}</strong>{' '}
                    <span className="web-muted">
                      ({item.severity} · {PROVENANCE_LABEL[item.provenance] ?? item.provenance})
                    </span>
                    <p>{item.detail}</p>
                  </div>
                  {item.href && (
                    <a className="cc-btn" href={item.href}>
                      Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
