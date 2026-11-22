'use client';

// House Studio workbench (tabs under the 3D studio). Everything here reads and writes the same
// house as the studio above, so a change in one place shows up everywhere:
//   My houses       save / open / rename / copy / trash / restore (StudioHouses)
//   Ground-up build every item from site prep to final clean, grouped by the studio's 16 phases,
//                   with step-by-step guidance, what you have on hand and your own prices
//   Prices          official BLS price indexes checked when the page opens, auto escalation
//   Deal check      build cost vs sale price for contractors
//   Lot             lot lines, setbacks, fit check and the real surroundings ("In real life")
import {
  type MaterialIndexesResponse,
  MaterialIndexesResponseSchema,
  type SiteContextResponse,
  SiteContextResponseSchema,
  type StudioDeal,
  type StudioHouse,
  type StudioLot,
} from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useApi } from '../../lib/session';
import {
  DEFAULT_DEAL,
  DEFAULT_LOT,
  PHASE_GUIDE,
  dealCheck,
  groundUpLines,
  lotFit,
  phaseTotals,
} from './groundUp';
import { PRICE_BOOK, type MaterialId } from './prices';
import { PHASES, type PhaseId, type StudioCostSettings } from './studioCost';
import { StudioHouses, problemText, type CurrentHouse, type HouseSnapshot } from './StudioHouses';
import type { BuildSpec, PriceOverride, PricedLine, Takeoff } from './takeoff';
import { CadEditor } from './CadEditor';
import { QuickBuildPanel } from './QuickBuildPanel';

type Tab = 'houses' | 'quick' | 'cad' | 'build' | 'prices' | 'deal' | 'lot';
const TABS: { id: Tab; label: string }[] = [
  { id: 'houses', label: 'My houses' },
  { id: 'quick', label: 'Quick build' },
  { id: 'cad', label: 'CAD plan' },
  { id: 'build', label: 'Ground-up build' },
  { id: 'prices', label: 'Prices' },
  { id: 'deal', label: 'Deal check' },
  { id: 'lot', label: 'Lot & surroundings' },
];

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const usd2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

export interface WorkbenchProps {
  takeoff: Takeoff;
  priced: readonly PricedLine[];
  buildCost: number;
  step: PhaseId;
  onStep: (step: PhaseId) => void;
  onHand: Partial<Record<MaterialId, number>>;
  onOnHand: (next: Partial<Record<MaterialId, number>>) => void;
  overrides: Partial<Record<MaterialId, PriceOverride>>;
  onOverrides: (next: Partial<Record<MaterialId, PriceOverride>>) => void;
  studioCosts: StudioCostSettings;
  onStudioCosts: (next: StudioCostSettings) => void;
  autoEscalation: boolean;
  onAutoEscalation: (on: boolean) => void;
  deal: StudioDeal;
  onDeal: (next: StudioDeal) => void;
  lot: StudioLot | null;
  onLot: (next: StudioLot | null) => void;
  surroundings: SiteContextResponse | null;
  onSurroundings: (next: SiteContextResponse | null) => void;
  realLife: boolean;
  onRealLife: (on: boolean) => void;
  location: string;
  current: CurrentHouse | null;
  onCurrent: (next: CurrentHouse | null) => void;
  snapshot: () => HouseSnapshot;
  onOpenHouse: (house: StudioHouse) => void;
  /** The client's stated budget (from the AI bar), in cents. */
  budgetCents: number | null;
  spec: BuildSpec;
  onSpec: (next: BuildSpec) => void;
  onUndo: () => boolean;
  canUndo: boolean;
}

export function StudioWorkbench(props: WorkbenchProps) {
  const [tab, setTab] = useState<Tab>('houses');
  return (
    <section className="wb" aria-label="House Studio tools">
      <div className="wb-tabbar" role="tablist" aria-label="House Studio tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`wb-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`wb-panel-${t.id}`}
            className={`wb-tab ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wb-panel" role="tabpanel" id={`wb-panel-${tab}`} aria-labelledby={`wb-tab-${tab}`}>
        {tab === 'houses' && (
          <StudioHouses current={props.current} onCurrentChange={props.onCurrent} snapshot={props.snapshot} onOpen={props.onOpenHouse} />
        )}
        {tab === 'quick' && (
          <QuickBuildPanel
            spec={props.spec}
            onSpec={props.onSpec}
            studioCosts={props.studioCosts}
            onStudioCosts={props.onStudioCosts}
            overrides={props.overrides}
            lot={props.lot}
            location={props.location}
          />
        )}
        {tab === 'cad' && (
          <>
            <div className="wb-actions">
              <button type="button" className="hs-pill" disabled={!props.canUndo} onClick={() => props.onUndo()}>
                Undo last house change
              </button>
            </div>
            <CadEditor spec={props.spec} onSpec={props.onSpec} />
          </>
        )}
        {tab === 'build' && <GroundUpPanel {...props} />}
        {tab === 'prices' && <PricesPanel {...props} />}
        {tab === 'deal' && <DealPanel {...props} />}
        {tab === 'lot' && <LotPanel {...props} />}
      </div>
    </section>
  );
}

// --- Ground-up build -------------------------------------------------------------------------

function GroundUpPanel({ priced, step, onStep, onHand, onOnHand, overrides, onOverrides }: WorkbenchProps) {
  const [scope, setScope] = useState<'phase' | 'general' | 'all'>('phase');
  const [filter, setFilter] = useState('');
  const lines = useMemo(() => groundUpLines(priced, onHand), [priced, onHand]);
  const totals = useMemo(() => phaseTotals(lines), [lines]);
  const guide = PHASE_GUIDE[step];
  const shown = lines.filter((l) => {
    if (scope === 'phase' && l.phase !== step) return false;
    if (scope === 'general' && l.phase !== null) return false;
    const term = filter.trim().toLowerCase();
    return !term || PRICE_BOOK[l.material].label.toLowerCase().includes(term);
  });
  const shownBuy = shown.reduce((sum, l) => sum + (l.buyTotal ?? 0), 0);
  const shownUnpriced = shown.filter((l) => l.buyTotal === null).length;
  const allBuy = lines.reduce((sum, l) => sum + (l.buyTotal ?? 0), 0);
  const saved = lines.reduce((sum, l) => sum + (l.unitPrice === null ? 0 : l.unitPrice * l.onHand), 0);

  const setPrice = (material: MaterialId, raw: string) => {
    const next = { ...overrides };
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n < 0) delete next[material];
    else next[material] = { unitPrice: Math.min(n, 10_000_000), seller: 'Your price', basis: 'manual' };
    onOverrides(next);
  };
  const setHave = (material: MaterialId, raw: string) => {
    const next = { ...onHand };
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n <= 0) delete next[material];
    else next[material] = Math.min(n, 1_000_000);
    onOnHand(next);
  };

  return (
    <div className="wb-build">
      <div className="wb-phases" role="group" aria-label="Construction phase">
        {PHASES.map((p) => {
          const t = totals.get(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`wb-phase ${scope === 'phase' && step === p.id ? 'is-on' : ''}`}
              aria-pressed={scope === 'phase' && step === p.id}
              onClick={() => {
                setScope('phase');
                onStep(p.id);
              }}
            >
              <span>{String(p.id).padStart(2, '0')}</span>
              <strong>{p.name}</strong>
              <em>{t ? `${t.items} items` : '0 items'}</em>
            </button>
          );
        })}
        <button type="button" className={`wb-phase ${scope === 'general' ? 'is-on' : ''}`} aria-pressed={scope === 'general'} onClick={() => setScope('general')}>
          <span>All</span>
          <strong>General supplies</strong>
          <em>{totals.get(null)?.items ?? 0} items</em>
        </button>
        <button type="button" className={`wb-phase ${scope === 'all' ? 'is-on' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
          <span>{lines.length}</span>
          <strong>Every item</strong>
          <em>whole house</em>
        </button>
      </div>

      <div className="wb-build-grid">
        <div className="wb-card">
          {scope === 'phase' ? (
            <>
              <h3>
                Step {step}: {PHASES[step - 1]!.name}
              </h3>
              <ol className="wb-steps">
                {guide.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p className="wb-check">
                <strong>Before moving on:</strong> {guide.check}
              </p>
            </>
          ) : (
            <>
              <h3>{scope === 'general' ? 'General supplies' : 'Every item, ground up'}</h3>
              <p className="wb-muted">
                {scope === 'general'
                  ? 'Tools and consumables used across many phases (blades, bits, foam, gloves).'
                  : 'The full list from erosion fence to the mailbox. Pick a phase to see how it is built.'}
              </p>
            </>
          )}
          <dl className="wb-sums">
            <div>
              <dt>To buy here</dt>
              <dd>{usd(shownBuy)}</dd>
            </div>
            <div>
              <dt>Unpriced here</dt>
              <dd>{shownUnpriced}</dd>
            </div>
            <div>
              <dt>Whole house</dt>
              <dd>{usd(allBuy)}</dd>
            </div>
            <div>
              <dt>Saved by stock on hand</dt>
              <dd>{usd(saved)}</dd>
            </div>
          </dl>
          <p className="wb-muted">
            Quantities are planning takeoffs with waste included, not a stamped plan. Items with no published price stay
            unpriced until you enter your supplier&apos;s price; your prices are saved with the house.
          </p>
        </div>

        <div className="wb-card wb-table-card">
          <div className="wb-row">
            <input
              className="wb-input"
              value={filter}
              placeholder="Filter items (nails, truss, drywall…)"
              aria-label="Filter items"
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="wb-muted">{shown.length} items</span>
          </div>
          <div className="wb-table-wrap">
            <table className="wb-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Need</th>
                  <th scope="col">Have</th>
                  <th scope="col">Buy</th>
                  <th scope="col">Unit price</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const book = PRICE_BOOK[l.material];
                  const mine = overrides[l.material];
                  return (
                    <tr key={l.key}>
                      <th scope="row">
                        <span className="wb-item-label">{book.label.replace(' · allowance', '')}</span>
                        <span className="wb-muted">
                          {l.group}
                          {scope !== 'phase' && l.phase ? ` · step ${l.phase}` : ''}
                          {l.provisional ? ' · allowance' : ''}
                        </span>
                      </th>
                      <td>
                        {qty(l.quantity)} {book.unit}
                      </td>
                      <td>
                        <input
                          className="wb-num"
                          inputMode="decimal"
                          aria-label={`On hand: ${book.label}`}
                          defaultValue={onHand[l.material] ?? ''}
                          onBlur={(e) => setHave(l.material, e.target.value)}
                        />
                      </td>
                      <td>{qty(l.buy)}</td>
                      <td>
                        <input
                          className={`wb-num ${mine?.basis === 'manual' ? 'is-mine' : ''}`}
                          inputMode="decimal"
                          aria-label={`Unit price: ${book.label}`}
                          placeholder={l.unitPrice === null ? 'Enter price' : ''}
                          defaultValue={l.unitPrice ?? ''}
                          key={`${l.material}:${l.unitPrice ?? 'none'}`}
                          onBlur={(e) => {
                            if (e.target.value !== String(l.unitPrice ?? '')) setPrice(l.material, e.target.value);
                          }}
                        />
                      </td>
                      <td>{l.buyTotal === null ? <span className="wb-muted">unpriced</span> : usd2(l.buyTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Prices ----------------------------------------------------------------------------------

export function useMaterialIndexes() {
  const { api } = useApi();
  return useQuery({
    queryKey: ['material-indexes'],
    queryFn: () => api.get('/v1/market/material-indexes', { schema: MaterialIndexesResponseSchema }),
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

function Sparkline({ points }: { points: { value: number }[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const d = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (vals.length - 1)) * 100},${hi === lo ? 15 : 28 - ((v - lo) / (hi - lo)) * 26}`)
    .join(' ');
  return (
    <svg className="wb-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Change({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="wb-muted">{label} n/a</span>;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span className={flat ? 'wb-flat' : up ? 'wb-up' : 'wb-down'}>
      {flat ? '■' : up ? '▲' : '▼'} {Math.abs(value).toFixed(2)}% {label}
    </span>
  );
}

function PricesPanel({ studioCosts, onStudioCosts, autoEscalation, onAutoEscalation }: WorkbenchProps) {
  const indexes = useMaterialIndexes();
  const data: MaterialIndexesResponse | undefined = indexes.data;
  return (
    <div className="wb-prices">
      <div className="wb-row">
        <p className="wb-muted">
          Official U.S. Bureau of Labor Statistics producer price indexes for building materials, checked each time you
          open the builder (the server re-checks at most every few hours). They are published monthly, so a new number
          appears about once a month. Stores are not scraped.
        </p>
        <button type="button" className="hs-pill" disabled={indexes.isFetching} onClick={() => void indexes.refetch()}>
          {indexes.isFetching ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {indexes.error && <p className="hs-ai-error" role="alert">{problemText(indexes.error)}</p>}
      {data && (
        <>
          <p className="wb-muted" role="status">
            {data.status === 'unavailable' ? data.message : `Checked ${new Date(data.checkedAt).toLocaleString('en-US')}`}
            {data.message && data.status !== 'unavailable' ? ` · ${data.message}` : ''} · Source:{' '}
            <a href={data.source.url} target="_blank" rel="noreferrer">
              {data.source.name}
            </a>
          </p>
          <div className="wb-ticker">
            {data.indexes.map((ix) => (
              <div key={ix.id} className="wb-tick">
                <span className="wb-tick-name">{ix.label}</span>
                <strong>{ix.latest ? ix.latest.value.toFixed(1) : '—'}</strong>
                <span className="wb-muted">
                  {ix.latest ? `${ix.latest.period}${ix.preliminary ? ' (preliminary)' : ''}` : 'no data'} · {ix.seriesId}
                </span>
                <Change value={ix.changeMonthPercent} label="1 mo" />
                <Change value={ix.changeYearPercent} label="1 yr" />
                <Sparkline points={ix.history} />
              </div>
            ))}
          </div>
        </>
      )}
      <div className="wb-card">
        <h3>Escalation used in the studio estimate</h3>
        <p>
          The studio prices each system from the NAHB 2024 cost survey and adds escalation to bring it to today.
          {data?.escalation
            ? ` The official index for home-building inputs moved ${data.escalation.percent.toFixed(2)}% from ${data.escalation.fromPeriod} to ${data.escalation.toPeriod}.`
            : ' The live index is not available right now, so the dated default stays in place.'}
        </p>
        <label className="wb-toggle">
          <input
            type="checkbox"
            checked={autoEscalation}
            disabled={!data?.escalation}
            onChange={(e) => {
              onAutoEscalation(e.target.checked);
              if (e.target.checked && data?.escalation) onStudioCosts({ ...studioCosts, escalationPercent: data.escalation.percent });
            }}
          />
          Follow the official index automatically
        </label>
        <p className="wb-muted">Now using {studioCosts.escalationPercent.toFixed(2)}% escalation and a regional factor of {studioCosts.regionalFactor.toFixed(2)}.</p>
      </div>
    </div>
  );
}

// --- Deal check ------------------------------------------------------------------------------

function NumberInput({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="wb-field">
      <span>{label}</span>
      <span className="wb-field-box">
        <input
          className="wb-input"
          type="number"
          min={0}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) && n >= 0 ? n : 0);
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

function DealPanel({ buildCost, deal, onDeal, takeoff, budgetCents }: WorkbenchProps) {
  const result = dealCheck(buildCost, deal);
  const area = Math.max(1, takeoff.layout.conditionedAreaSqFt);
  const set = (patch: Partial<StudioDeal>) => onDeal({ ...deal, ...patch });
  return (
    <div className="wb-deal">
      <div className="wb-card">
        <h3>Your numbers</h3>
        <NumberInput label="Expected sale price" value={deal.salePrice} step={1000} onChange={(n) => set({ salePrice: Math.min(n, 1e9) })} suffix="$" />
        <NumberInput label="Lot cost" value={deal.lotCost} step={1000} onChange={(n) => set({ lotCost: Math.min(n, 1e9) })} suffix="$" />
        <NumberInput label="Financing" value={deal.financingPercent} step={0.25} onChange={(n) => set({ financingPercent: Math.min(n, 25) })} suffix="% of sale" />
        <NumberInput label="Sales commission" value={deal.commissionPercent} step={0.25} onChange={(n) => set({ commissionPercent: Math.min(n, 10) })} suffix="% of sale" />
        <NumberInput label="Overhead" value={deal.overheadPercent} step={0.25} onChange={(n) => set({ overheadPercent: Math.min(n, 40) })} suffix="% of sale" />
        <p className="wb-muted">Enter your own figures. Nothing here is a market appraisal.</p>
        {budgetCents !== null && budgetCents > 0 && (
          <p className={buildCost + deal.lotCost <= budgetCents / 100 ? 'wb-up' : 'wb-down'} role="status">
            Client budget {usd(budgetCents / 100)}: build cost{deal.lotCost > 0 ? ' plus lot' : ''} is{' '}
            {usd(Math.abs(budgetCents / 100 - buildCost - deal.lotCost))}{' '}
            {buildCost + deal.lotCost <= budgetCents / 100 ? 'under' : 'over'} it.
          </p>
        )}
      </div>
      <div className="wb-card">
        <h3>Result</h3>
        <dl className="wb-sums wb-sums--wide">
          <div>
            <dt>Build cost (studio estimate)</dt>
            <dd>
              {usd(result.buildCost)} <span className="wb-muted">{usd(result.buildCost / area)}/sq ft</span>
            </dd>
          </div>
          <div>
            <dt>Lot, financing, commission, overhead</dt>
            <dd>{usd(deal.lotCost + result.financing + result.commission + result.overhead)}</dd>
          </div>
          <div>
            <dt>Total cost</dt>
            <dd>{usd(result.totalCost)}</dd>
          </div>
          <div>
            <dt>Profit</dt>
            <dd className={result.profit >= 0 ? 'wb-up' : 'wb-down'}>{deal.salePrice > 0 ? usd(result.profit) : 'enter a sale price'}</dd>
          </div>
          <div>
            <dt>Margin on sale</dt>
            <dd>{result.marginPercent === null ? '—' : `${result.marginPercent}%`}</dd>
          </div>
          <div>
            <dt>Break-even sale price</dt>
            <dd>{Number.isFinite(result.breakEvenPrice) ? usd(result.breakEvenPrice) : '—'}</dd>
          </div>
        </dl>
        <p className="wb-muted">
          Build cost is the studio&apos;s installed cost (materials, labor and trade costs from the NAHB 2024 survey, escalated).
          Your own material prices on the Ground-up tab feed the supply list below, not this survey-based total.
        </p>
      </div>
    </div>
  );
}

// --- Lot & surroundings ----------------------------------------------------------------------

function LotPanel({ takeoff, lot, onLot, surroundings, onSurroundings, realLife, onRealLife, location }: WorkbenchProps) {
  const { api } = useApi();
  const current = lot ?? { ...DEFAULT_LOT, address: location };
  const fit = lotFit(takeoff, current);
  const [busy, setBusy] = useState<'find' | 'map' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<StudioLot>) => onLot({ ...current, ...patch });

  async function find() {
    const q = current.address.trim();
    if (q.length < 3) {
      setNote('Type the lot address first.');
      return;
    }
    setBusy('find');
    setNote(null);
    try {
      // User-initiated single lookup on the public OpenStreetMap geocoder (no bulk use).
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { accept: 'application/json' },
      });
      const rows = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
      const hit = rows[0];
      const lat = Number(hit?.lat);
      const lon = Number(hit?.lon);
      if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        setNote('That address was not found on the map. Check the spelling or add the city and state.');
        return;
      }
      set({ lat, lon });
      onSurroundings(null);
      setNote(`Found: ${String(hit.display_name ?? q).slice(0, 140)}`);
    } catch {
      setNote('The map search did not answer. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  async function loadSurroundings() {
    if (current.lat === null || current.lon === null) return;
    setBusy('map');
    try {
      const ctx = await api.post('/v1/site/context', { lat: current.lat, lon: current.lon, radiusM: 150 }, { schema: SiteContextResponseSchema });
      onSurroundings(ctx);
      set({ realLife: true });
      onRealLife(true);
      setNote(ctx.message);
    } catch (e) {
      setNote(problemText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wb-lot">
      <div className="wb-card">
        <h3>Lot</h3>
        <div className="wb-row">
          <input
            className="wb-input wb-grow"
            value={current.address}
            maxLength={200}
            placeholder="Lot address"
            aria-label="Lot address"
            onChange={(e) => set({ address: e.target.value, lat: null, lon: null })}
          />
          <button type="button" className="hs-pill" disabled={busy !== null} onClick={() => void find()}>
            {busy === 'find' ? 'Finding…' : 'Find on map'}
          </button>
        </div>
        <div className="wb-grid2">
          <NumberInput label="Lot width (street side)" value={current.widthFt} onChange={(n) => set({ widthFt: Math.min(Math.max(n, 20), 5000) })} suffix="ft" />
          <NumberInput label="Lot depth" value={current.depthFt} onChange={(n) => set({ depthFt: Math.min(Math.max(n, 20), 5000) })} suffix="ft" />
          <NumberInput label="Front setback" value={current.frontSetbackFt} onChange={(n) => set({ frontSetbackFt: Math.min(n, 500) })} suffix="ft" />
          <NumberInput label="Side setback (each)" value={current.sideSetbackFt} onChange={(n) => set({ sideSetbackFt: Math.min(n, 500) })} suffix="ft" />
          <NumberInput label="Rear setback" value={current.rearSetbackFt} onChange={(n) => set({ rearSetbackFt: Math.min(n, 500) })} suffix="ft" />
        </div>
        <p className={fit.fits ? 'wb-up' : 'wb-down'} role="status">
          {fit.messages.join(' ')}
        </p>
        <p className="wb-muted">
          House with garage: {Math.round(fit.houseWidthFt)} × {Math.round(fit.houseDepthFt)} ft. Buildable area: {Math.round(fit.buildableWidthFt)} ×{' '}
          {Math.round(fit.buildableDepthFt)} ft. The lot lines show in yellow in the 3D view. Setbacks here are your inputs; the city and the survey decide the real ones.
        </p>
        {lot && (
          <button type="button" className="hs-pill" onClick={() => { onLot(null); onSurroundings(null); }}>
            Remove lot
          </button>
        )}
      </div>
      <div className="wb-card">
        <h3>In real life</h3>
        <p>
          Show the real buildings, streets and mapped trees around the lot (OpenStreetMap), in daylight. Use “Find on map”
          first.
        </p>
        <div className="wb-row">
          <button
            type="button"
            className="hs-pill is-on"
            disabled={busy !== null || current.lat === null || current.lon === null}
            onClick={() => void loadSurroundings()}
          >
            {busy === 'map' ? 'Loading surroundings…' : surroundings ? 'Reload surroundings' : 'Show real surroundings'}
          </button>
          <label className="wb-toggle">
            <input type="checkbox" checked={realLife} onChange={(e) => onRealLife(e.target.checked)} />
            Real-life view
          </label>
          {surroundings && (
            <button type="button" className="hs-pill" onClick={() => onSurroundings(null)}>
              Hide surroundings
            </button>
          )}
        </div>
        {current.lat !== null && current.lon !== null && (
          <p className="wb-muted">
            Point: {current.lat.toFixed(5)}, {current.lon.toFixed(5)}
          </p>
        )}
        {note && <p className="wb-muted" role="status">{note}</p>}
        {surroundings && (
          <p className="wb-muted">
            {surroundings.attribution}. Mapped data can be missing or out of date. The new house is placed at the address
            point; it is not yet turned to face the real street.
          </p>
        )}
      </div>
    </div>
  );
}

export { DEFAULT_DEAL, DEFAULT_LOT };
