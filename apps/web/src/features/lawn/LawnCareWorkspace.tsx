'use client';

import { useMemo, useState } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { AccountDraftStatus, useAccountDraft } from '../../lib/accountDrafts';
import { Kpi, money, NumberField, Panel, SelectField } from '../command/Panel';
import { LawnSatelliteMap } from './LawnSatelliteMap';
import {
  measureLawnRegions, migrateLegacyLawnPolygon, validRegionPoints, type LawnRegion,
} from './mapGeometry';
import {
  computeLawnQuote, DEFAULT_LAWN, quoteCsv, SCHEDULE_LABELS, type Coordinate,
  type LawnSpec, type Schedule,
} from './estimate';

const OPTIONS = (Object.keys(SCHEDULE_LABELS) as Schedule[]).map(value => ({
  value, label: SCHEDULE_LABELS[value],
}));

const hasFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function restoreSpec(raw: unknown): LawnSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const next: LawnSpec = { ...DEFAULT_LAWN };
  for (const [key, fallback] of Object.entries(DEFAULT_LAWN)) {
    const val = candidate[key];
    if (typeof fallback === 'string') {
      if (key === 'schedule' && !Object.keys(SCHEDULE_LABELS).includes(String(val))) continue;
      if (key === 'areaSource' && val !== 'manual' && val !== 'satellite' && val !== 'field') continue;
      if (typeof val === 'string') (next as unknown as Record<string, unknown>)[key] = val.slice(0, 2500);
    } else if (typeof fallback === 'boolean') {
      if (typeof val === 'boolean') (next as unknown as Record<string, unknown>)[key] = val;
    } else if (typeof fallback === 'number' && hasFinite(val)) {
      (next as unknown as Record<string, unknown>)[key] = Math.min(10_000_000, Math.max(0, val));
    }
  }
  return next;
}

export function LawnCareWorkspace() {
  return <RouteGate routeId="lawn"><LawnContent /></RouteGate>;
}

function LawnContent() {
  const [spec, setSpec] = useState<LawnSpec>({ ...DEFAULT_LAWN });
  const [regions, setRegions] = useState<LawnRegion[]>([]);
  const [exportStatus, setExportStatus] = useState('');
  const cloudDraft = useAccountDraft({
    key: 'lawn-workspace',
    legacyKey: 'fieldpro.lawn.draft.v1',
    value: { spec, regions },
    onRestore: (raw: {
      spec?: LawnSpec; regions?: LawnRegion[]; polygon?: Coordinate[];
    }) => {
      const cleaned = restoreSpec(raw.spec);
      if (cleaned) setSpec(cleaned);
      if (Array.isArray(raw.regions) && validRegionPoints(raw.regions)) {
        setRegions(raw.regions);
      } else if (Array.isArray(raw.polygon) && raw.polygon.length <= 150 &&
        raw.polygon.every(p => p && hasFinite(p.lon) && hasFinite(p.lat) &&
          p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180)) {
        setRegions(migrateLegacyLawnPolygon(raw.polygon));
      }
    },
  });
  const quote = useMemo(() => computeLawnQuote(spec), [spec]);
  const update = <K extends keyof LawnSpec>(field: K, value: LawnSpec[K]) =>
    setSpec(prev => ({ ...prev, [field]: value }));
  const num = <K extends keyof LawnSpec>(key: K) => (value: number) =>
    setSpec(prev => ({
      ...prev,
      [key]: Math.min(10_000_000, Math.max(0, value)),
      ...((key === 'areaSqFt' || key === 'excludedSqFt') && prev.areaSource === 'satellite'
        ? { areaSource: 'manual' as const } : {}),
    }));
  const changeRegions = (next: LawnRegion[]) => {
    setRegions(next);
    // A previously applied satellite result must never silently remain priced after
    // a user edits, clears, or invalidates its boundaries.
    const measured = measureLawnRegions(next);
    setSpec(prev => prev.areaSource !== 'satellite' ? prev :
      measured.valid
        ? { ...prev, areaSqFt: measured.grossSqFt, excludedSqFt: measured.excludedSqFt }
        : { ...prev, areaSqFt: 0, excludedSqFt: 0 });
  };
  const service = (key: keyof LawnSpec, label: string) => (
    <label className="cc-field" style={{ display: 'flex', gap: 10,
      alignItems: 'center', flexDirection: 'row' }}>
      <input type="checkbox" checked={Boolean(spec[key])}
        onChange={event => update(key, event.currentTarget.checked as never)} />
      <span>{label}</span>
    </label>
  );
  const download = (filename: string, body: string, mime: string) => {
    const href = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement('a');
    a.href = href; a.download = filename; a.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 100);
  };
  const quoteSummary = [
    'Lawn care estimate',
    spec.customer ? 'Customer: ' + spec.customer : '',
    spec.address ? 'Property: ' + spec.address : '',
    'Frequency: ' + SCHEDULE_LABELS[spec.schedule],
    'Net lawn area: ' + quote.netSqFt.toLocaleString() + ' ft²',
    'Area source: ' + (spec.areaSource === 'field' ? 'User-confirmed on-site' :
      spec.areaSource === 'satellite' ? 'Approximate satellite traces' : 'Manual estimate'),
    ...quote.lines.map(l => l.label + ': ' + money(l.amount)),
    'Per visit: ' + money(quote.perVisit),
    'Projected monthly: ' + money(quote.monthlyProjection),
    'Projected annual / one-time: ' + money(quote.annualProjection),
    spec.notes ? 'Notes: ' + spec.notes : '',
    'Planning estimate only. Verify lawn area, access, travel, weather and local taxes.',
  ].filter(Boolean).join('\n');

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">Lawn & Landscape // Grass Cutting</div>
          <h1 tabIndex={-1} data-route-heading="">Lawn Care</h1>
          <p>Measure lawns from satellite imagery, price mowing and landscaping services,
            and make one-time or recurring quotes for your customers.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="cc-btn" onClick={() => window.print()}>
            Print quote
          </button>
          <button type="button" className="cc-btn cc-btn--primary"
            onClick={() => download('lawn-care-estimate.csv',
              quoteCsv(spec, quote), 'text/csv;charset=utf-8')}>
            Download quote CSV
          </button>
        </div>
      </header>

      <AccountDraftStatus status={cloudDraft.status} message={cloudDraft.message}
        onImport={cloudDraft.importLegacy} onReload={cloudDraft.reload} />

      <div className="cc-split" style={{ alignItems: 'start' }}>
        <div className="cc-stack">
          <Panel title="1 · Property & measurement" id="lawn-property">
            <div className="cc-form-grid" style={{ marginBottom: 12 }}>
              <label className="cc-field">
                <span>Customer / company</span>
                <input className="cc-input" maxLength={120} value={spec.customer}
                  placeholder="Customer name" onChange={e => update('customer', e.currentTarget.value)} />
              </label>
              <label className="cc-field">
                <span>Property address</span>
                <input className="cc-input" maxLength={220} value={spec.address}
                  placeholder="Street, city and ZIP"
                  onChange={e => update('address', e.currentTarget.value)} />
              </label>
            </div>
            <LawnSatelliteMap regions={regions} onChange={changeRegions}
              address={spec.address} onAddressSelected={value => update('address', value)}
              onUseArea={(grossSqFt, excludedSqFt) => setSpec(prev => ({
                ...prev, areaSqFt: grossSqFt, excludedSqFt, areaSource: 'satellite',
              }))} />
            <div className="cc-form-grid" style={{ marginTop: 12 }}>
              <NumberField label="Gross lawn area" value={spec.areaSqFt}
                min={0} step={100} suffix="ft²" onChange={num('areaSqFt')} />
              <NumberField label="Exclude patios, beds, pools and buildings"
                value={spec.excludedSqFt} min={0} step={50}
                suffix="ft²" onChange={num('excludedSqFt')} />
            </div>
            <label className="cc-field" style={{ flexDirection: 'row', alignItems: 'center',
              gap: 9, marginTop: 10 }}>
              <input type="checkbox" checked={spec.areaSource === 'field'}
                onChange={event => update('areaSource', event.currentTarget.checked
                  ? 'field' : 'manual')} />
              <span>I have verified the edited measurements on site with a tape, wheel or survey</span>
            </label>
            <div className="cc-callout" style={{ marginTop: 12 }} role="status">
              <strong>{quote.netSqFt.toLocaleString()} ft² of mowable turf</strong>
              {' · '}{quote.acres} acres · {spec.areaSource === 'satellite'
                ? 'Satellite polygon estimate' : spec.areaSource === 'field'
                ? 'User-marked field measurement' : 'Manual area estimate'}
              <p className="web-muted web-small">The map uses multiple grass outlines minus mapped
                exclusions. A field measurement is more reliable than an obscured aerial outline;
                check slopes, shadows, trees and property access before quoting.</p>
            </div>
          </Panel>

          <Panel title="2 · Grass cutting & schedule" id="lawn-mowing">
            <div className="cc-form-grid">
              <SelectField label="Recurring frequency" value={spec.schedule}
                options={OPTIONS} onChange={v => update('schedule', v)} />
              <NumberField label="Mowing charge" suffix="$/1,000 ft²" min={0}
                value={spec.mowPer1000} onChange={num('mowPer1000')} />
              <NumberField label="Minimum mowing charge" suffix="$" min={0}
                value={spec.minimumMow} onChange={num('minimumMow')} />
              <NumberField label="Slope / access adjustment" suffix="×" min={1} max={3}
                step={0.1} value={spec.terrainFactor}
                onChange={v => update('terrainFactor', Math.max(1, Math.min(3, v)))} />
            </div>
            <div className="cc-callout cc-callout--info" style={{ marginTop: 12 }}>
              <p>All rates are editable illustrative defaults, <strong>not live local prices</strong>.
                Set your own equipment, labor, fuel, property-access and travel costs before
                sending a customer quote. Recurrence is a forecast, not a booked schedule.</p>
            </div>
          </Panel>

          <Panel title="3 · Services & editable prices" id="lawn-services">
            <div className="cc-stack" style={{ gap: 15 }}>
              <div className="cc-form-grid">
                <div>{service('mow', 'Mow grass')}</div>
                <div>{service('edge', 'Edge driveway & sidewalks')}</div>
                <div>{service('trim', 'Weed-eat / string trim')}</div>
                <div>{service('blow', 'Blow off pavement')}</div>
              </div>
              <div className="cc-form-grid">
                {spec.edge && <><NumberField label="Edging length" suffix="linear ft" min={0}
                  value={spec.edgingFeet} onChange={num('edgingFeet')} />
                  <NumberField label="Edging rate" suffix="$/ft" min={0} step={0.05}
                    value={spec.edgingRate} onChange={num('edgingRate')} /></>}
                {spec.trim && <><NumberField label="String trimming time" suffix="minutes" min={0}
                  value={spec.trimmingMinutes} onChange={num('trimmingMinutes')} />
                  <NumberField label="Crew rate" suffix="$/hr" min={0}
                    value={spec.hourlyRate} onChange={num('hourlyRate')} /></>}
                {spec.blow && <NumberField label="Blowing / cleanup" suffix="$/visit"
                  value={spec.blowingFee} min={0} onChange={num('blowingFee')} />}
              </div>
              <div className="cc-form-grid">
                <div>{service('leaf', 'Leaf cleanup & bagging')}</div>
                <div>{service('hedge', 'Hedge & shrub trimming')}</div>
                <div>{service('mulch', 'Install mulch')}</div>
                <div>{service('fertilize', 'Fertilize turf')}</div>
                <div>{service('aerate', 'Core aeration')}</div>
                <div>{service('seed', 'Overseed lawn')}</div>
                <div>{service('sod', 'Lay new sod')}</div>
              </div>
              <div className="cc-form-grid">
                {spec.leaf && <><NumberField label="Leaf bags" value={spec.leafBags}
                  onChange={num('leafBags')} min={0} />
                  <NumberField label="Leaf bag rate" value={spec.leafBagRate} min={0}
                    onChange={num('leafBagRate')} suffix="$/bag" /></>}
                {spec.hedge && <><NumberField label="Hedge run" value={spec.hedgeFeet}
                  onChange={num('hedgeFeet')} min={0} suffix="ft" />
                  <NumberField label="Hedge rate" value={spec.hedgeFootRate}
                    onChange={num('hedgeFootRate')} min={0} suffix="$/ft" /></>}
                {spec.mulch && <><NumberField label="Mulch volume" value={spec.mulchYards}
                  onChange={num('mulchYards')} min={0} suffix="yd³" />
                  <NumberField label="Installed mulch rate" value={spec.mulchYardRate}
                    onChange={num('mulchYardRate')} min={0} suffix="$/yd³" /></>}
                {spec.fertilize && <NumberField label="Fertilizer" suffix="$/1,000 ft²"
                  value={spec.fertilizerPer1000} onChange={num('fertilizerPer1000')} min={0} />}
                {spec.aerate && <NumberField label="Aeration" suffix="$/1,000 ft²"
                  value={spec.aerationPer1000} onChange={num('aerationPer1000')} min={0} />}
                {spec.seed && <NumberField label="Overseeding" suffix="$/1,000 ft²"
                  value={spec.seedingPer1000} onChange={num('seedingPer1000')} min={0} />}
                {spec.sod && <><NumberField label="Sod area" value={spec.sodSqFt}
                  onChange={num('sodSqFt')} min={0} suffix="ft²" />
                  <NumberField label="Installed sod rate" value={spec.sodPerSqFt}
                    onChange={num('sodPerSqFt')} min={0} suffix="$/ft²" /></>}
                <NumberField label="Trip / equipment fee" suffix="$" min={0}
                  value={spec.tripFee} onChange={num('tripFee')} />
                <NumberField label="Estimated sales tax (if applicable)" suffix="%" min={0}
                  value={spec.taxPercent} onChange={num('taxPercent')} />
              </div>
              <label className="cc-field">
                <span>Notes, access gates, pets, terrain, equipment, customer instructions</span>
                <textarea className="cc-input" value={spec.notes} maxLength={2500}
                  rows={4} onChange={e => update('notes', e.currentTarget.value)} />
              </label>
            </div>
          </Panel>
        </div>

        <aside className="cc-rail" aria-label="Lawn care quote summary">
          <Panel title="Estimate preview" id="lawn-estimate">
            <div className="cc-kpis" style={{ marginBottom: 14 }}>
              <Kpi label="Mowable lawn" value={quote.netSqFt.toLocaleString()}
                unit="ft²" accent />
              <Kpi label="Per visit" value={money(quote.perVisit)} accent />
              <Kpi label="Monthly projection" value={money(quote.monthlyProjection)} />
              <Kpi label="Crew hours (estimate)" value={quote.estimatedCrewHours} />
            </div>
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead><tr>
                  <th scope="col">Service</th>
                  <th scope="col" className="cc-num">Qty</th>
                  <th scope="col" className="cc-num">Total</th>
                </tr></thead>
                <tbody>
                  {quote.lines.map(line => (
                    <tr key={line.id}>
                      <td><strong>{line.label}</strong>
                        <span className="cc-formula">{line.detail}</span>
                      </td>
                      <td className="cc-num">{Number(line.qty.toFixed(2))} {line.unit}</td>
                      <td className="cc-num">{money(line.amount)}</td>
                    </tr>
                  ))}
                  {quote.lines.length === 0 && (
                    <tr><td colSpan={3} className="web-muted">Select a service and enter an area.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <dl style={{ margin: '12px 0 0' }}>
              <div className="cc-total"><dt>Services</dt>
                <dd>{money(quote.subtotal)}</dd></div>
              <div className="cc-total"><dt>Estimated tax (verify rules)</dt>
                <dd>{money(quote.tax)}</dd></div>
              <div className="cc-total cc-total--grand"><dt>Per visit</dt>
                <dd>{money(quote.perVisit)}</dd></div>
              <div className="cc-total"><dt>Frequency</dt>
                <dd>{SCHEDULE_LABELS[spec.schedule]}</dd></div>
              <div className="cc-total"><dt>Projected monthly</dt>
                <dd>{money(quote.monthlyProjection)}</dd></div>
              <div className="cc-total"><dt>{spec.schedule === 'one_time' ? 'One-time' : 'Annual projection'}</dt>
                <dd>{money(quote.annualProjection)}</dd></div>
            </dl>
            <div className="cc-callout" style={{ marginTop: 12 }}>
              <p className="web-muted web-small">
                Estimates, not signed contracts. Verify site access, obstacles, crew size,
                disposal, costs, local ordinances and any applicable taxes.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="cc-btn cc-btn--sm cc-btn--primary" type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(quoteSummary);
                    setExportStatus('Quote copied for sharing.');
                  } catch {
                    setExportStatus('Clipboard unavailable. Use the CSV download or print.');
                  }
                }}>Copy quote</button>
              <button className="cc-btn cc-btn--sm" type="button"
                onClick={() => download('lawn-care-estimate.csv', quoteCsv(spec, quote), 'text/csv;charset=utf-8')}>
                Export CSV</button>
              <button className="cc-btn cc-btn--sm" type="button" onClick={() => window.print()}>
                Print / Save PDF</button>
            </div>
            {exportStatus && <p role="status" className="web-muted web-small">{exportStatus}</p>}
          </Panel>
          <Panel title="Connected contractor tools" id="lawn-connect">
            <p className="web-muted web-small">
              Your lawn quote is stored privately in your account.
              Existing Jobs and Invoices can be opened here; automatic conversion to a CRM
              job or invoice is not yet enabled for lawn services.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="cc-btn cc-btn--sm" href="/jobs">Jobs & scheduling</a>
              <a className="cc-btn cc-btn--sm" href="/invoice-dashboard">Invoices</a>
              <a className="cc-btn cc-btn--sm" href="/bidding">Job bidding</a>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
