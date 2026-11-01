'use client';

import { getRoute } from '@fieldline/contracts';
import type { PriceBookItem } from '@fieldline/pricing';
import {
  Button,
  EstimateLayerSection,
  Field,
  RiskNotice,
  StatusPill,
  TextInput,
} from '@fieldline/ui';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { useApi, useSession } from '../../lib/session';
import {
  formatPricingMoney,
  formatQty,
  formatRate,
  scenarioTotals,
} from '../calc/formatEstimate';
import {
  EQUIPMENT_LABELS,
  MapCanvas,
  MapDrawLayer,
  MapGeocoder,
  MapToolbar,
  newOpeningId,
  rectangleRingAround,
  totalCutLengthFt,
  type DrawTool,
  type GeocodeHit,
  type LngLat,
  type MapCanvasHandle,
  type MapOpening,
  type OpeningEquipment,
} from '../map';
import { computeCurbEstimate, type CurbCalcResult, type DepthMode, type QtyView } from './calc';
import {
  EXAMPLE_PRICE_BOOK,
  PAGE60_RECIPE,
  WORKED_EXAMPLE_LABEL,
} from './defaults';
import {
  EMPTY_CURB_DRAFT,
  loadCurbDraft,
  saveCurbDraftLocal,
  saveCurbDraftRemote,
  safetyBlocksFirmQuote,
  type CurbSafetyChecks,
} from './draft';

function cloneBook(book: readonly PriceBookItem[]): PriceBookItem[] {
  return book.map((b) => ({ ...b }));
}

function formatQtyView(q: QtyView): string {
  if (q.state === 'known') return `${formatQty(q.value, 3)} ${q.unit}`;
  if (q.state === 'bounded') {
    return `${formatQty(q.low, 3)} / ${formatQty(q.base, 3)} / ${formatQty(q.high, 3)} ${q.unit}`;
  }
  return `Unknown (${q.reason ?? '—'})`;
}

export function CurbWorkspace({ projectId = null }: { projectId?: string | null }) {
  return (
    <RouteGate routeId="curb">
      <CurbMapWorkspace projectId={projectId} />
    </RouteGate>
  );
}

function CurbMapWorkspace({ projectId }: { projectId: string | null }) {
  const route = getRoute('curb');
  const session = useSession();
  const { endpoints } = useApi();
  const mapRef = useRef<MapCanvasHandle>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);

  const [panelOpen, setPanelOpen] = useState(true);
  const [tool, setTool] = useState<DrawTool>('place');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [addressLabel, setAddressLabel] = useState<string | null>(null);
  const [openings, setOpenings] = useState<MapOpening[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rectStart, setRectStart] = useState<LngLat | null>(null);

  const [placeWidthFt, setPlaceWidthFt] = useState('4');
  const [placeLengthFt, setPlaceLengthFt] = useState('4');
  const [placeEquipment, setPlaceEquipment] = useState<OpeningEquipment>('hvac');

  const [depthMode, setDepthMode] = useState<DepthMode>('bounded');
  const [depthIn, setDepthIn] = useState('6');
  const [depthLowIn, setDepthLowIn] = useState('6');
  const [depthBaseIn, setDepthBaseIn] = useState('7');
  const [depthHighIn, setDepthHighIn] = useState('9');
  const [sawPasses, setSawPasses] = useState('2');
  const [removalWidthFt, setRemovalWidthFt] = useState('2');
  const [crossSectionFt2, setCrossSectionFt2] = useState('1.5');
  const [overheadPercent, setOverheadPercent] = useState('10');
  const [marginPercent, setMarginPercent] = useState('25');
  const [book, setBook] = useState(() => cloneBook(EXAMPLE_PRICE_BOOK));
  const [safety, setSafety] = useState<CurbSafetyChecks>(EMPTY_CURB_DRAFT.safety);

  useEffect(() => {
    let cancelled = false;
    void loadCurbDraft(session.me.user.id, session.orgId!, projectId).then((draft) => {
      if (cancelled || !draft) return;
      setAddressLabel(draft.addressLabel);
      setOpenings(draft.openings);
      setDepthMode(draft.depthMode);
      setDepthIn(draft.depthIn);
      setDepthLowIn(draft.depthLowIn);
      setDepthBaseIn(draft.depthBaseIn);
      setDepthHighIn(draft.depthHighIn);
      setSawPasses(draft.sawPasses);
      setRemovalWidthFt(draft.removalWidthFt);
      setCrossSectionFt2(draft.crossSectionFt2);
      setOverheadPercent(draft.overheadPercent);
      setMarginPercent(draft.marginPercent);
      setSafety(draft.safety);
      setPlaceWidthFt(draft.placeWidthFt);
      setPlaceLengthFt(draft.placeLengthFt);
      setPlaceEquipment(draft.placeEquipment);
      if (draft.openings[0]) {
        mapRef.current?.flyTo(draft.openings[0].center[0], draft.openings[0].center[1], 19);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session.me.user.id, session.orgId, projectId]);

  const draftSnapshot = useCallback(
    () => ({
      addressLabel,
      openings,
      depthMode,
      depthIn,
      depthLowIn,
      depthBaseIn,
      depthHighIn,
      sawPasses,
      removalWidthFt,
      crossSectionFt2,
      overheadPercent,
      marginPercent,
      safety,
      placeWidthFt,
      placeLengthFt,
      placeEquipment,
    }),
    [
      addressLabel,
      openings,
      depthMode,
      depthIn,
      depthLowIn,
      depthBaseIn,
      depthHighIn,
      sawPasses,
      removalWidthFt,
      crossSectionFt2,
      overheadPercent,
      marginPercent,
      safety,
      placeWidthFt,
      placeLengthFt,
      placeEquipment,
    ],
  );

  useEffect(() => {
    const state = draftSnapshot();
    const t = window.setTimeout(() => {
      void (async () => {
        await saveCurbDraftLocal(session.me.user.id, session.orgId!, projectId, state);
        const remote = await saveCurbDraftRemote(endpoints, projectId, state);
        setSaveStatus(
          remote === 'saved'
            ? 'Saved to server'
            : remote === 'unavailable'
              ? 'Saved on this device'
              : 'Local save only (server error)',
        );
      })();
    }, 800);
    return () => window.clearTimeout(t);
  }, [draftSnapshot, session.me.user.id, session.orgId, projectId, endpoints]);

  const cutLengthFt = useMemo(() => totalCutLengthFt(openings), [openings]);
  const blocksFirm = safetyBlocksFirmQuote(safety);

  const computed = useMemo((): { result: CurbCalcResult | null; error: string | null } => {
    if (openings.length === 0 || cutLengthFt <= 0) return { result: null, error: null };
    try {
      const passes = Number.parseInt(sawPasses, 10);
      return {
        result: computeCurbEstimate({
          cutLengthFt: cutLengthFt.toFixed(3),
          segmentCount: openings.length,
          sawPasses: passes,
          depthMode,
          depthIn,
          depthLowIn,
          depthBaseIn,
          depthHighIn,
          depthReason: 'depth unverified',
          removalWidthFt,
          crossSectionFt2,
          boundCrossSection: depthMode === 'bounded',
          crossSectionLowFt2: '1',
          crossSectionHighFt2: '2',
          book,
          recipe: PAGE60_RECIPE,
          overheadPercent,
          marginPercent,
        }),
        error: null,
      };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : 'Could not compute curb estimate',
      };
    }
  }, [
    openings.length,
    cutLengthFt,
    sawPasses,
    depthMode,
    depthIn,
    depthLowIn,
    depthBaseIn,
    depthHighIn,
    removalWidthFt,
    crossSectionFt2,
    book,
    overheadPercent,
    marginPercent,
  ]);

  function handleGeocode(hit: GeocodeHit) {
    setAddressLabel(hit.label);
    mapRef.current?.flyTo(hit.lng, hit.lat, 19);
  }

  function addOpeningAt(center: LngLat, widthFt: number, lengthFt: number, equipment: OpeningEquipment) {
    const nextNum = openings.reduce((m, o) => Math.max(m, o.number), 0) + 1;
    const opening: MapOpening = {
      id: newOpeningId(),
      number: nextNum,
      center,
      widthFt,
      lengthFt,
      equipment,
      ring: rectangleRingAround(center, widthFt, lengthFt),
    };
    setOpenings((rows) => [...rows, opening]);
    setSelectedId(opening.id);
  }

  function handleMapClick(lngLat: LngLat) {
    if (tool === 'place') {
      const w = Number(placeWidthFt);
      const l = Number(placeLengthFt);
      if (!Number.isFinite(w) || !Number.isFinite(l) || w <= 0 || l <= 0) return;
      addOpeningAt(lngLat, w, l, placeEquipment);
      return;
    }
    if (tool === 'rectangle') {
      if (!rectStart) {
        setRectStart(lngLat);
        return;
      }
      // Approximate width/length from second click using local degrees.
      const [lng0, lat0] = rectStart;
      const [lng1, lat1] = lngLat;
      const midLat = (lat0 + lat1) / 2;
      const widthM = Math.abs(lng1 - lng0) * 111320 * Math.cos((midLat * Math.PI) / 180);
      const lengthM = Math.abs(lat1 - lat0) * 110540;
      const widthFt = Math.max(widthM / 0.3048, 0.5);
      const lengthFt = Math.max(lengthM / 0.3048, 0.5);
      const center: LngLat = [(lng0 + lng1) / 2, (lat0 + lat1) / 2];
      addOpeningAt(center, widthFt, lengthFt, placeEquipment);
      setRectStart(null);
      return;
    }
    if (tool === 'select' || tool === 'pan') {
      // Select nearest opening center
      let best: { id: string; d: number } | null = null;
      for (const o of openings) {
        const dx = o.center[0] - lngLat[0];
        const dy = o.center[1] - lngLat[1];
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { id: o.id, d };
      }
      if (best) setSelectedId(best.id);
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    setOpenings((rows) => rows.filter((o) => o.id !== selectedId));
    setSelectedId(null);
  }

  function updateOpening(id: string, patch: Partial<MapOpening>) {
    setOpenings((rows) =>
      rows.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        next.ring = rectangleRingAround(next.center, next.widthFt, next.lengthFt);
        return next;
      }),
    );
  }

  const { result, error } = computed;
  const totals = result ? scenarioTotals(result.estimate) : null;
  const showAsFirm = Boolean(totals?.firm) && !blocksFirm;

  return (
    <div className="web-map-workspace">
      <div className="web-map-workspace__head">
        <PageHeader
          title={route.label}
          description={
            projectId
              ? `Project ${projectId}`
              : 'Place roof openings, confirm safety gates, and price curb cutting.'
          }
          actions={
            <Button variant="secondary" size="sm" onClick={() => setPanelOpen((o) => !o)}>
              {panelOpen ? 'Hide panel' : 'Show panel'}
            </Button>
          }
        />
        {blocksFirm && (
          <RiskNotice kind="preliminary_quote" severity="danger" sticky>
            Safety checklist incomplete (unknown deck, utilities unknown, and/or field verification
            required). Firm quote messaging is blocked — estimates stay preliminary.
          </RiskNotice>
        )}
      </div>

      <div
        className={
          panelOpen
            ? 'web-map-workspace__body'
            : 'web-map-workspace__body web-map-workspace__body--wide'
        }
      >
        <div className="web-map-workspace__map">
          <MapGeocoder onSelect={handleGeocode} />
          <MapToolbar
            tool={tool}
            onToolChange={(t) => {
              setTool(t);
              setRectStart(null);
            }}
            tools={['pan', 'place', 'rectangle', 'select']}
            onDelete={deleteSelected}
            canDelete={Boolean(selectedId)}
          />
          <div className="web-map-place-dims">
            <Field label="Width (ft)">
              <TextInput
                inputMode="decimal"
                value={placeWidthFt}
                onChange={(e) => setPlaceWidthFt(e.target.value)}
              />
            </Field>
            <Field label="Length (ft)">
              <TextInput
                inputMode="decimal"
                value={placeLengthFt}
                onChange={(e) => setPlaceLengthFt(e.target.value)}
              />
            </Field>
            <Field label="Equipment">
              <select
                className="fl-input"
                value={placeEquipment}
                onChange={(e) => setPlaceEquipment(e.target.value as OpeningEquipment)}
              >
                {(Object.keys(EQUIPMENT_LABELS) as OpeningEquipment[]).map((k) => (
                  <option key={k} value={k}>
                    {EQUIPMENT_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <MapCanvas
            ref={mapRef}
            basemap="satellite"
            onClick={handleMapClick}
            onReady={(m) => setMapInstance(m)}
          >
            <MapDrawLayer map={mapInstance} openings={openings} />
          </MapCanvas>
          {addressLabel && (
            <p className="web-map-workspace__address web-small">{addressLabel}</p>
          )}
          {saveStatus && (
            <p className="web-map-workspace__save web-muted web-small" aria-live="polite">
              {saveStatus}
            </p>
          )}
          {rectStart && (
            <p className="web-map-workspace__hint web-info web-small">
              Click opposite corner to finish rectangle.
            </p>
          )}
        </div>

        {panelOpen && (
          <aside className="web-map-workspace__panel" aria-label="Openings and pricing">
            <EstimateLayerSection layer="measured" title="Openings">
              {openings.length === 0 ? (
                <p className="web-muted">
                  Use <strong>Place opening</strong> (click center) or <strong>Rectangle</strong>{' '}
                  (two corners) on the map.
                </p>
              ) : (
                <ol className="web-opening-list">
                  {openings.map((o) => (
                    <li
                      key={o.id}
                      className={
                        o.id === selectedId
                          ? 'web-opening-list__item web-opening-list__item--selected'
                          : 'web-opening-list__item'
                      }
                    >
                      <button
                        type="button"
                        className="web-opening-list__select"
                        onClick={() => setSelectedId(o.id)}
                      >
                        #{o.number} · {EQUIPMENT_LABELS[o.equipment]}
                      </button>
                      <div className="web-calc-row">
                        <Field label="Width ft">
                          <TextInput
                            inputMode="decimal"
                            value={String(o.widthFt)}
                            onChange={(e) =>
                              updateOpening(o.id, { widthFt: Number(e.target.value) || 0 })
                            }
                          />
                        </Field>
                        <Field label="Length ft">
                          <TextInput
                            inputMode="decimal"
                            value={String(o.lengthFt)}
                            onChange={(e) =>
                              updateOpening(o.id, { lengthFt: Number(e.target.value) || 0 })
                            }
                          />
                        </Field>
                        <Field label="Type">
                          <select
                            className="fl-input"
                            value={o.equipment}
                            onChange={(e) =>
                              updateOpening(o.id, {
                                equipment: e.target.value as OpeningEquipment,
                              })
                            }
                          >
                            {(Object.keys(EQUIPMENT_LABELS) as OpeningEquipment[]).map((k) => (
                              <option key={k} value={k}>
                                {EQUIPMENT_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <p className="web-muted web-small">
                Derived cut length: {cutLengthFt > 0 ? `${cutLengthFt.toFixed(2)} ft` : '—'} (
                {openings.length} opening{openings.length === 1 ? '' : 's'})
              </p>
            </EstimateLayerSection>

            <EstimateLayerSection layer="assumption" title="Safety checklist">
              {(
                [
                  ['unknownDeck', 'Deck type unknown'],
                  ['utilitiesUnknown', 'Utilities unknown'],
                  ['fieldVerificationRequired', 'Field verification required'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="web-calc-check">
                  <input
                    type="checkbox"
                    className="web-checkbox"
                    checked={safety[key]}
                    onChange={(e) => setSafety((s) => ({ ...s, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
              <p className="web-muted web-small">
                Unchecked items mean the risk is cleared. Any checked item blocks firm quote copy.
              </p>
            </EstimateLayerSection>

            <EstimateLayerSection layer="measured" title="Cut depth">
              <Field label="Depth mode">
                <select
                  className="fl-input"
                  value={depthMode}
                  onChange={(e) => setDepthMode(e.target.value as DepthMode)}
                >
                  <option value="known">Known (verified)</option>
                  <option value="bounded">Bounded (unverified)</option>
                </select>
              </Field>
              {depthMode === 'known' ? (
                <Field label="Depth">
                  <TextInput
                    inputMode="decimal"
                    value={depthIn}
                    onChange={(e) => setDepthIn(e.target.value)}
                    suffix="in"
                  />
                </Field>
              ) : (
                <div className="web-calc-row">
                  <Field label="Low">
                    <TextInput
                      inputMode="decimal"
                      value={depthLowIn}
                      onChange={(e) => setDepthLowIn(e.target.value)}
                      suffix="in"
                    />
                  </Field>
                  <Field label="Base">
                    <TextInput
                      inputMode="decimal"
                      value={depthBaseIn}
                      onChange={(e) => setDepthBaseIn(e.target.value)}
                      suffix="in"
                    />
                  </Field>
                  <Field label="High">
                    <TextInput
                      inputMode="decimal"
                      value={depthHighIn}
                      onChange={(e) => setDepthHighIn(e.target.value)}
                      suffix="in"
                    />
                  </Field>
                </div>
              )}
              <div className="web-calc-row">
                <Field label="Saw passes">
                  <TextInput
                    inputMode="numeric"
                    value={sawPasses}
                    onChange={(e) => setSawPasses(e.target.value)}
                  />
                </Field>
                <Field label="Removal width">
                  <TextInput
                    inputMode="decimal"
                    value={removalWidthFt}
                    onChange={(e) => setRemovalWidthFt(e.target.value)}
                    suffix="ft"
                  />
                </Field>
                <Field label="Cross-section">
                  <TextInput
                    inputMode="decimal"
                    value={crossSectionFt2}
                    onChange={(e) => setCrossSectionFt2(e.target.value)}
                    suffix="ft²"
                  />
                </Field>
              </div>
            </EstimateLayerSection>

            <EstimateLayerSection layer="assumption" title="Overhead and margin">
              <div className="web-calc-row">
                <Field label="Overhead %">
                  <TextInput
                    inputMode="decimal"
                    value={overheadPercent}
                    onChange={(e) => setOverheadPercent(e.target.value)}
                    suffix="%"
                  />
                </Field>
                <Field label="Target margin %">
                  <TextInput
                    inputMode="decimal"
                    value={marginPercent}
                    onChange={(e) => setMarginPercent(e.target.value)}
                    suffix="%"
                  />
                </Field>
              </div>
              <p className="web-muted web-small">{WORKED_EXAMPLE_LABEL}.</p>
            </EstimateLayerSection>

            <EstimateLayerSection layer="assumption" title="Price book">
              {book.map((item, index) => (
                <div key={item.code} className="web-calc-row">
                  <Field label={item.code}>
                    <span className="web-muted web-small">{item.unit}</span>
                  </Field>
                  <Field label="Rate">
                    <TextInput
                      inputMode="decimal"
                      value={item.rate == null ? '' : String(item.rate)}
                      onChange={(e) =>
                        setBook((rows) =>
                          rows.map((r, i) =>
                            i === index
                              ? {
                                  ...r,
                                  rate: e.target.value.trim() === '' ? null : e.target.value,
                                }
                              : r,
                          ),
                        )
                      }
                      prefix="$"
                    />
                  </Field>
                </div>
              ))}
            </EstimateLayerSection>

            <div className="web-calc-outputs">
              {error && (
                <div className="web-error" role="alert">
                  <p className="web-error__title">Cannot price yet</p>
                  <p>{error}</p>
                </div>
              )}
              {!result && !error && (
                <p className="web-muted">Place at least one opening to compute a curb estimate.</p>
              )}
              {result && totals && (
                <>
                  <EstimateLayerSection layer="suggested" title="Quantities">
                    <dl className="web-calc-stats">
                      <div>
                        <dt>Cut length</dt>
                        <dd>{formatQtyView(result.quantities.cutLengthFt)}</dd>
                      </div>
                      <div>
                        <dt>Saw pass length</dt>
                        <dd>{formatQtyView(result.quantities.sawPassLengthFt)}</dd>
                      </div>
                      <div>
                        <dt>Inch-feet</dt>
                        <dd>{formatQtyView(result.quantities.inchFeet)}</dd>
                      </div>
                      <div>
                        <dt>Segments</dt>
                        <dd>{result.quantities.segmentCount}</dd>
                      </div>
                    </dl>
                  </EstimateLayerSection>

                  <EstimateLayerSection layer="approved" title="Cost estimate">
                    <div className="web-calc-total-head">
                      <StatusPill
                        status={
                          totals.status === 'priced'
                            ? showAsFirm
                              ? 'approved'
                              : 'budgetary'
                            : 'review_required'
                        }
                        label={
                          totals.status === 'priced'
                            ? showAsFirm
                              ? 'Firm'
                              : 'Preliminary (not firm)'
                            : 'Pending review'
                        }
                        tone={
                          totals.status === 'priced'
                            ? showAsFirm
                              ? 'success'
                              : 'warning'
                            : 'danger'
                        }
                      />
                    </div>
                    {(blocksFirm || !totals.firm) && totals.status === 'priced' && (
                      <RiskNotice kind="preliminary_quote">
                        {blocksFirm
                          ? 'Safety gates prevent presenting this as a firm quote.'
                          : 'Estimate is not firm due to bounded or unverified inputs.'}
                      </RiskNotice>
                    )}
                    <dl className="web-calc-stats">
                      <div>
                        <dt>Direct cost</dt>
                        <dd>{totals.direct}</dd>
                      </div>
                      <div>
                        <dt>{showAsFirm ? 'Total' : 'Base total'}</dt>
                        <dd className="web-calc-total">{totals.total}</dd>
                      </div>
                      {totals.lowTotal && totals.highTotal && (
                        <div>
                          <dt>Low – high</dt>
                          <dd>
                            {totals.lowTotal} – {totals.highTotal}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="web-table-scroll">
                      <table className="web-matrix web-calc-table">
                        <thead>
                          <tr>
                            <th>Line</th>
                            <th>Qty</th>
                            <th>Rate</th>
                            <th>Ext.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.estimate.lines.map((line) => (
                            <tr key={line.code}>
                              <td>{line.description}</td>
                              <td>
                                {line.quantity ? formatQty(line.quantity.base, 3) : '—'} {line.unit}
                              </td>
                              <td>
                                {line.unitRate
                                  ? formatRate(line.unitRate.base, result.estimate.currency)
                                  : '—'}
                              </td>
                              <td>
                                {line.extended
                                  ? formatPricingMoney(line.extended.base)
                                  : (line.unresolvedReason ?? '—')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </EstimateLayerSection>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
