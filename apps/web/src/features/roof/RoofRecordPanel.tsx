'use client';

// Saves traced facets to the API, approves a version and prices it. The server measures every
// area and computes every total; this panel only sends rings, pitches and the company's prices,
// then shows what the server returned.
import type { RoofEstimateRecord, RoofMeasurementDetail } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import { PRICE_BOOK, referenceUnitPrice } from '../build/prices';
import { Kpi, money, NumberField, num, Panel } from '../command/Panel';
import type { MapFacet } from './map/facetMath';

const RECORD_KEY = 'fieldpro.roof.record.v1';

interface SavedRef {
  id: string;
  versionNumber: number;
  /** JSON of the facets as last saved: a different local draft means unsaved edits. */
  snapshot: string;
}

const snapshotOf = (facets: readonly MapFacet[]) =>
  JSON.stringify(facets.map((f) => [f.id, f.name, f.pitch, f.ring]));

const toRequestFacets = (facets: readonly MapFacet[]) =>
  facets
    .filter((f) => f.ring.length >= 3)
    .map((f) => ({
      key: f.id,
      label: f.name.trim().slice(0, 80) || undefined,
      ring: f.ring.map((p) => ({ lon: p.lon, lat: p.lat })),
      pitchRise: f.pitch,
    }));

export function fromDetail(detail: RoofMeasurementDetail): MapFacet[] {
  return detail.version.facets.map((f) => ({
    id: f.key,
    name: f.label ?? f.key,
    ring: f.ring,
    pitch: f.pitchRise,
  }));
}

const cents = (dollars: number) => Math.round(Math.max(0, dollars) * 100);
const refPrice = (id: keyof typeof PRICE_BOOK) => referenceUnitPrice(PRICE_BOOK[id]);

export function RoofRecordPanel({
  facets,
  waste,
  redeck,
  onLoad,
}: {
  facets: readonly MapFacet[];
  waste: number;
  redeck: boolean;
  onLoad: (facets: MapFacet[]) => void;
}) {
  const { endpoints } = useApi();
  const { can } = useSession();
  const qc = useQueryClient();
  const [saved, setSaved] = useState<SavedRef | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<RoofEstimateRecord | null>(null);

  const shingleRef = refPrice('shingle_bundle');
  const underlayRef = refPrice('underlayment_roll');
  const deckRef = refPrice('osb_7_16');
  const [prices, setPrices] = useState({
    shingle: shingleRef?.price ?? 0,
    underlay: underlayRef?.price ?? 0,
    deck: deckRef?.price ?? 0,
  });
  const [labor, setLabor] = useState(0);
  const [margin, setMargin] = useState(0);
  const [tax, setTax] = useState(8.25);

  // Restore the last saved measurement id after paint (storage during render breaks hydration).
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(RECORD_KEY);
        if (raw) setSaved(JSON.parse(raw) as SavedRef);
      } catch {
        // ignore
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    try {
      if (saved) window.localStorage.setItem(RECORD_KEY, JSON.stringify(saved));
      else window.localStorage.removeItem(RECORD_KEY);
    } catch {
      // storage unavailable
    }
  }, [saved]);

  const list = useQuery({
    queryKey: ['roof-measurements'],
    queryFn: () => endpoints.roofMeasurements(),
    enabled: can('roof_order:read'),
  });
  const current = useQuery({
    queryKey: ['roof-measurement', saved?.id],
    queryFn: () => endpoints.roofMeasurement(saved!.id),
    enabled: Boolean(saved?.id),
  });
  // The saved measurement as the server last returned it (mutations write into this cache entry).
  const detail = saved ? (current.data ?? null) : null;
  const estimates = useQuery({
    queryKey: ['roof-estimates', saved?.id],
    queryFn: () => endpoints.roofEstimates(saved!.id),
    enabled: Boolean(saved?.id) && can('estimate:read'),
  });

  const draftSnapshot = useMemo(() => snapshotOf(facets), [facets]);
  const dirty = !saved || saved.snapshot !== draftSnapshot;
  const missingPitch = facets.filter((f) => f.pitch === null).length;
  const latestEstimate = estimate ?? estimates.data?.items[0] ?? null;

  const accept = (d: RoofMeasurementDetail, snap: string) => {
    setSaved({ id: d.id, versionNumber: d.versionNumber, snapshot: snap });
    setError(null);
    qc.setQueryData(['roof-measurement', d.id], d);
    void qc.invalidateQueries({ queryKey: ['roof-measurements'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = toRequestFacets(facets);
      if (saved) {
        return endpoints.reviseRoofMeasurement(saved.id, {
          baseVersionNumber: saved.versionNumber,
          facets: body,
        });
      }
      return endpoints.createRoofMeasurement(
        { address: address.trim(), facets: body },
        newIdempotencyKey(),
      );
    },
    onSuccess: (d) => {
      setEstimate(null);
      accept(d, draftSnapshot);
    },
    onError: (e) => setError(errorHint(e)),
  });

  const approve = useMutation({
    mutationFn: () => endpoints.approveRoofMeasurement(saved!.id),
    onSuccess: (d) => accept(d, saved!.snapshot),
    onError: (e) => setError(errorHint(e)),
  });

  const price = useMutation({
    mutationFn: () =>
      endpoints.createRoofEstimate(
        saved!.id,
        {
          wastePercent: waste,
          wasteReason: 'Entered in Roof Measurements',
          redeck,
          prices: {
            shingleBundleMinor: cents(prices.shingle),
            underlaymentRollMinor: cents(prices.underlay),
            deckSheetMinor: redeck ? cents(prices.deck) : null,
          },
          laborPerSquareMinor: labor > 0 ? cents(labor) : null,
          marginPercent: margin,
          taxPercent: tax,
          priceSource:
            [
              shingleRef && `Shingles ${shingleRef.seller}`,
              underlayRef && `Underlayment ${underlayRef.seller}`,
              redeck && deckRef && `Decking ${deckRef.seller}`,
            ]
              .filter(Boolean)
              .join('; ')
              .slice(0, 200) || 'Entered by contractor',
        },
        newIdempotencyKey(),
      ),
    onSuccess: (e) => {
      setEstimate(e);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['roof-estimates', saved?.id] });
      void qc.invalidateQueries({ queryKey: ['roof-measurement', saved?.id] });
      void qc.invalidateQueries({ queryKey: ['roof-measurements'] });
    },
    onError: (e) => setError(errorHint(e)),
  });

  const load = async (id: string) => {
    try {
      const d = await endpoints.roofMeasurement(id);
      const loaded = fromDetail(d);
      onLoad(loaded);
      setEstimate(null);
      accept(d, snapshotOf(loaded));
    } catch (e) {
      setError(errorHint(e));
    }
  };

  const startNew = () => {
    setSaved(null);
    setEstimate(null);
    setAddress('');
    setError(null);
  };

  const versionStatus = detail?.version.status;
  const canSave = can('roof_order:create') && facets.length > 0 && dirty;
  const needsAddress = !saved && address.trim().length < 3;

  return (
    <Panel
      title="Record // save · approve · estimate"
      id="roof-record"
      actions={
        saved ? (
          <button type="button" className="cc-btn cc-btn--sm" onClick={startNew}>
            New record
          </button>
        ) : null
      }
    >
      <div className="cc-stack" style={{ gap: 12 }}>
        {detail && saved ? (
          <div className="cc-record-head">
            <span className="cc-mono">{detail.number}</span>
            <span className="cc-chip">{detail.status.replace(/_/g, ' ')}</span>
            <span className="cc-chip cc-chip--purple">
              v{detail.versionNumber} {versionStatus}
            </span>
            <span className="web-muted web-small">{detail.address}</span>
          </div>
        ) : (
          <label className="cc-field">
            <span>Job address for this record</span>
            <input
              className="cc-input"
              value={address}
              placeholder="1500 Marilla St, Dallas TX 75201"
              onChange={(e) => setAddress(e.currentTarget.value)}
            />
          </label>
        )}

        {detail && (
          <div className="cc-kpis">
            <Kpi label="Server plan" value={num(detail.version.totals.planSqFt, 0)} unit="ft²" />
            <Kpi
              label="Server sloped"
              value={
                detail.version.totals.slopedSqFt === null
                  ? 'pitch?'
                  : num(detail.version.totals.slopedSqFt, 0)
              }
              unit={detail.version.totals.slopedSqFt === null ? undefined : 'ft²'}
              accent
            />
          </div>
        )}

        <div className="cc-actions-row">
          <button
            type="button"
            className="cc-btn cc-btn--sm cc-btn--primary"
            disabled={!canSave || needsAddress || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? 'Saving…'
              : saved
                ? dirty
                  ? 'Save as new version'
                  : 'Saved'
                : 'Save measurement'}
          </button>
          {saved && can('roof_report:approve') && (
            <button
              type="button"
              className="cc-btn cc-btn--sm"
              disabled={dirty || missingPitch > 0 || versionStatus !== 'draft' || approve.isPending}
              title={
                missingPitch > 0
                  ? 'Every facet needs a pitch before approval'
                  : dirty
                    ? 'Save your edits first'
                    : undefined
              }
              onClick={() => approve.mutate()}
            >
              {versionStatus === 'approved'
                ? 'Approved'
                : approve.isPending
                  ? 'Approving…'
                  : 'Approve'}
            </button>
          )}
        </div>
        {saved && dirty && (
          <p className="web-muted web-small" style={{ margin: 0 }}>
            The map has edits that are not saved. Saving creates version{' '}
            {(detail?.versionNumber ?? saved.versionNumber) + 1}; earlier estimates keep the version
            they priced.
          </p>
        )}
        {saved && current.isError && !error && (
          <div className="cc-callout cc-callout--danger" role="alert">
            <p>
              {errorHint(current.error)} Press New record to start a fresh measurement from the map.
            </p>
          </div>
        )}
        {error && (
          <div className="cc-callout cc-callout--danger" role="alert">
            <p>{error}</p>
          </div>
        )}

        {versionStatus === 'approved' && !dirty && can('estimate:write') && (
          <div className="cc-stack" style={{ gap: 10 }}>
            <div className="cc-eyebrow">Estimate from approved v{detail?.versionNumber}</div>
            <div className="cc-form-grid">
              <NumberField
                label="Shingles / bundle"
                suffix="$"
                value={prices.shingle}
                min={0}
                step={0.01}
                onChange={(v) => setPrices((p) => ({ ...p, shingle: v }))}
              />
              <NumberField
                label="Underlayment / roll"
                suffix="$"
                value={prices.underlay}
                min={0}
                step={0.01}
                onChange={(v) => setPrices((p) => ({ ...p, underlay: v }))}
              />
              {redeck && (
                <NumberField
                  label="OSB / sheet"
                  suffix="$"
                  value={prices.deck}
                  min={0}
                  step={0.01}
                  onChange={(v) => setPrices((p) => ({ ...p, deck: v }))}
                />
              )}
              <NumberField
                label="Labor / square"
                suffix="$"
                value={labor}
                min={0}
                step={1}
                onChange={setLabor}
              />
              <NumberField
                label="Margin"
                suffix="%"
                value={margin}
                min={0}
                max={90}
                onChange={setMargin}
              />
              <NumberField
                label="Tax"
                suffix="%"
                value={tax}
                min={0}
                max={25}
                step={0.01}
                onChange={setTax}
              />
            </div>
            <p className="web-muted web-small" style={{ margin: 0 }}>
              Prices start at the cheapest dated reference listing; change them to your supplier
              quote. Waste ({waste}%) and re-deck come from the Measurement panel.
            </p>
            <button
              type="button"
              className="cc-btn cc-btn--sm cc-btn--primary"
              disabled={price.isPending}
              onClick={() => price.mutate()}
            >
              {price.isPending ? 'Pricing…' : 'Create estimate'}
            </button>
          </div>
        )}

        {latestEstimate && (
          <div className="cc-stack" style={{ gap: 8 }}>
            <div className="cc-record-head">
              <span className="cc-mono">{latestEstimate.number}</span>
              <span className="cc-chip cc-chip--amber">
                {latestEstimate.quoteKind.replace(/_/g, ' ')}
              </span>
              <span className="web-muted web-small">
                priced from v{latestEstimate.measurementVersionNumber}
              </span>
            </div>
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col" className="cc-num">
                      Qty
                    </th>
                    <th scope="col" className="cc-num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {latestEstimate.lines.map((l) => (
                    <tr key={l.code}>
                      <td title={l.formula}>{l.description}</td>
                      <td className="cc-num">
                        {l.quantity === null ? '—' : num(Number(l.quantity), 2)}{' '}
                        <span className="web-muted">{l.unit}</span>
                      </td>
                      <td className="cc-num">
                        {l.extendedMinor === null ? 'unpriced' : money(l.extendedMinor / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl style={{ margin: 0 }}>
              <div className="cc-total">
                <dt>Overhead &amp; margin</dt>
                <dd>
                  {money(
                    (latestEstimate.subtotalMinor -
                      latestEstimate.lines.reduce((sum, l) => sum + (l.extendedMinor ?? 0), 0)) /
                      100,
                  )}
                </dd>
              </div>
              <div className="cc-total">
                <dt>Subtotal</dt>
                <dd>{money(latestEstimate.subtotalMinor / 100)}</dd>
              </div>
              <div className="cc-total">
                <dt>Tax</dt>
                <dd>{money(latestEstimate.taxMinor / 100)}</dd>
              </div>
              <div className="cc-total cc-total--grand">
                <dt>Total</dt>
                <dd>{money(latestEstimate.totalMinor / 100)}</dd>
              </div>
            </dl>
            <ul className="web-muted web-small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {latestEstimate.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {list.data && list.data.items.length > 0 && (
          <details>
            <summary className="cc-eyebrow" style={{ cursor: 'pointer' }}>
              Saved measurements ({list.data.items.length})
            </summary>
            <ul className="cc-record-list">
              {list.data.items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="cc-btn cc-btn--sm"
                    onClick={() => void load(m.id)}
                    aria-current={m.id === saved?.id ? 'true' : undefined}
                  >
                    Load
                  </button>
                  <span className="cc-mono">{m.number}</span>
                  <span className="web-small">{m.address}</span>
                  <span className="web-muted web-small">
                    v{m.versionNumber} · {m.status.replace(/_/g, ' ')} · {num(m.planSqFt, 0)} ft²
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}
