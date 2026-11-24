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
  leads: z.array(
    z.object({
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
    }),
  ),
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
      <form onSubmit={submit}>
        <label>
          Cities (comma separated)
          <input value={cities} onChange={(e) => setCities(e.target.value)} />
        </label>
        <label>
          Pool permits from the last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
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
