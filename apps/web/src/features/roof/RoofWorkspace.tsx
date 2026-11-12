'use client';

import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AREA_SUMMARIES } from '../../components/AreaPage';
import { RouteGate } from '../../components/RouteGate';
import { referenceUnitPrice, PRICE_BOOK, type MaterialId } from '../build/prices';
import { SupplierLinks } from '../command/MaterialLookup';
import { Kpi, money, money0, num, NumberField, Panel } from '../command/Panel';
import { measureRoof, type MapFacet } from './map/facetMath';
import { RoofRecordPanel } from './RoofRecordPanel';
import { roofTakeoff, type FacetInput } from './roofTakeoff';

// The map bundle (MapLibre + imagery) only loads on the client, in its own chunk.
const RoofMap = dynamic(() => import('./map/RoofMap').then((m) => m.RoofMap), {
  ssr: false,
  loading: () => (
    <div className="cc-roofmap__stage" aria-busy="true">
      <div className="cc-roofmap__overlay">
        <span className="cc-mono">Loading map module…</span>
      </div>
    </div>
  ),
});

type Mode = 'map' | 'manual';
type LonLat = { lon: number; lat: number };

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
  const [mode, setMode] = useState<Mode>('map');
  const [mapFacets, setMapFacets] = useState<MapFacet[]>([]);
  const [houseOutline, setHouseOutline] = useState<LonLat[]>([]);
  const [fitSignal, setFitSignal] = useState(0);

  useEffect(() => {
    // Restore after paint: reading storage during render would break hydration.
    const handle = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw) as {
            facets?: FacetInput[];
            waste?: number;
            redeck?: boolean;
            mode?: Mode;
            mapFacets?: MapFacet[];
            houseOutline?: LonLat[];
          };
          if (d.mode === 'map' || d.mode === 'manual') setMode(d.mode);
          if (Array.isArray(d.mapFacets)) setMapFacets(d.mapFacets);
          if (Array.isArray(d.houseOutline) && d.houseOutline.length >= 3 &&
            d.houseOutline.length <= 200 && d.houseOutline.every(p => Number.isFinite(p.lon) && Number.isFinite(p.lat))) {
            setHouseOutline(d.houseOutline);
          }
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
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ facets, waste, redeck, mode, mapFacets, houseOutline }),
      );
    } catch {
      // storage unavailable
    }
  }, [facets, waste, redeck, mode, mapFacets, houseOutline, loaded]);

  // Traced facets: lon/lat rings -> measured plan area. Facets without a confirmed pitch are
  // listed but kept out of squares until the pitch is entered.
  const mapResult = useMemo(() => measureRoof(mapFacets), [mapFacets]);
  const mapInputs = useMemo<FacetInput[]>(
    () =>
      mapResult.facets
        .filter((r) => r.pitch !== null)
        .map((r) => ({
          id: r.id,
          name: r.name,
          lengthFt: 0,
          runFt: 0,
          pitch: r.pitch ?? 0,
          planSqFtOverride: r.planSqFt,
        })),
    [mapResult],
  );

  const deferred = useDeferredValue(mode === 'map' ? mapInputs : facets);
  const result = useMemo(() => roofTakeoff(deferred, waste), [deferred, waste]);

  const onFacetDrawn = useCallback((ring: LonLat[]) => {
    setMapFacets((fs) => {
      const id = newId();
      setSelected(id);
      return [
        ...fs,
        { id, name: `Facet ${String.fromCharCode(65 + (fs.length % 26))}`, ring, pitch: null },
      ];
    });
  }, []);
  const updateMap = (id: string, patch: Partial<MapFacet>) =>
    setMapFacets((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

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
  const selMap = mode === 'map' ? (mapResult.facets.find((f) => f.id === selected) ?? null) : null;

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">Roof Measurements // Facet takeoff</div>
          <h1 tabIndex={-1} data-route-heading="">
            Roof Measurements
          </h1>
          <p>
            Trace each roof facet on satellite imagery, or sketch it by plan length and run. Sloped
            area, squares and material counts use the same slope math as the report engine.
          </p>
        </div>
        <div className="cc-seg" role="group" aria-label="Measurement method">
          {(['map', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={mode === m ? 'cc-seg__btn cc-seg__btn--on' : 'cc-seg__btn'}
              onClick={() => {
                setMode(m);
                setSelected(null);
              }}
            >
              {m === 'map' ? 'Map trace' : 'Manual sketch'}
            </button>
          ))}
        </div>
      </header>

      <div className="cc-split">
        <div className="cc-stack">
          {mode === 'map' && (
            <>
              <Panel title="Roof map // trace facets" id="roof-map">
                <RoofMap
                  facets={mapFacets}
                  results={mapResult.facets}
                  selectedId={selected}
                  onSelect={setSelected}
                  onFacetDrawn={onFacetDrawn}
                  fitSignal={fitSignal}
                  outline={houseOutline}
                  onOutlineDrawn={setHouseOutline}
                />
              </Panel>
              {houseOutline.length >= 3 && <div className="cc-callout cc-callout--info">
                <p>Clean footprint saved locally ({houseOutline.length} corners). This outline is for
                  display only; roof areas and material takeoffs still require separately measured facets.</p>
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => setHouseOutline([])}>
                  Remove clean outline
                </button>
              </div>}
              <Panel title="Traced facets" id="map-facets">
                {mapFacets.length === 0 ? (
                  <p className="web-muted">
                    Fly to the job address, press Trace facet, and click each corner of one roof
                    plane. Click the first point again to close it. Repeat for every plane.
                  </p>
                ) : (
                  <div className="cc-table-wrap">
                    <table className="cc-table">
                      <thead>
                        <tr>
                          <th scope="col">Facet</th>
                          <th scope="col">Pitch (/12)</th>
                          <th scope="col" className="cc-num">
                            Plan ft²
                          </th>
                          <th scope="col" className="cc-num">
                            Perimeter ft
                          </th>
                          <th scope="col" className="cc-num">
                            Sloped ft²
                          </th>
                          <th scope="col">
                            <span className="cc-sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapFacets.map((f) => {
                          const r = mapResult.facets.find((x) => x.id === f.id);
                          return (
                            <tr
                              key={f.id}
                              aria-selected={f.id === selected}
                              className={f.id === selected ? 'cc-row--selected' : undefined}
                            >
                              <td>
                                <input
                                  className="cc-input"
                                  aria-label="Facet name"
                                  value={f.name}
                                  onFocus={() => setSelected(f.id)}
                                  onChange={(e) => updateMap(f.id, { name: e.currentTarget.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className="cc-input"
                                  type="number"
                                  min={0}
                                  max={24}
                                  step={0.5}
                                  placeholder="Enter"
                                  aria-label={`${f.name} pitch`}
                                  value={f.pitch ?? ''}
                                  onFocus={() => setSelected(f.id)}
                                  onChange={(e) => {
                                    const v = e.currentTarget.valueAsNumber;
                                    updateMap(f.id, {
                                      pitch: Number.isFinite(v)
                                        ? Math.max(0, Math.min(24, v))
                                        : null,
                                    });
                                  }}
                                />
                              </td>
                              <td className="cc-num">{r ? num(r.planSqFt, 0) : '—'}</td>
                              <td className="cc-num">{r ? num(r.perimeterFt, 0) : '—'}</td>
                              <td className="cc-num">
                                {r?.slopedSqFt != null ? (
                                  num(r.slopedSqFt, 0)
                                ) : (
                                  <span className="cc-chip cc-chip--amber">needs pitch</span>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="cc-iconbtn"
                                  aria-label={`Remove ${f.name}`}
                                  onClick={() => {
                                    setMapFacets((fs) => fs.filter((x) => x.id !== f.id));
                                    if (selected === f.id) setSelected(null);
                                  }}
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
                )}
                {mapResult.facetsMissingPitch > 0 && (
                  <div className="cc-callout cc-callout--info" style={{ marginTop: 10 }}>
                    <p>
                      {mapResult.facetsMissingPitch} traced facet
                      {mapResult.facetsMissingPitch === 1 ? '' : 's'} need a pitch before they count
                      toward squares. Imagery shows plan area only; confirm pitch on site or from a
                      pitch gauge photo.
                    </p>
                  </div>
                )}
              </Panel>
              <RoofRecordPanel
                facets={mapFacets}
                waste={waste}
                redeck={redeck}
                onLoad={(loaded) => {
                  setMapFacets(loaded);
                  setSelected(null);
                  setFitSignal((n) => n + 1);
                }}
              />
            </>
          )}
          {mode === 'manual' && (
            <>
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
                            boxShadow:
                              f.id === selected ? '0 0 24px rgba(34,211,238,0.35)' : 'none',
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
            </>
          )}

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

          {selMap && selMap.slopedSqFt === null && (
            <Panel title="Selected facet" id="roof-facet-map">
              <div className="cc-kpis">
                <Kpi label={selMap.name} value="pitch?" />
                <Kpi label="Plan" value={num(selMap.planSqFt, 0)} unit="ft²" />
                <Kpi label="Perimeter" value={num(selMap.perimeterFt, 0)} unit="ft" />
              </div>
            </Panel>
          )}
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
            <p>
              {AREA_SUMMARIES.roof} Traced areas are contractor measurements on imagery, not a
              survey. Verify critical dimensions on site.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
