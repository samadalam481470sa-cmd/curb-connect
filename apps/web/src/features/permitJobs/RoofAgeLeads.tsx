'use client';
// Roof-age leads: properties whose newest roofing permit in the scanned city records is past the
// age threshold. Permit-history age only — never a damage or condition claim. Read-only.
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';

const RoofAgeResult = z.object({
  fetchedAt: z.string(),
  thresholdYears: z.number(),
  summary: z.object({
    roofingPermitsScanned: z.number(),
    propertiesWithRoofingPermit: z.number(),
    flagged: z.number(),
    propertiesWithoutAddress: z.number(),
    roofingPermitsWithoutDate: z.number(),
  }),
  feeds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      count: z.number(),
      message: z.string(),
    }),
  ),
  leads: z.array(
    z.object({
      address: z.string(),
      city: z.string(),
      zip: z.string(),
      sourceName: z.string(),
      newestRoofingPermitAt: z.string(),
      ageYears: z.number(),
      roofingPermitCount: z.number(),
      latestPermit: z.object({
        permitNumber: z.string(),
        description: z.string(),
        contractor: z.string(),
        url: z.string(),
      }),
    }),
  ),
  caveats: z.array(z.string()),
});
type RoofAgeResultT = z.infer<typeof RoofAgeResult>;

const date = (v: string) => new Date(v).toLocaleDateString('en-US');
const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function CopyAddress({ text }: { text: string }) {
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
      {done ? 'Copied' : 'Copy address'}
    </button>
  );
}

export function RoofAgeLeads() {
  const { api } = useApi();
  const [cities, setCities] = useState('Austin, Dallas, Fort Worth, Denton, Plano, Frisco');
  const [threshold, setThreshold] = useState(15);
  const search = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/permit-leads/roof-age',
        { cities: lines(cities), thresholdYears: threshold, customFeeds: [] },
        { schema: RoofAgeResult },
      ),
  });
  const r: RoofAgeResultT | undefined = search.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search.mutate();
  };
  return (
    <section className="web-card">
      <h2>Roof-age leads</h2>
      <p className="web-muted web-small">
        Properties whose newest roofing permit in the scanned city records is at least the
        threshold age. This is permit-history age only — not a damage, condition or insurance
        claim. A property with no roofing permit in the scan is never listed as an old roof.
        Verify in person before quoting.
      </p>
      <form className="cc-stack" onSubmit={submit}>
        <label className="cc-field">
          Cities (comma separated)
          <input className="cc-input" value={cities} onChange={(e) => setCities(e.target.value)} />
        </label>
        <label className="cc-field">
          Minimum roof age (years)
          <input
            className="cc-input"
            type="number"
            min={5}
            max={40}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 15)}
          />
        </label>
        <button type="submit" className="cc-btn" disabled={search.isPending}>
          {search.isPending ? 'Scanning permit history…' : 'Find aging roofs'}
        </button>
      </form>
      {search.isError && <ErrorNotice error={search.error} />}
      {r && (
        <div>
          <p className="web-small">
            Scanned {r.summary.roofingPermitsScanned} roofing permits across{' '}
            {r.summary.propertiesWithRoofingPermit} properties; {r.summary.flagged} at or past{' '}
            {r.thresholdYears} years since their newest roofing permit.
          </p>
          <ul className="web-muted web-small">
            {r.feeds.map((f) => (
              <li key={f.id}>
                <strong>{f.name}:</strong> {f.status === 'ok' ? `${f.count} roofing permits` : f.status}.{' '}
                {f.message}
              </li>
            ))}
          </ul>
          {r.leads.length === 0 ? (
            <p className="web-muted">
              No properties past the threshold in this scan. Lower the threshold or add cities
              with live feeds.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="web-small">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>City</th>
                    <th>Newest roofing permit</th>
                    <th>Permit age</th>
                    <th>Roofing permits</th>
                    <th>Last roofer on record</th>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {r.leads.map((l) => (
                    <tr key={l.address + l.city + l.zip}>
                      <td>
                        <a href={l.latestPermit.url} target="_blank" rel="noopener noreferrer">
                          {l.address}
                        </a>
                      </td>
                      <td>{l.city}</td>
                      <td>{date(l.newestRoofingPermitAt)}</td>
                      <td>{l.ageYears} yrs</td>
                      <td>{l.roofingPermitCount}</td>
                      <td>{l.latestPermit.contractor || 'Not named on permit'}</td>
                      <td>
                        <CopyAddress text={`${l.address}, ${l.city}, TX ${l.zip}`} />{' '}
                        <a className="cc-work-board__link" href="/roof">
                          Open Roof workspace
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
