'use client';

// House Builder workspace (HB-001..003): footprint + room program -> schematic floor plan ->
// deterministic material takeoff -> priced estimate using the referenced price book, with live
// cheapest-first lookups and retailer links per material. Planning estimate only: no MEP, labor,
// permits or engineering, and the page says so.
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { MaterialLookup, OfferList, SupplierLinks } from '../command/MaterialLookup';
import { Kpi, money, money0, num, NumberField, Panel, SelectField } from '../command/Panel';
import { FloorPlan } from './FloorPlan';
import { fetchLivePrices } from './live';
import { PRICE_BOOK, type LivePriceResponse, type MaterialId } from './prices';
import {
  computeTakeoff,
  DEFAULT_SPEC,
  priceTakeoff,
  type BuildSpec,
  type PriceOverride,
  type TakeoffGroup,
} from './takeoff';

const DRAFT_KEY = 'fieldpro.build.draft.v1';

interface Costs {
  taxPercent: number;
  deliveryFee: number;
  contingencyPercent: number;
  laborPerSqFt: number;
  mepPerSqFt: number;
}

const DEFAULT_COSTS: Costs = {
  taxPercent: 8.25,
  deliveryFee: 0,
  contingencyPercent: 10,
  laborPerSqFt: 0,
  mepPerSqFt: 0,
};

interface Draft {
  spec: BuildSpec;
  costs: Costs;
  location: string;
  overrides: Partial<Record<MaterialId, PriceOverride>>;
}

const GROUP_ORDER: readonly TakeoffGroup[] = [
  'Foundation',
  'Framing',
  'Roof',
  'Envelope',
  'Interior',
  'Openings',
];

const BASIS_LABEL = {
  listing: 'listed price',
  typical: 'typical retail',
  live: 'live price',
  manual: 'your price',
} as const;

export function BuildEstimatorView() {
  return (
    <RouteGate routeId="build">
      <BuildWorkspace />
    </RouteGate>
  );
}

function BuildWorkspace() {
  const [spec, setSpec] = useState<BuildSpec>(DEFAULT_SPEC);
  const [costs, setCosts] = useState<Costs>(DEFAULT_COSTS);
  const [location, setLocation] = useState('Dallas, Texas, United States');
  const [overrides, setOverrides] = useState<Partial<Record<MaterialId, PriceOverride>>>({});
  const [loaded, setLoaded] = useState(false);
  const [floorIndex, setFloorIndex] = useState(0);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [live, setLive] = useState<Partial<Record<MaterialId, LivePriceResponse | 'loading'>>>({});
  const [openRow, setOpenRow] = useState<MaterialId | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const autoScanAttempt = useRef('');
  const [dailyPriceStatus, setDailyPriceStatus] = useState('');

  // Restore / persist the working draft in this browser.
  useEffect(() => {
    // Restore after paint: reading storage during render would break hydration.
    const handle = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as Partial<Draft>;
          if (d.spec) setSpec({ ...DEFAULT_SPEC, ...d.spec });
          if (d.costs) setCosts({ ...DEFAULT_COSTS, ...d.costs });
          if (typeof d.location === 'string') setLocation(d.location);
          if (d.overrides) setOverrides(d.overrides);
        }
      } catch {
        // Corrupt draft: start fresh.
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      const draft: Draft = { spec, costs, location, overrides };
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage unavailable.
    }
  }, [spec, costs, location, overrides, loaded]);

  // Typing stays responsive: the heavy recompute follows a deferred copy of the inputs.
  const deferredSpec = useDeferredValue(spec);
  const takeoff = useMemo(() => computeTakeoff(deferredSpec), [deferredSpec]);
  const priced = useMemo(() => priceTakeoff(takeoff.lines, overrides), [takeoff.lines, overrides]);

  const area = takeoff.layout.conditionedAreaSqFt;
  const materials = priced.total;
  const tax = (materials * costs.taxPercent) / 100;
  const contingency = ((materials + tax) * costs.contingencyPercent) / 100;
  const labor = costs.laborPerSqFt * area;
  const mep = costs.mepPerSqFt * area;
  const grand = materials + tax + costs.deliveryFee + contingency + labor + mep;
  const floors = takeoff.layout.floors;
  const safeFloor = Math.min(floorIndex, floors.length - 1);
  const room = [
    ...floors.flatMap((f) => f.rooms),
    ...(takeoff.layout.garage ? [takeoff.layout.garage] : []),
  ].find((r) => r.id === activeRoom);

  const set = <K extends keyof BuildSpec>(key: K, value: BuildSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));
  const setCost = <K extends keyof Costs>(key: K, value: number) =>
    setCosts((c) => ({ ...c, [key]: Math.max(0, value) }));

  async function lookup(id: MaterialId) {
    setOpenRow(id);
    setLive((l) => ({ ...l, [id]: 'loading' }));
    const res = await fetchLivePrices(PRICE_BOOK[id].searchQuery, location);
    setLive((l) => ({ ...l, [id]: res }));
    return res;
  }

  async function scanAll() {
    setScanBusy(true);
    const ids = [...new Set(takeoff.lines.map((l) => l.material))];
    for (const id of ids) {
      const res = await lookup(id);
      if (!res.live) break; // not configured: one message is enough
    }
    setOpenRow(null);
    setScanBusy(false);
  }

  // Refresh once per calendar day when the workspace is opened. The web server needs a configured
  // supplier feed; browser closure cannot guarantee any background refresh.
  useEffect(() => {
    if (!loaded) return;
    const ids=[...new Set(takeoff.lines.map(line=>line.material))];
    if(ids.length===0)return;
    const day=new Date().toISOString().slice(0,10);
    const signature=day+'|'+location+'|'+ids.join(',');
    if(autoScanAttempt.current===signature)return;
    autoScanAttempt.current=signature;
    let cancelled=false;
    const storageKey='fieldpro.house.price-check.v1';
    try{if(window.localStorage.getItem(storageKey)===signature){
      queueMicrotask(()=>{if(!cancelled)setDailyPriceStatus('Supplier prices were checked today in this browser.');});
      return;
    }}catch{}
    void (async()=>{
      const first=await fetchLivePrices(PRICE_BOOK[ids[0]!].searchQuery,location);
      if(cancelled)return;
      setLive(current=>({...current,[ids[0]!]:first}));
      if(!first.live){
        setDailyPriceStatus(first.message??'No live supplier feed is configured; dated estimates remain visible.');
        return;
      }
      // Keep requests sequential to avoid hammering a paid provider.
      for(const id of ids.slice(1)){
        if(cancelled)break;
        const response=await fetchLivePrices(PRICE_BOOK[id].searchQuery,location);
        if(cancelled)break;
        setLive(current=>({...current,[id]:response}));
      }
      if(!cancelled){
        setDailyPriceStatus('Supplier offers were checked today. Verify each listing and unit before ordering.');
        try{window.localStorage.setItem(storageKey,signature);}catch{}
      }
    })();
    return()=>{cancelled=true;};
  },[loaded,location,takeoff.lines]);

  function applyAllCheapest() {
    setOverrides((o) => {
      const next = { ...o };
      for (const [id, res] of Object.entries(live)) {
        if (res && res !== 'loading' && res.live && res.offers[0]) {
          next[id as MaterialId] = {
            unitPrice: res.offers[0].price,
            seller: res.offers[0].seller,
            basis: 'live',
          };
        }
      }
      return next;
    });
  }

  const liveResults = Object.values(live).filter(
    (r): r is LivePriceResponse => !!r && r !== 'loading',
  );
  const liveConfigured = liveResults.some((r) => r.live);
  const liveNotice = liveResults.find((r) => !r.live)?.message;

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">House Builder // Takeoff + Pricing</div>
          <h1 tabIndex={-1} data-route-heading="">
            House Builder
          </h1>
          <p>
            Enter the footprint and room program. The plan, every material quantity and a priced
            estimate update instantly. Prices come from dated retailer listings; run a live scan to
            find the cheapest current seller near the job.
          </p>
        </div>
        <div className="cc-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="cc-btn" onClick={() => window.print()}>
            Print estimate
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() => {
              setSpec(DEFAULT_SPEC);
              setCosts(DEFAULT_COSTS);
              setOverrides({});
              setLive({});
            }}
          >
            Reset
          </button>
        </div>
      </header>

      <div className="cc-split">
        <div className="cc-stack">
          <Panel title="Build program" id="program">
            <div className="cc-form-grid">
              <NumberField
                label="Length"
                suffix="ft"
                value={spec.lengthFt}
                min={20}
                max={120}
                onChange={(v) => set('lengthFt', v)}
              />
              <NumberField
                label="Width"
                suffix="ft"
                value={spec.widthFt}
                min={20}
                max={80}
                onChange={(v) => set('widthFt', v)}
              />
              <SelectField
                label="Stories"
                value={spec.stories}
                options={[
                  { value: 1, label: '1 story' },
                  { value: 2, label: '2 stories' },
                ]}
                onChange={(v) => {
                  set('stories', v as 1 | 2);
                  setFloorIndex(0);
                }}
              />
              <NumberField
                label="Bedrooms"
                value={spec.bedrooms}
                min={1}
                max={6}
                onChange={(v) => set('bedrooms', v)}
              />
              <NumberField
                label="Bathrooms"
                value={spec.bathrooms}
                min={1}
                max={5}
                onChange={(v) => set('bathrooms', v)}
              />
              <SelectField
                label="Garage"
                value={spec.garage}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'one_car', label: '1-car (12 × 22)' },
                  { value: 'two_car', label: '2-car (22 × 22)' },
                ]}
                onChange={(v) => set('garage', v)}
              />
              <SelectField
                label="Wall height"
                value={spec.wallHeightFt}
                options={[
                  { value: 8, label: '8 ft' },
                  { value: 9, label: '9 ft' },
                  { value: 10, label: '10 ft' },
                ]}
                onChange={(v) => set('wallHeightFt', v as 8 | 9 | 10)}
              />
              <NumberField
                label="Roof pitch"
                suffix="/12"
                value={spec.roofPitch}
                min={0}
                max={14}
                step={0.5}
                onChange={(v) => set('roofPitch', Math.max(0, Math.min(14, v)))}
              />
              <NumberField
                label="Overhang"
                suffix="ft"
                value={spec.overhangFt}
                min={0}
                max={3}
                step={0.5}
                onChange={(v) => set('overhangFt', v)}
              />
              <SelectField
                label="Stud spacing"
                value={spec.studSpacingIn}
                options={[
                  { value: 16, label: '16 in o.c.' },
                  { value: 24, label: '24 in o.c.' },
                ]}
                onChange={(v) => set('studSpacingIn', v as 16 | 24)}
              />
              <NumberField
                label="Waste"
                suffix="%"
                value={spec.wastePercent}
                min={0}
                max={30}
                onChange={(v) => set('wastePercent', v)}
              />
            </div>
          </Panel>

          <Panel
            title="Schematic floor plan"
            id="plan"
            actions={
              floors.length > 1 ? (
                <span role="tablist" aria-label="Floor" style={{ display: 'inline-flex', gap: 4 }}>
                  {floors.map((f, i) => (
                    <button
                      key={f.level}
                      type="button"
                      role="tab"
                      aria-selected={i === safeFloor}
                      aria-pressed={i === safeFloor}
                      className="cc-iconbtn"
                      onClick={() => setFloorIndex(i)}
                    >
                      F{f.level}
                    </button>
                  ))}
                </span>
              ) : undefined
            }
          >
            <FloorPlan
              layout={takeoff.layout}
              floorIndex={safeFloor}
              activeRoomId={activeRoom}
              onSelect={(id) => setActiveRoom((cur) => (cur === id ? null : id))}
            />
            {takeoff.layout.warnings.length > 0 && (
              <div className="cc-callout" style={{ marginTop: 10 }} role="status">
                <p>{takeoff.layout.warnings.join(' ')}</p>
              </div>
            )}
          </Panel>

          <Panel
            title="Material takeoff + pricing"
            id="materials"
            actions={
              <span className="cc-no-print" style={{ display: 'inline-flex', gap: 6 }}>
                <button
                  type="button"
                  className="cc-btn cc-btn--sm cc-btn--primary"
                  disabled={scanBusy}
                  onClick={scanAll}
                >
                  {scanBusy ? 'Scanning suppliers…' : 'Scan live prices'}
                </button>
                {liveConfigured && (
                  <button type="button" className="cc-btn cc-btn--sm" onClick={applyAllCheapest}>
                    Use all cheapest
                  </button>
                )}
              </span>
            }
          >
            {dailyPriceStatus && <p className="web-muted web-small" role="status">{dailyPriceStatus}</p>}
            {liveNotice && !liveConfigured && (
              <div
                className="cc-callout cc-callout--info"
                style={{ marginBottom: 10 }}
                role="status"
              >
                <p>{liveNotice}</p>
              </div>
            )}
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Material</th>
                    <th scope="col" className="cc-num">
                      Qty
                    </th>
                    <th scope="col" className="cc-num">
                      Unit price
                    </th>
                    <th scope="col" className="cc-num">
                      Total
                    </th>
                    <th scope="col" className="cc-no-print">
                      <span className="cc-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {GROUP_ORDER.map((group) => {
                    const rows = priced.lines.filter((l) => l.group === group);
                    if (rows.length === 0) return null;
                    const groupTotal = rows.reduce((s, r) => s + (r.total ?? 0), 0);
                    return (
                      <Fragment key={group}>
                        <tr className="cc-group-row">
                          <td colSpan={3}>{group}</td>
                          <td className="cc-num">{money0(groupTotal)}</td>
                          <td className="cc-no-print" />
                        </tr>
                        {rows.map((line) => {
                          const mat = PRICE_BOOK[line.material];
                          const res = live[line.material];
                          const open = openRow === line.material;
                          return (
                            <Fragment key={line.key}>
                              <tr>
                                <td>
                                  <strong>{mat.label}</strong>
                                  <span className="cc-formula">{line.formula}</span>
                                </td>
                                <td className="cc-num">
                                  {num(line.quantity)} <span className="web-muted">{mat.unit}</span>
                                </td>
                                <td className="cc-num">
                                  {line.unitPrice === null ? (
                                    <span className="cc-chip cc-chip--amber">needs price</span>
                                  ) : (
                                    <>
                                      {money(line.unitPrice)}
                                      <span className="cc-formula">
                                        {line.seller} · {line.basis ? BASIS_LABEL[line.basis] : ''}
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td className="cc-num">
                                  {line.total === null ? '—' : money0(line.total)}
                                </td>
                                <td className="cc-no-print">
                                  <button
                                    type="button"
                                    className="cc-iconbtn"
                                    aria-expanded={open}
                                    aria-label={`Prices and suppliers for ${mat.label}`}
                                    onClick={() => setOpenRow(open ? null : line.material)}
                                  >
                                    {open ? '▴' : '$'}
                                  </button>
                                </td>
                              </tr>
                              {open && (
                                <tr>
                                  <td colSpan={5}>
                                    <PriceDrawer
                                      material={line.material}
                                      result={res}
                                      override={overrides[line.material]}
                                      onLookup={() => void lookup(line.material)}
                                      onSet={(o) =>
                                        setOverrides((cur) => {
                                          const next = { ...cur };
                                          if (o) next[line.material] = o;
                                          else delete next[line.material];
                                          return next;
                                        })
                                      }
                                    />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="cc-rail" aria-label="Estimate summary">
          <Panel title="Telemetry" id="kpis">
            <div className="cc-kpis">
              <Kpi label="Conditioned" value={num(area, 0)} unit="ft²" accent />
              <Kpi label="Slab" value={num(takeoff.summary.slabAreaSqFt, 0)} unit="ft²" />
              <Kpi label="Concrete" value={num(takeoff.summary.concreteYd3)} unit="yd³" />
              <Kpi label="Roof" value={num(takeoff.summary.roofSquares)} unit="sq" />
              <Kpi
                label="Ext. wall"
                value={num(takeoff.summary.exteriorWallAreaSqFt, 0)}
                unit="ft²"
              />
              <Kpi label="Partitions" value={num(takeoff.summary.interiorWallFt, 0)} unit="LF" />
            </div>
          </Panel>

          <Panel title="Estimate" id="estimate">
            <div className="cc-form-grid" style={{ marginBottom: 10 }}>
              <NumberField
                label="Sales tax"
                suffix="%"
                value={costs.taxPercent}
                step={0.25}
                onChange={(v) => setCost('taxPercent', v)}
              />
              <NumberField
                label="Delivery"
                suffix="$"
                value={costs.deliveryFee}
                step={25}
                onChange={(v) => setCost('deliveryFee', v)}
              />
              <NumberField
                label="Contingency"
                suffix="%"
                value={costs.contingencyPercent}
                onChange={(v) => setCost('contingencyPercent', v)}
              />
              <NumberField
                label="Labor"
                suffix="$/ft²"
                value={costs.laborPerSqFt}
                step={1}
                onChange={(v) => setCost('laborPerSqFt', v)}
              />
              <NumberField
                label="MEP + finishes"
                suffix="$/ft²"
                value={costs.mepPerSqFt}
                step={1}
                onChange={(v) => setCost('mepPerSqFt', v)}
              />
            </div>
            <dl style={{ margin: 0 }}>
              <div className="cc-total">
                <dt>Materials ({priced.lines.length - priced.unpriced} priced lines)</dt>
                <dd>{money0(materials)}</dd>
              </div>
              <div className="cc-total">
                <dt>Sales tax</dt>
                <dd>{money0(tax)}</dd>
              </div>
              <div className="cc-total">
                <dt>Delivery</dt>
                <dd>{money0(costs.deliveryFee)}</dd>
              </div>
              <div className="cc-total">
                <dt>Contingency</dt>
                <dd>{money0(contingency)}</dd>
              </div>
              {labor > 0 && (
                <div className="cc-total">
                  <dt>Labor allowance</dt>
                  <dd>{money0(labor)}</dd>
                </div>
              )}
              {mep > 0 && (
                <div className="cc-total">
                  <dt>MEP + finishes allowance</dt>
                  <dd>{money0(mep)}</dd>
                </div>
              )}
              <div className="cc-total cc-total--grand">
                <dt>Total</dt>
                <dd>{money0(grand)}</dd>
              </div>
              <div className="cc-total">
                <dt>Per conditioned ft²</dt>
                <dd>{area > 0 ? money(grand / area) : '—'}</dd>
              </div>
            </dl>
            {priced.unpriced > 0 && (
              <div className="cc-callout" style={{ marginTop: 10 }}>
                <p>
                  {priced.unpriced} line{priced.unpriced === 1 ? ' has' : 's have'} no published
                  reference price and {priced.unpriced === 1 ? 'is' : 'are'} not in the total. Open
                  the line to run a live lookup or enter your supplier&apos;s price.
                </p>
              </div>
            )}
            <div className="cc-callout cc-callout--info" style={{ marginTop: 10 }}>
              <p>
                Planning estimate for a slab-on-grade, wood-framed house. Excludes electrical,
                plumbing, HVAC, finishes, permits, engineering and labor unless you add allowances
                above. Confirm structure and code with a licensed professional.
              </p>
            </div>
          </Panel>

          <Panel title="Live supplier scan" id="live">
            <label className="cc-field" style={{ marginBottom: 10 }}>
              <span>Job location</span>
              <input
                className="cc-input"
                value={location}
                maxLength={120}
                onChange={(e) => setLocation(e.currentTarget.value)}
              />
            </label>
            <MaterialLookup location={location} />
          </Panel>

          {room && (
            <Panel title="Selected space" id="room">
              <div className="cc-kpis">
                <Kpi label={room.name} value={`${room.w}′ × ${room.h}′`} />
                <Kpi label="Area" value={num(room.w * room.h, 0)} unit="ft²" accent />
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

function PriceDrawer({
  material,
  result,
  override,
  onLookup,
  onSet,
}: {
  material: MaterialId;
  result: LivePriceResponse | 'loading' | undefined;
  override: PriceOverride | undefined;
  onLookup: () => void;
  onSet: (o: PriceOverride | null) => void;
}) {
  const mat = PRICE_BOOK[material];
  const [manual, setManual] = useState(
    override?.basis === 'manual' ? String(override.unitPrice) : '',
  );
  return (
    <div className="cc-stack" style={{ gap: '0.6rem', padding: '0.3rem 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {mat.range && (
          <span className="cc-chip">
            RANGE {money(mat.range.low)} – {money(mat.range.high)} / {mat.unit}
          </span>
        )}
        {mat.offers.map((o) => (
          <span key={o.sourceUrl + o.price} className="cc-chip cc-chip--purple" title={o.note}>
            {o.sellerName ?? o.supplier.replace('_', ' ').toUpperCase()} {money(o.price)}
          </span>
        ))}
        <span className="web-muted web-small">
          Source:{' '}
          {mat.source.url ? (
            <a href={mat.source.url} target="_blank" rel="noopener noreferrer">
              {mat.source.title}
            </a>
          ) : (
            mat.source.title
          )}{' '}
          ({mat.asOf})
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
        <button
          type="button"
          className="cc-btn cc-btn--sm cc-btn--primary"
          disabled={result === 'loading'}
          onClick={onLookup}
        >
          {result === 'loading' ? 'Scanning…' : 'Find cheapest live'}
        </button>
        <form
          style={{ display: 'flex', gap: 6, alignItems: 'end' }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(manual);
            if (Number.isFinite(n) && n > 0)
              onSet({ unitPrice: n, seller: 'Your supplier', basis: 'manual' });
          }}
        >
          <label className="cc-field" style={{ width: 130 }}>
            <span>My price / {mat.unit}</span>
            <input
              className="cc-input"
              inputMode="decimal"
              value={manual}
              onChange={(e) => setManual(e.currentTarget.value)}
            />
          </label>
          <button type="submit" className="cc-btn cc-btn--sm">
            Apply
          </button>
        </form>
        {override && (
          <button type="button" className="cc-btn cc-btn--sm" onClick={() => onSet(null)}>
            Back to reference price
          </button>
        )}
      </div>
      {result === 'loading' && <div className="cc-skeleton" style={{ height: 48 }} />}
      {result && result !== 'loading' && (
        <OfferList
          result={result}
          onUse={(o) => onSet({ unitPrice: o.price, seller: o.seller, basis: 'live' })}
        />
      )}
      <SupplierLinks query={mat.searchQuery} />
    </div>
  );
}
