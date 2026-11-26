'use client';
// Texas Finish-outs: renovations, tenant improvements and interior build-outs as leads for
// flooring, cabinet, countertop and fixture companies — the permits the new-construction
// search cuts. Value is mostly blank (Texas feeds publish almost no value/contractor fields
// on current permits) and "possible finish opening" is an inference, never proof a finish
// subcontractor hasn't been hired. Read-only; nothing is sent anywhere.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';
import { PermitLeadMap } from './PermitLeadMap';

const STAGES = ['planning', 'application', 'permitted', 'unknown'] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  planning: 'Planning',
  application: 'Under city review',
  permitted: 'Permit issued',
  unknown: 'Stage not published',
};
const BANDS = [
  'under_25k',
  '25k_100k',
  '100k_500k',
  '500k_1m',
  '1m_10m',
  'over_10m',
  'not_listed',
] as const;
const BAND_LABEL: Record<(typeof BANDS)[number], string> = {
  under_25k: 'Under $25k',
  '25k_100k': '$25k–$100k',
  '100k_500k': '$100k–$500k',
  '500k_1m': '$500k–$1M',
  '1m_10m': '$1M–$10M',
  over_10m: 'Over $10M',
  not_listed: 'Value not listed',
};
const KINDS = ['finish_out', 'remodel', 'addition'] as const;
const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  finish_out: 'Finish-out / tenant improvement',
  remodel: 'Remodel / renovation',
  addition: 'Addition',
};

const FinishOutsResult = z.object({
  fetchedAt: z.string(),
  window: z.object({ since: z.string(), days: z.number() }),
  summary: z.object({
    permitsScanned: z.number(),
    finishOutPermits: z.number(),
    leads: z.number(),
    underReview: z.number(),
    possibleOpenings: z.number(),
    totalListedValue: z.number(),
    byKind: z.record(z.string(), z.number()),
    byBand: z.record(z.string(), z.number()),
    byStage: z.record(z.string(), z.number()),
  }),
  feeds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      count: z.number(),
      finishOutPermits: z.number(),
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
      status: z.string(),
      issuedAt: z.string().nullable(),
      appliedAt: z.string().nullable(),
      value: z.number(),
      valueBand: z.enum(BANDS),
      valueBandLabel: z.string(),
      contractor: z.string(),
      contractorPhone: z.string(),
      url: z.string(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      projectType: z.string(),
      renovationKind: z.enum(['finish_out', 'remodel', 'addition', 'repair', 'new_construction', 'other']),
      renovationKindLabel: z.string(),
      stage: z.enum(['planning', 'application', 'permitted', 'completed', 'unknown']),
      underReview: z.boolean(),
      finishTradeEvidence: z.enum(['recorded', 'not_observed', 'unknown', 'not_applicable']),
      possibleFinishOpening: z.boolean(),
      possibleFinishOpeningNote: z.string(),
      score: z.number(),
      grade: z.enum(['A', 'B', 'C', 'D']),
      reasons: z.array(z.string()),
    }),
  ),
  caveats: z.array(z.string()),
});
type FinishOutsResultT = z.infer<typeof FinishOutsResult>;

const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US') : 'Not listed');
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const STAGE_COLORS: Record<string, string> = {
  planning: '#6683d4',
  application: '#288958',
  permitted: '#dbb02d',
  unknown: '#6c7782',
};

const EVIDENCE_LABEL: Record<string, string> = {
  recorded: 'Finish permit on file at this address',
  not_observed: 'No separate finish permit observed (inference only)',
  unknown: 'Not enough published data to check',
  not_applicable: '—',
};

export function FinishOuts() {
  const { api } = useApi();
  const [cities, setCities] = useState(
    'Dallas, Fort Worth, Austin, San Antonio, Houston, Plano, Frisco, Arlington, Denton',
  );
  const [days, setDays] = useState(90);
  const [stages, setStages] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const search = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/permit-leads/finish-outs',
        { cities: lines(cities), days, customFeeds: [], stages, valueBands: bands, kinds },
        { schema: FinishOutsResult },
      ),
  });
  const r: FinishOutsResultT | undefined = search.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search.mutate();
  };
  return (
    <section className="web-card" aria-labelledby="finish-outs-heading">
      <h2 id="finish-outs-heading">Finish-outs</h2>
      <p className="web-muted web-small">
        Renovations, tenant improvements and interior build-outs — the permits the
        new-construction search cuts — ranked as leads for flooring, cabinet, countertop and
        fixture work. Value is mostly blank: Texas feeds publish almost no value or contractor
        fields on current permits, so most leads show “Value not listed” and totals sum only
        what the cities actually published. A “possible finish opening” means no contractor is
        named on the permit or no separate finish-out trade permit was observed at the address —
        an inference, never proof the finish work is unawarded.
      </p>
      <form className="cc-stack" onSubmit={submit}>
        <label className="cc-field">
          Cities (comma separated)
          <input className="cc-input" value={cities} onChange={(e) => setCities(e.target.value)} />
        </label>
        <label className="cc-field">
          Permits from the last
          <select className="cc-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <fieldset className="cc-field">
          <legend>Stage (leave all unchecked for every stage)</legend>
          {STAGES.map((s) => (
            <label key={s} className="web-small">
              <input
                type="checkbox"
                checked={stages.includes(s)}
                onChange={() => toggle(stages, setStages, s)}
              />{' '}
              {STAGE_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <fieldset className="cc-field">
          <legend>Value band (published value only)</legend>
          {BANDS.map((b) => (
            <label key={b} className="web-small">
              <input
                type="checkbox"
                checked={bands.includes(b)}
                onChange={() => toggle(bands, setBands, b)}
              />{' '}
              {BAND_LABEL[b]}
            </label>
          ))}
        </fieldset>
        <fieldset className="cc-field">
          <legend>Work type</legend>
          {KINDS.map((k) => (
            <label key={k} className="web-small">
              <input
                type="checkbox"
                checked={kinds.includes(k)}
                onChange={() => toggle(kinds, setKinds, k)}
              />{' '}
              {KIND_LABEL[k]}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="cc-btn" disabled={search.isPending}>
          {search.isPending ? 'Scanning renovation permits…' : 'Find finish-out leads'}
        </button>
      </form>
      {search.isError && <ErrorNotice error={search.error} />}
      {r && (
        <div>
          <p className="web-small">
            Scanned {r.summary.permitsScanned} permits and found {r.summary.finishOutPermits}{' '}
            finish-out / remodel permits; {r.summary.leads} leads after filters.{' '}
            {r.summary.underReview} still under city review; {r.summary.possibleOpenings} possible
            finish openings (inference only). Published value across these leads:{' '}
            {money(r.summary.totalListedValue)} — permits with no published value add nothing to
            that total.
          </p>
          <ul className="web-muted web-small">
            {r.feeds.map((f) => (
              <li key={f.id}>
                <strong>{f.name}:</strong>{' '}
                {f.status === 'ok'
                  ? `${f.count} permits, ${f.finishOutPermits} finish-out / remodel`
                  : f.status}
                . {f.message}
              </li>
            ))}
          </ul>
          {r.leads.length === 0 ? (
            <p className="web-muted">
              No finish-out permits match in this window. Widen the days, add cities with live
              feeds, or clear the stage / value-band filters.
            </p>
          ) : (
            <>
              <PermitLeadMap
                leads={r.leads.map((l) => ({
                  permitNumber: l.permitNumber,
                  address: l.address,
                  city: l.city,
                  stage: l.stage,
                  latitude: l.latitude,
                  longitude: l.longitude,
                }))}
                legend="Green = under city review · Yellow = permit issued · Blue = planning · Gray = stage not published."
                colors={STAGE_COLORS}
              />
              <div style={{ overflowX: 'auto' }}>
                <table className="web-small">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>City / source</th>
                      <th>Work</th>
                      <th>Stage</th>
                      <th>Value</th>
                      <th>Contractor on file</th>
                      <th>Finish permit</th>
                      <th>Score</th>
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
                          <br />
                          <span className="web-muted">
                            {l.permitNumber} · {date(l.issuedAt ?? l.appliedAt)}
                          </span>
                        </td>
                        <td>
                          {l.city} · {l.sourceName}
                        </td>
                        <td>
                          {l.renovationKindLabel}
                          <br />
                          <span className="web-muted">{l.description}</span>
                        </td>
                        <td>
                          {l.underReview ? 'Under city review' : STAGE_LABEL[l.stage as keyof typeof STAGE_LABEL] ?? l.stage}
                        </td>
                        <td>{l.value > 0 ? `${money(l.value)} (${l.valueBandLabel})` : 'Value not listed'}</td>
                        <td>{l.contractor || '—'}</td>
                        <td>
                          {EVIDENCE_LABEL[l.finishTradeEvidence]}
                          {l.possibleFinishOpening && (
                            <>
                              <br />
                              <span className="web-muted">Possible finish opening (inference only)</span>
                            </>
                          )}
                        </td>
                        <td>
                          {l.score} ({l.grade})
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
