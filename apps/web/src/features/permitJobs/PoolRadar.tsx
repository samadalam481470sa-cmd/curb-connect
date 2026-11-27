'use client';
// Texas Pool Radar: pool permits are hot leads for a fence / outdoor-living company, because
// a barrier is required around a residential pool. Follow-up windows are estimates for when
// to call (around 28 days after the pool permit), not measured Texas conversion rates — the
// only timing shown is what Field Pro observes in the Texas permits it scanned. Read-only.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';
import { PermitLeadMap } from './PermitLeadMap';

const PoolLead = z.object({
  leadKey: z.string().optional(),
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  source: z.string(),
  sourceName: z.string(),
  permitNumber: z.string(),
  description: z.string(),
  permitType: z.string(),
  issuedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  value: z.number(),
  contractor: z.string(),
  url: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  daysSinceIssue: z.number().nullable(),
  window: z.enum(['before_window', 'in_window', 'window_closing', 'past_window', 'no_date']),
  windowLabel: z.string(),
  fencePermit: z
    .object({
      permitNumber: z.string(),
      issuedAt: z.string(),
      description: z.string(),
      source: z.string(),
      sourceName: z.string(),
      url: z.string(),
      lagDays: z.number(),
    })
    .nullable(),
});

const PoolRadarResult = z.object({
  fetchedAt: z.string(),
  window: z.object({ since: z.string(), days: z.number() }),
  summary: z.object({
    permitsScanned: z.number(),
    poolPermits: z.number(),
    fencePermits: z.number(),
    properties: z.number(),
    matched: z.number(),
    inWindow: z.number(),
    windowClosing: z.number(),
    pastWindow: z.number(),
    beforeWindow: z.number(),
    noDate: z.number(),
    permitsWithoutAddress: z.number(),
  }),
  observedFenceTiming: z
    .object({
      matchedCount: z.number(),
      medianLagDays: z.number(),
      minLagDays: z.number(),
      maxLagDays: z.number(),
    })
    .nullable(),
  feeds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      count: z.number(),
      poolPermits: z.number(),
      fencePermits: z.number(),
      searchableTextShare: z.number().nullable(),
      latest: z.string().nullable(),
      freshness: z.enum(['live', 'stale', 'unavailable', 'unknown']),
      message: z.string(),
    }),
  ),
  leads: z.array(PoolLead),
  dailyList: z
    .object({
      date: z.string(),
      newToday: z.array(PoolLead),
      windowOpenedToday: z.array(PoolLead),
      windowClosingToday: z.array(PoolLead),
      note: z.string(),
    })
    .optional(),
  caveats: z.array(z.string()),
});
type PoolRadarResultT = z.infer<typeof PoolRadarResult>;

const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US') : 'Not listed');
const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const WINDOW_COLORS: Record<string, string> = {
  before_window: '#6683d4',
  in_window: '#288958',
  window_closing: '#dbb02d',
  past_window: '#6c7782',
  no_date: '#bd5555',
};

type PoolLeadT = z.infer<typeof PoolLead>;

/**
 * In-view outreach action: start tracking this lead in the Active Permits
 * Funnel (stage "New"). In-app only — nothing is emailed or sent anywhere.
 */
function AddToFunnelButton({ leadKey }: { leadKey: string | undefined }) {
  const { api } = useApi();
  const [added, setAdded] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/permit-leads/funnel/stage',
        { leadKey, stage: 'new' },
        { schema: z.object({ ok: z.boolean(), stage: z.string() }) },
      ),
    onSuccess: () => setAdded(true),
  });
  if (!leadKey) return null;
  if (added) return <span className="web-muted">In funnel (New)</span>;
  return (
    <>
      <button
        type="button"
        className="cc-btn"
        disabled={add.isPending}
        onClick={() => add.mutate()}
      >
        {add.isPending ? 'Adding…' : 'Add to funnel'}
      </button>
      {add.isError && <ErrorNotice error={add.error} />}
    </>
  );
}

function DailyLeadRow({ lead }: { lead: PoolLeadT }) {
  return (
    <li>
      <a href={lead.url} target="_blank" rel="noopener noreferrer">
        {lead.address || 'Address not published'}
      </a>{' '}
      ({lead.city} · {lead.sourceName}) — pool permit {lead.permitNumber},{' '}
      {date(lead.issuedAt ?? lead.appliedAt)}
      {lead.daysSinceIssue !== null && `, ${lead.daysSinceIssue} days since`}. {lead.windowLabel}.{' '}
      <AddToFunnelButton leadKey={lead.leadKey} />
    </li>
  );
}

export function PoolRadar() {
  const { api } = useApi();
  const [cities, setCities] = useState(
    'Dallas, Fort Worth, Austin, San Antonio, Houston, Plano, Frisco, Arlington, Denton',
  );
  const [days, setDays] = useState(90);
  const search = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/permit-leads/pool-radar',
        { cities: lines(cities), days, customFeeds: [] },
        { schema: PoolRadarResult },
      ),
  });
  const r: PoolRadarResultT | undefined = search.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search.mutate();
  };
  return (
    <section className="web-card" aria-labelledby="pool-radar-heading">
      <h2 id="pool-radar-heading">Pool Radar</h2>
      <p className="web-muted web-small">
        A home with a new pool permit is a hot lead for a fence or outdoor-living company, because a
        barrier is required around a residential pool. Field Pro finds pool permits across the live
        Texas feeds and watches for the fence permit that usually follows a few weeks later.
        Follow-up windows are estimates for when to call — around 28 days after the pool permit —
        not measured Texas conversion rates. No Florida numbers are used here.
      </p>
      <form className="cc-stack" onSubmit={submit}>
        <label className="cc-field">
          Cities (comma separated)
          <input className="cc-input" value={cities} onChange={(e) => setCities(e.target.value)} />
        </label>
        <label className="cc-field">
          Pool permits from the last
          <select className="cc-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="cc-btn" disabled={search.isPending}>
          {search.isPending ? 'Scanning pool permits…' : 'Find pool leads'}
        </button>
      </form>
      {search.isError && <ErrorNotice error={search.error} />}
      {r && (
        <div>
          <p className="web-small">
            Scanned {r.summary.permitsScanned} permits and found {r.summary.poolPermits} pool
            permits at {r.summary.properties} properties; {r.summary.matched} already have a fence
            permit filed at the same address. In window now: {r.summary.inWindow}; window closing:{' '}
            {r.summary.windowClosing}; too soon: {r.summary.beforeWindow}; past window:{' '}
            {r.summary.pastWindow}.
          </p>
          <p className="web-small">
            {r.observedFenceTiming
              ? `Texas timing observed in this scan: ${r.observedFenceTiming.matchedCount} pool permit${r.observedFenceTiming.matchedCount === 1 ? ' was' : 's were'} followed by a fence permit, with a median gap of ${r.observedFenceTiming.medianLagDays} days (range ${r.observedFenceTiming.minLagDays}–${r.observedFenceTiming.maxLagDays} days). That is observed timing in this scan only — not a conversion rate.`
              : 'No fence follow-up was observed in this scan, so no Texas timing can be shown yet.'}
          </p>
          <ul className="web-muted web-small">
            {r.feeds.map((f) => (
              <li key={f.id}>
                <strong>{f.name}:</strong>{' '}
                {f.status === 'ok'
                  ? `${f.count} permits, ${f.poolPermits} pool, ${f.fencePermits} fence`
                  : f.status}
                . {f.message}
              </li>
            ))}
          </ul>
          {r.dailyList && (
            <div>
              <h3>Today&rsquo;s list — {r.dailyList.date}</h3>
              <p className="web-muted web-small">{r.dailyList.note}</p>
              <h4>New pool permits dated today ({r.dailyList.newToday.length})</h4>
              {r.dailyList.newToday.length === 0 ? (
                <p className="web-muted web-small">None dated today in this scan.</p>
              ) : (
                <ul className="web-small">
                  {r.dailyList.newToday.map((l) => (
                    <DailyLeadRow key={l.source + l.permitNumber} lead={l} />
                  ))}
                </ul>
              )}
              <h4>Follow-up window opened today — day 21, estimate ({r.dailyList.windowOpenedToday.length})</h4>
              {r.dailyList.windowOpenedToday.length === 0 ? (
                <p className="web-muted web-small">None reached day 21 today.</p>
              ) : (
                <ul className="web-small">
                  {r.dailyList.windowOpenedToday.map((l) => (
                    <DailyLeadRow key={l.source + l.permitNumber} lead={l} />
                  ))}
                </ul>
              )}
              <h4>Window started closing today — day 36, estimate ({r.dailyList.windowClosingToday.length})</h4>
              {r.dailyList.windowClosingToday.length === 0 ? (
                <p className="web-muted web-small">None reached day 36 today.</p>
              ) : (
                <ul className="web-small">
                  {r.dailyList.windowClosingToday.map((l) => (
                    <DailyLeadRow key={l.source + l.permitNumber} lead={l} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {r.leads.length === 0 ? (
            <p className="web-muted">
              No pool permits in this window. Widen the days or add cities with live feeds.
            </p>
          ) : (
            <>
              <PermitLeadMap
                leads={r.leads.map((l) => ({
                  permitNumber: l.permitNumber,
                  address: l.address,
                  city: l.city,
                  stage: l.window,
                  latitude: l.latitude,
                  longitude: l.longitude,
                }))}
                legend="Green = in window (days 21–35, estimate) · Yellow = window closing (36–50, estimate) · Blue = too soon · Gray = past window · Red = no date on file."
                colors={WINDOW_COLORS}
              />
              <div style={{ overflowX: 'auto' }}>
                <table className="web-small">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>City / source</th>
                      <th>Pool permit</th>
                      <th>Days since</th>
                      <th>Follow-up window</th>
                      <th>Fence permit</th>
                      <th>Next step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.leads.map((l) => (
                      <tr key={l.source + l.permitNumber}>
                        <td>
                          <a href={l.url} target="_blank" rel="noopener noreferrer">
                            {l.address || 'Address not published'}
                          </a>
                        </td>
                        <td>
                          {l.city} · {l.sourceName}
                        </td>
                        <td>
                          {date(l.issuedAt ?? l.appliedAt)} · {l.permitNumber}
                        </td>
                        <td>{l.daysSinceIssue === null ? '—' : `${l.daysSinceIssue} days`}</td>
                        <td>{l.windowLabel}</td>
                        <td>
                          {l.fencePermit
                            ? `Filed ${date(l.fencePermit.issuedAt)} (${l.fencePermit.permitNumber}, ${l.fencePermit.lagDays} days after the pool)`
                            : 'No fence permit in this window'}
                        </td>
                        <td>
                          <AddToFunnelButton leadKey={l.leadKey} />{' '}
                          <a
                            className="cc-work-board__link"
                            href={
                              'https://www.google.com/maps/search/?api=1&query=' +
                              encodeURIComponent(l.address + ', ' + l.city + ', TX')
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View address in Maps
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <ul className="web-muted web-small">
            {r.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
