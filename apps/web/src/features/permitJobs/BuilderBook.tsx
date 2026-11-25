'use client';
// Builder book: permits aggregated by builder (from the permit search response), with a
// per-builder material takeoff computed by the existing House Builder takeoff engine and a
// supplier outreach draft. Draft-only: nothing is sent from here.
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { PRICE_BOOK } from '../build/prices';
import {
  aggregateBuilderTakeoff,
  DEFAULT_TAKEOFF_ASSUMPTIONS,
  type TakeoffAssumptions,
} from './builderTakeoff';

const Kit = z.object({
  forKey: z.string(),
  materials: z.array(z.string()),
  emails: z.array(z.object({ label: z.string(), subject: z.string(), body: z.string() })),
  callOpener: z.string(),
  followUps: z.array(z.object({ day: z.number(), channel: z.string(), message: z.string() })),
  pitchDeck: z.array(z.object({ title: z.string(), points: z.array(z.string()) })),
});

export const BuilderBookEntry = z.object({
  key: z.string(),
  name: z.string(),
  phone: z.string(),
  decisionMaker: z
    .object({
      name: z.string().nullable(),
      source: z.enum(['tdlr', 'contacts']).nullable(),
      licenseType: z.string().nullable(),
      licenseNumber: z.string().nullable(),
      licenseExpiresOn: z.string().nullable(),
      phone: z.string().nullable(),
      phoneSource: z.enum(['tdlr', 'contacts']).nullable(),
      email: z.string().nullable(),
      role: z.string().nullable(),
    })
    .nullable(),
  permitCount: z.number(),
  totalValue: z.number(),
  sqFtPermitCount: z.number(),
  totalSqFt: z.number(),
  cities: z.array(z.string()),
  projectTypes: z.array(z.string()),
  trades: z.array(z.string()),
  latestPermitAt: z.string().nullable(),
  topScore: z.number(),
  averageScore: z.number(),
  gradeCounts: z.record(z.string(), z.number()),
  intent: z.string(),
  permits: z.array(
    z.object({
      permitNumber: z.string(),
      address: z.string(),
      city: z.string(),
      value: z.number(),
      description: z.string(),
      projectType: z.string(),
      url: z.string(),
      score: z.number(),
      grade: z.string(),
      sqFt: z.number().nullable(),
      stories: z.union([z.literal(1), z.literal(2)]).nullable(),
      trades: z.array(z.string()),
    }),
  ),
  outreach: Kit.nullable(),
});
export type BuilderBookEntryT = z.infer<typeof BuilderBookEntry>;

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US') : 'Not listed');

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cc-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function BuilderTakeoffView({ builder }: { builder: BuilderBookEntryT }) {
  const [a, setA] = useState<TakeoffAssumptions>(DEFAULT_TAKEOFF_ASSUMPTIONS);
  const takeoff = useMemo(
    () => aggregateBuilderTakeoff(builder.permits, a),
    [builder.permits, a],
  );
  if (takeoff.permitsUsed === 0) {
    return (
      <p className="web-muted web-small">
        Insufficient data for a takeoff: none of this builder&apos;s permits in the window state
        square footage. Field Pro does not estimate building size from value.
      </p>
    );
  }
  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return (
    <div>
      <p className="web-small">
        <strong>Material takeoff (planning estimate)</strong> — {takeoff.permitsUsed} permits with
        stated sq ft ({takeoff.totalSqFt.toLocaleString('en-US')} sq ft total)
        {takeoff.permitsSkipped > 0
          ? `, ${takeoff.permitsSkipped} permits skipped (no sq ft stated)`
          : ''}
        . Roof: {takeoff.totalRoofSquares} squares · Concrete: {takeoff.totalConcreteYd3} yd³.
      </p>
      <div className="web-small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>
          Bedrooms{' '}
          <input
            type="number"
            min={0}
            max={6}
            value={a.bedrooms}
            onChange={(e) => setA({ ...a, bedrooms: num(e.target.value, a.bedrooms) })}
            style={{ width: 56 }}
          />
        </label>
        <label>
          Bathrooms{' '}
          <input
            type="number"
            min={0}
            max={6}
            value={a.bathrooms}
            onChange={(e) => setA({ ...a, bathrooms: num(e.target.value, a.bathrooms) })}
            style={{ width: 56 }}
          />
        </label>
        <label>
          Garage{' '}
          <select
            value={a.garage}
            onChange={(e) => setA({ ...a, garage: e.target.value as TakeoffAssumptions['garage'] })}
          >
            <option value="none">None</option>
            <option value="one_car">One car</option>
            <option value="two_car">Two car</option>
          </select>
        </label>
        <label>
          Wall height{' '}
          <select
            value={a.wallHeightFt}
            onChange={(e) =>
              setA({ ...a, wallHeightFt: Number(e.target.value) as 8 | 9 | 10 })
            }
          >
            <option value={8}>8 ft</option>
            <option value={9}>9 ft</option>
            <option value={10}>10 ft</option>
          </select>
        </label>
        <label>
          Roof pitch (/12){' '}
          <input
            type="number"
            min={0}
            max={12}
            value={a.roofPitch}
            onChange={(e) => setA({ ...a, roofPitch: num(e.target.value, a.roofPitch) })}
            style={{ width: 56 }}
          />
        </label>
        <label>
          Waste %{' '}
          <input
            type="number"
            min={0}
            max={30}
            value={a.wastePercent}
            onChange={(e) => setA({ ...a, wastePercent: num(e.target.value, a.wastePercent) })}
            style={{ width: 56 }}
          />
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="web-small">
          <thead>
            <tr>
              <th>Group</th>
              <th>Material</th>
              <th>Quantity</th>
              <th>How it was figured (first permit)</th>
            </tr>
          </thead>
          <tbody>
            {takeoff.lines.map((l) => (
              <tr key={l.material}>
                <td>{l.group}</td>
                <td>{PRICE_BOOK[l.material as keyof typeof PRICE_BOOK]?.label ?? l.material}</td>
                <td>{l.quantity.toLocaleString('en-US')}</td>
                <td>{l.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="web-muted web-small">
        {takeoff.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        <li>
          Quantities use the House Builder takeoff engine (slab-on-grade, wood-framed, gable truss
          roof). Verify against plans before ordering; prices are not shown because no price was
          supplied for these permits.
        </li>
      </ul>
    </div>
  );
}

export function BuilderBook({ builders }: { builders: BuilderBookEntryT[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="web-card">
      <h2>Builder book</h2>
      <p className="web-muted web-small">
        Every builder named on the matching permits, aggregated: volume, listed value, stated
        square footage, trades and a planning takeoff. Contacts are only what the city published.
      </p>
      {builders.length === 0 && (
        <p className="web-muted">No builders are named on the matching permits.</p>
      )}
      <div className="cc-work-board__cards">
        {builders.slice(0, 40).map((b) => (
          <article className="web-card" key={b.key}>
            <small className="cc-work-board__source">
              Top score {b.topScore} · avg {b.averageScore} · {b.intent}
            </small>
            <strong>{b.name}</strong>
            <p className="web-muted web-small">
              {b.permitCount} permits · {money(b.totalValue)} listed
              {b.sqFtPermitCount > 0
                ? ` · ${b.totalSqFt.toLocaleString('en-US')} sq ft stated on ${b.sqFtPermitCount} permits`
                : ' · no sq ft stated'}
              {' · '}
              {b.cities.join(', ')} · latest {date(b.latestPermitAt)}
              {b.phone ? ` · ${b.phone}` : ''}
            </p>
            <p className="web-muted web-small">
              Grades: A {b.gradeCounts.A ?? 0} · B {b.gradeCounts.B ?? 0} · C{' '}
              {b.gradeCounts.C ?? 0} · D {b.gradeCounts.D ?? 0} · Trades: {b.trades.join(', ')}
            </p>
            <p className="web-small">
              <strong>Decision-maker: </strong>
              {b.decisionMaker?.name ? (
                <>
                  {b.decisionMaker.name}
                  {b.decisionMaker.source === 'tdlr'
                    ? ' (Texas license holder — TDLR)'
                    : ' (from your contacts)'}
                  {b.decisionMaker.licenseType ? (
                    <>
                      {' · '}
                      {b.decisionMaker.licenseType} #{b.decisionMaker.licenseNumber}
                      {b.decisionMaker.licenseExpiresOn
                        ? `, expires ${new Date(b.decisionMaker.licenseExpiresOn).toLocaleDateString('en-US')}`
                        : ', expiry not published'}
                    </>
                  ) : null}
                  {b.decisionMaker.email ? (
                    <>
                      {' · '}
                      <a href={`mailto:${b.decisionMaker.email}`}>{b.decisionMaker.email}</a>
                    </>
                  ) : null}
                  {b.decisionMaker.phone && b.decisionMaker.phone !== b.phone ? (
                    <>
                      {' · '}
                      {b.decisionMaker.phone}
                      {b.decisionMaker.phoneSource === 'tdlr' ? ' (TDLR)' : ' (from your contacts)'}
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  Decision-maker not in public records
                  <span className="web-muted">
                    {' '}
                    — no TDLR license holder and no matching CRM contact for this builder.
                  </span>
                </>
              )}
            </p>
            <ul className="web-small">
              {b.permits.slice(0, 5).map((p) => (
                <li key={p.permitNumber}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    {p.address}, {p.city}
                  </a>{' '}
                  — {p.value > 0 ? money(p.value) : 'value not listed'}
                  {p.sqFt ? ` · ${p.sqFt.toLocaleString('en-US')} sq ft stated` : ''}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="cc-btn"
              onClick={() => setOpen(open === b.key ? null : b.key)}
            >
              {open === b.key ? 'Hide takeoff & outreach' : 'Takeoff & supplier outreach'}
            </button>
            {open === b.key && (
              <div>
                <BuilderTakeoffView builder={b} />
                {b.outreach && (
                  <div>
                    <h3>Supplier outreach draft (review and copy; nothing sent automatically)</h3>
                    <p className="web-small">
                      <strong>Call opener:</strong> {b.outreach.callOpener}{' '}
                      <Copy text={b.outreach.callOpener} />
                    </p>
                    {b.outreach.emails.map((em) => (
                      <div key={em.label}>
                        <p className="web-small">
                          <strong>{em.label}:</strong> {em.subject}{' '}
                          <Copy text={`Subject: ${em.subject}\n\n${em.body}`} />
                        </p>
                        <pre className="web-small" style={{ whiteSpace: 'pre-wrap' }}>
                          {em.body}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
