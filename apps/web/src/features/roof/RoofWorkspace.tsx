'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AREA_SUMMARIES } from '../../components/AreaPage';
import { RouteGate } from '../../components/RouteGate';
import { referenceUnitPrice, PRICE_BOOK, type MaterialId } from '../build/prices';
import { SupplierLinks } from '../command/MaterialLookup';
import { Kpi, money, money0, num, NumberField, Panel } from '../command/Panel';
import { roofTakeoff, type FacetInput } from './roofTakeoff';

const DRAFT_KEY = 'fieldpro.roof.workspace.v1';

const newId = () => `f-${Math.random().toString(36).slice(2, 8)}`;

const START: FacetInput[] = [
  { id: 'f-1', name: 'Facet A', lengthFt: 40, runFt: 15, pitch: 6 },
  { id: 'f-2', name: 'Facet B', lengthFt: 40, runFt: 15, pitch: 6 },
];

export function RoofWorkspace() {
  return (
    <RouteGate routeId="roof">
      <Workspace />
    </RouteGate>
  );
}

function Workspace() {
  const [facets, setFacets] = useState<FacetInput[]>(START);
  const [waste, setWaste] = useState(10);
  const [redeck, setRedeck] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Restore after paint: reading storage during render would break hydration.
    const handle = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as { facets?: FacetInput[]; waste?: number; redeck?: boolean };
          if (Array.isArray(d.facets) && d.facets.length > 0) setFacets(d.facets);
          if (typeof d.waste === 'number') setWaste(d.waste);
          if (typeof d.redeck === 'boolean') setRedeck(d.redeck);
        }
      } catch {
        // ignore a corrupt draft
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ facets, waste, redeck }));
    } catch {
      // storage unavailable
    }
  }, [facets, waste, redeck, loaded]);

  const deferred = useDeferredValue(facets);
  const result = useMemo(() => roofTakeoff(deferred, waste), [deferred, waste]);

  const materials: { id: MaterialId; qty: number }[] = [
    { id: 'shingle_bundle', qty: result.bundles },
    { id: 'underlayment_roll', qty: result.underlaymentRolls },
    ...(redeck ? [{ id: 'osb_7_16' as const, qty: result.deckSheets }] : []),
  ];
  const lines = materials.map((m) => {
    const ref = referenceUnitPrice(PRICE_BOOK[m.id]);
    return { ...m, ref, total: ref ? ref.price * m.qty : 0 };
  });
  const materialTotal = lines.reduce((s, l) => s + l.total, 0);

  const update = (id: string, patch: Partial<FacetInput>) =>
    setFacets((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const maxLen = Math.max(1, ...result.facets.map((f) => f.lengthFt));
  const sel = result.facets.find((f) => f.id === selected) ?? null;

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">Roof Measurements // Facet takeoff</div>
          <h1 tabIndex={-1} data-route-heading="">
            Roof Measurements
          </h1>
          <p>
            Sketch each roof facet by its plan length, run and pitch. Sloped area, squares and
            material counts use the same slope math as the report engine.
          </p>
        </div>
      </header>

      <div className="cc-split">
        <div className="cc-stack">
          <Panel title="Facet plan view" id="roof-plan">
            <div className="cc-blueprint" style={{ padding: '1rem' }}>
              <div style={{ display: 'grid', gap: 10 }}>
                {result.facets.map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelected(f.id === selected ? null : f.id)}
                    aria-pressed={f.id === selected}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      display: 'grid',
                      gridTemplateColumns: '7rem 1fr',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span className="cc-mono" style={{ fontSize: '0.75rem', color: '#9fb3c8' }}>
                      {f.name}
                    </span>
                    <span
                      style={{
                        position: 'relative',
                        height: Math.max(26, Math.min(80, f.runFt * 3)),
                        width: `${Math.max(8, (f.lengthFt / maxLen) * 100)}%`,
                        border: `1px solid ${f.id === selected ? '#67e8f9' : i % 2 ? '#a78bfa' : '#22d3ee'}`,
                        borderRadius: 6,
                        background:
                          'repeating-linear-gradient(135deg, rgba(34,211,238,0.12) 0 6px, transparent 6px 12px)',
                        boxShadow: f.id === selected ? '0 0 24px rgba(34,211,238,0.35)' : 'none',
                        transition: 'all 260ms cubic-bezier(0.22,1,0.36,1)',
                      }}
                    >
                      <span
                        className="cc-mono"
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: 4,
                          fontSize: '0.7rem',
                          color: '#e6f1ff',
                        }}
                      >
                        {f.pitch}/12 · {num(f.slopedSqFt, 0)} ft²
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="cc-blueprint__scan" aria-hidden="true" />
            </div>
          </Panel>

          <Panel
            title="Facets"
            id="facets"
            actions={
              <button
                type="button"
                className="cc-btn cc-btn--sm cc-btn--primary"
                onClick={() =>
                  setFacets((fs) => [
                    ...fs,
                    {
                      id: newId(),
                      name: `Facet ${String.fromCharCode(65 + fs.length)}`,
                      lengthFt: 20,
                      runFt: 12,
                      pitch: 6,
                    },
                  ])
                }
              >
                Add facet
              </button>
            }
          >
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Facet</th>
                    <th scope="col">Length (ft)</th>
                    <th scope="col">Run (ft)</th>
                    <th scope="col">Pitch (/12)</th>
                    <th scope="col" className="cc-num">
                      Sloped ft²
                    </th>
                    <th scope="col">
                      <span className="cc-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {facets.map((f) => {
                    const r = result.facets.find((x) => x.id === f.id);
                    return (
                      <tr key={f.id}>
                        <td>
                          <input
                            className="cc-input"
                            aria-label="Facet name"
                            value={f.name}
                            onChange={(e) => update(f.id, { name: e.currentTarget.value })}
                          />
                        </td>
                        {(['lengthFt', 'runFt', 'pitch'] as const).map((k) => (
                          <td key={k}>
                            <input
                              className="cc-input"
                              type="number"
                              min={0}
                              step={k === 'pitch' ? 0.5 : 0.1}
                              aria-label={`${f.name} ${k}`}
                              value={Number.isFinite(f[k]) ? f[k] : ''}
                              onChange={(e) =>
                                update(f.id, { [k]: e.currentTarget.valueAsNumber || 0 })
                              }
                            />
                          </td>
                        ))}
                        <td className="cc-num">{r ? num(r.slopedSqFt, 0) : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="cc-iconbtn"
                            aria-label={`Remove ${f.name}`}
                            disabled={facets.length === 1}
                            onClick={() => setFacets((fs) => fs.filter((x) => x.id !== f.id))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Materials" id="roof-materials">
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Material</th>
                    <th scope="col" className="cc-num">
                      Qty
                    </th>
                    <th scope="col" className="cc-num">
                      Cheapest ref.
                    </th>
                    <th scope="col" className="cc-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{PRICE_BOOK[l.id].label}</strong>
                        <div style={{ marginTop: 6 }}>
                          <SupplierLinks query={PRICE_BOOK[l.id].searchQuery} />
                        </div>
                      </td>
                      <td className="cc-num">
                        {l.qty} <span className="web-muted">{PRICE_BOOK[l.id].unit}</span>
                      </td>
                      <td className="cc-num">
                        {l.ref ? money(l.ref.price) : '—'}
                        {l.ref && <span className="cc-formula">{l.ref.seller}</span>}
                      </td>
                      <td className="cc-num">{money0(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="web-muted web-small" style={{ marginTop: 8 }}>
              Reference prices are dated retailer listings. Use House Builder for live supplier
              scans.
            </p>
          </Panel>
        </div>

        <aside className="cc-rail" aria-label="Roof totals">
          <Panel title="Measurement" id="roof-kpis">
            <div className="cc-kpis">
              <Kpi label="Plan area" value={num(result.planSqFt, 0)} unit="ft²" />
              <Kpi label="Sloped area" value={num(result.slopedSqFt, 0)} unit="ft²" accent />
              <Kpi label="Squares" value={num(result.squares, 2)} />
              <Kpi label="+ waste" value={num(result.squaresWithWaste, 2)} unit="sq" />
              <Kpi label="Bundles" value={result.bundles} />
              <Kpi label="Underlay" value={result.underlaymentRolls} unit="rolls" />
            </div>
            <div className="cc-form-grid" style={{ marginTop: 12 }}>
              <NumberField
                label="Waste"
                suffix="%"
                value={waste}
                min={0}
                max={40}
                onChange={setWaste}
              />
              <label className="cc-field">
                <span>Re-deck</span>
                <select
                  className="cc-input"
                  value={redeck ? 'yes' : 'no'}
                  onChange={(e) => setRedeck(e.currentTarget.value === 'yes')}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes, 7/16 OSB</option>
                </select>
              </label>
            </div>
            <dl style={{ margin: '12px 0 0' }}>
              <div className="cc-total cc-total--grand">
                <dt>Materials (ref.)</dt>
                <dd>{money0(materialTotal)}</dd>
              </div>
            </dl>
          </Panel>

          {sel && (
            <Panel title="Selected facet" id="roof-facet">
              <div className="cc-kpis">
                <Kpi label={sel.name} value={`${sel.pitch}/12`} />
                <Kpi label="Slope factor" value={sel.slopeFactor.toFixed(3)} />
                <Kpi label="Plan" value={num(sel.planSqFt, 0)} unit="ft²" />
                <Kpi label="Sloped" value={num(sel.slopedSqFt, 0)} unit="ft²" accent />
              </div>
            </Panel>
          )}

          <div className="cc-callout cc-callout--info">
            <p>{AREA_SUMMARIES.roof} This workspace is the manual takeoff in the meantime.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
