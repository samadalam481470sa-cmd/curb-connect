'use client';

import { getRoute } from '@fieldline/contracts';
import type { MaterialSpec } from '@fieldline/pricing';
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
import { isApiError } from '../../lib/api';
import { fractionToPercent } from '../../lib/decimal-text';
import { useApi, useSession } from '../../lib/session';
import {
  formatPricingMoney,
  formatQty,
  formatRate,
  scenarioTotals,
} from '../calc/formatEstimate';
import {
  MapCanvas,
  MapDrawLayer,
  MapGeocoder,
  MapToolbar,
  areaFt2AsInput,
  areaM2AsInput,
  distanceMeters,
  planAreaFromLngLat,
  type DrawTool,
  type EdgeClass,
  type GeocodeHit,
  type LngLat,
  type MapCanvasHandle,
  type MapPolygonFacet,
} from '../map';
import {
  type AreaDisplayUnit,
  computeRoofEstimate,
  type RoofCalcResult,
} from './calc';
import {
  EXAMPLE_LABOR,
  EXAMPLE_MATERIAL_SPECS,
  WORKED_EXAMPLE_LABEL,
} from './defaults';
import {
  loadRoofDraft,
  saveRoofDraftLocal,
  saveRoofDraftRemote,
  type RoofDraftState,
  type RoofEdgeRow,
} from './draft';
import { aggregateEdgeLengths, syncEdgesFromFacets } from './edgeSync';

const SNAP_METERS = 1.25;
const PITCH_PRESETS = [
  { label: '4/12', rise: '4', run: '12' },
  { label: '5/12', rise: '5', run: '12' },
  { label: '6/12', rise: '6', run: '12' },
  { label: '8/12', rise: '8', run: '12' },
  { label: '9/12', rise: '9', run: '12' },
  { label: '12/12', rise: '12', run: '12' },
] as const;

function cloneMaterials(specs: readonly MaterialSpec[]): MaterialSpec[] {
  return specs.map((s) => ({ ...s, basis: { ...s.basis } as MaterialSpec['basis'] }));
}

function newFacetId(): string {
  return `facet-${crypto.randomUUID().slice(0, 8)}`;
}

export function RoofWorkspace({ orderId = null }: { orderId?: string | null }) {
  return (
    <RouteGate routeId="roof">
      <RoofMapWorkspace orderId={orderId} />
    </RouteGate>
  );
}

function RoofMapWorkspace({ orderId }: { orderId: string | null }) {
  const route = getRoute('roof');
  const session = useSession();
  const { endpoints } = useApi();
  const mapRef = useRef<MapCanvasHandle>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);

  const [panelOpen, setPanelOpen] = useState(true);
  const [tool, setTool] = useState<DrawTool>('polygon');
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanCenter, setScanCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [addressLabel, setAddressLabel] = useState<string | null>(null);
  const [facets, setFacets] = useState<MapPolygonFacet[]>([]);
  const [draftRing, setDraftRing] = useState<LngLat[]>([]);
  const [selectedFacetId, setSelectedFacetId] = useState<string | null>(null);
  const [edges, setEdges] = useState<RoofEdgeRow[]>([]);
  const [past, setPast] = useState<RoofDraftState[]>([]);
  const [future, setFuture] = useState<RoofDraftState[]>([]);

  const [wastePercent, setWastePercent] = useState('10');
  const [materials, setMaterials] = useState(() => cloneMaterials(EXAMPLE_MATERIAL_SPECS));
  const [laborRate, setLaborRate] = useState(String(EXAMPLE_LABOR.ratePerSquare ?? '95'));
  const [overheadPercent, setOverheadPercent] = useState('10');
  const [markupPercent, setMarkupPercent] = useState('30');
  const [areaUnit, setAreaUnit] = useState<AreaDisplayUnit>('ft2');

  const snapshot = useCallback((): RoofDraftState => {
    return {
      addressLabel,
      center: null,
      facets,
      edges,
      wastePercent,
      laborRate,
      overheadPercent,
      markupPercent,
      areaUnit,
    };
  }, [
    addressLabel,
    facets,
    edges,
    wastePercent,
    laborRate,
    overheadPercent,
    markupPercent,
    areaUnit,
  ]);

  const pushHistory = useCallback(
    (mutator: (prev: RoofDraftState) => RoofDraftState) => {
      const current = snapshot();
      const next = mutator(current);
      setPast((p) => [...p.slice(-40), current]);
      setFuture([]);
      setFacets(next.facets);
      setEdges(next.edges);
      setAddressLabel(next.addressLabel);
      setWastePercent(next.wastePercent);
      setLaborRate(next.laborRate);
      setOverheadPercent(next.overheadPercent);
      setMarkupPercent(next.markupPercent);
      setAreaUnit(next.areaUnit);
    },
    [snapshot],
  );

  // Load draft once.
  useEffect(() => {
    let cancelled = false;
    void loadRoofDraft(session.me.user.id, session.orgId!, orderId).then((draft) => {
      if (cancelled || !draft) return;
      setAddressLabel(draft.addressLabel);
      setFacets(draft.facets);
      setEdges(draft.edges);
      setWastePercent(draft.wastePercent);
      setLaborRate(draft.laborRate);
      setOverheadPercent(draft.overheadPercent);
      setMarkupPercent(draft.markupPercent);
      setAreaUnit(draft.areaUnit);
      if (draft.facets[0]?.ring[0]) {
        const [lng, lat] = draft.facets[0].ring[0];
        mapRef.current?.flyTo(lng, lat, 18);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session.me.user.id, session.orgId, orderId]);

  // Autosave local + remote (debounced).
  useEffect(() => {
    const state = snapshot();
    const t = window.setTimeout(() => {
      void (async () => {
        await saveRoofDraftLocal(session.me.user.id, session.orgId!, orderId, state);
        const remote = await saveRoofDraftRemote(endpoints, orderId, state);
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
  }, [snapshot, session.me.user.id, session.orgId, orderId, endpoints]);

  const facetPlanAreas = useMemo(() => {
    return facets.map((f) => {
      const area = planAreaFromLngLat(f.ring);
      return {
        id: f.id,
        area,
        planAreaInput:
          areaUnit === 'ft2' ? areaFt2AsInput(area.areaFt2) : areaM2AsInput(area.areaM2),
      };
    });
  }, [facets, areaUnit]);

  const computed = useMemo((): { result: RoofCalcResult | null; error: string | null } => {
    const facetInputs = facets.map((f, i) => ({
      id: f.id,
      structureId: 'structure-1',
      planArea: facetPlanAreas[i]?.planAreaInput ?? '',
      planAreaUnit: areaUnit,
      pitchRise: f.pitchRise,
      pitchRun: f.pitchRun,
    }));
    if (!facetInputs.some((f) => f.planArea.trim())) return { result: null, error: null };
    const agg = aggregateEdgeLengths(edges);
    try {
      return {
        result: computeRoofEstimate({
          facets: facetInputs,
          edges: {
            eave: agg.eave,
            rake: agg.rake,
            ridge: agg.ridge,
            hip: agg.hip,
            valley: agg.valley,
            unit: 'ft',
          },
          wastePercent,
          materials,
          laborRatePerSquare: laborRate,
          overheadPercent,
          markupPercent,
        }),
        error: null,
      };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : 'Could not compute roof estimate',
      };
    }
  }, [
    facets,
    facetPlanAreas,
    edges,
    wastePercent,
    materials,
    laborRate,
    overheadPercent,
    markupPercent,
    areaUnit,
  ]);

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1]!;
    setFuture((f) => [snapshot(), ...f]);
    setPast((p) => p.slice(0, -1));
    setFacets(prev.facets);
    setEdges(prev.edges);
    setAddressLabel(prev.addressLabel);
    setDraftRing([]);
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[0]!;
    setPast((p) => [...p, snapshot()]);
    setFuture((f) => f.slice(1));
    setFacets(next.facets);
    setEdges(next.edges);
    setAddressLabel(next.addressLabel);
    setDraftRing([]);
  }

  const applyScan = useCallback(
    async (opts: { lat?: number; lng?: number; q?: string; label?: string | null }) => {
      setScanBusy(true);
      setSuggestMsg(null);
      try {
        const scanned = await endpoints.roofScan({
          lat: opts.lat,
          lng: opts.lng,
          q: opts.q,
        });
        const nextFacets: MapPolygonFacet[] = scanned.facets.map((f) => ({
          id: f.id || newFacetId(),
          label: f.label,
          ring: f.ring as LngLat[],
          pitchRise: f.pitchRise,
          pitchRun: f.pitchRun,
        }));
        pushHistory((prev) => {
          const withFacets = { ...prev, facets: nextFacets, edges: [] };
          return {
            ...withFacets,
            addressLabel: opts.label ?? scanned.addressLabel ?? prev.addressLabel,
            edges: syncEdgesFromFacets(nextFacets, []),
          };
        });
        setDraftRing([]);
        setSelectedFacetId(nextFacets[0]?.id ?? null);
        setScanCenter(scanned.center);
        const tip = [
          `Scanned ${nextFacets.length} roof plane${nextFacets.length === 1 ? '' : 's'}`,
          scanned.planAreaM2 != null
            ? `· ~${Math.round(scanned.planAreaM2 * 10.7639).toLocaleString()} ft² footprint`
            : null,
          scanned.pitchSource === 'google_solar' ? '· pitch from Google Solar' : '· confirm pitch',
        ]
          .filter(Boolean)
          .join(' ');
        setSuggestMsg(
          [
            tip,
            ...scanned.warnings.slice(0, 2),
            scanned.attribution.slice(0, 2).join(' · '),
          ]
            .filter(Boolean)
            .join(' '),
        );
        const first = nextFacets[0]?.ring[0];
        if (first) mapRef.current?.flyTo(first[0], first[1], 19);
        else mapRef.current?.flyTo(scanned.center.lng, scanned.center.lat, 19);
        setTool('select');
      } catch (e) {
        const detail = isApiError(e)
          ? e.problem.detail ?? e.message
          : e instanceof Error
            ? e.message
            : 'Roof scan failed';
        setSuggestMsg(detail);
      } finally {
        setScanBusy(false);
      }
    },
    [endpoints, pushHistory],
  );

  function handleGeocode(hit: GeocodeHit) {
    setAddressLabel(hit.label);
    setScanCenter({ lat: hit.lat, lng: hit.lng });
    mapRef.current?.flyTo(hit.lng, hit.lat, 19);
    void applyScan({ lat: hit.lat, lng: hit.lng, label: hit.label });
  }

  function handleScanRoof() {
    if (scanBusy) return;
    if (scanCenter) {
      void applyScan({ lat: scanCenter.lat, lng: scanCenter.lng, label: addressLabel });
      return;
    }
    const map = mapRef.current?.getMap();
    if (map) {
      const c = map.getCenter();
      void applyScan({ lat: c.lat, lng: c.lng, label: addressLabel });
      return;
    }
    if (addressLabel && addressLabel.trim().length >= 3) {
      void applyScan({ q: addressLabel, label: addressLabel });
      return;
    }
    setSuggestMsg('Search an address first, or pan the map over the building, then Scan roof.');
  }

  function handleMapClick(lngLat: LngLat) {
    if (tool === 'pan' || tool === 'select') {
      // Select nearest facet vertex / facet
      let best: { id: string; d: number } | null = null;
      for (const f of facets) {
        for (const v of f.ring) {
          const d = distanceMeters(lngLat, v);
          if (!best || d < best.d) best = { id: f.id, d };
        }
      }
      if (best && best.d < 8) setSelectedFacetId(best.id);
      return;
    }
    if (tool !== 'polygon') return;

    setDraftRing((ring) => {
      if (ring.length >= 3) {
        const first = ring[0]!;
        if (distanceMeters(lngLat, first) <= SNAP_METERS) {
          const closed = ring;
          const id = newFacetId();
          const facet: MapPolygonFacet = {
            id,
            ring: closed,
            pitchRise: '6',
            pitchRun: '12',
            label: `Facet ${facets.length + 1}`,
          };
          pushHistory((prev) => {
            const nextFacets = [...prev.facets, facet];
            return {
              ...prev,
              facets: nextFacets,
              edges: syncEdgesFromFacets(nextFacets, prev.edges),
            };
          });
          setSelectedFacetId(id);
          return [];
        }
      }
      return [...ring, lngLat];
    });
  }

  function deleteSelected() {
    if (draftRing.length > 0) {
      setDraftRing([]);
      return;
    }
    if (!selectedFacetId) return;
    pushHistory((prev) => {
      const nextFacets = prev.facets.filter((f) => f.id !== selectedFacetId);
      return {
        ...prev,
        facets: nextFacets,
        edges: syncEdgesFromFacets(nextFacets, prev.edges),
      };
    });
    setSelectedFacetId(null);
  }

  function deleteLastVertex() {
    if (draftRing.length > 0) {
      setDraftRing((r) => r.slice(0, -1));
      return;
    }
    if (!selectedFacetId) return;
    pushHistory((prev) => {
      const nextFacets = prev.facets.map((f) =>
        f.id === selectedFacetId ? { ...f, ring: f.ring.slice(0, -1) } : f,
      ).filter((f) => f.ring.length >= 3 || f.id !== selectedFacetId);
      // Keep facets with <3 verts removed
      const cleaned = nextFacets.filter((f) => f.ring.length >= 3);
      return { ...prev, facets: cleaned, edges: syncEdgesFromFacets(cleaned, prev.edges) };
    });
  }

  function updateFacetPitch(id: string, rise: string, run: string) {
    pushHistory((prev) => ({
      ...prev,
      facets: prev.facets.map((f) => (f.id === id ? { ...f, pitchRise: rise, pitchRun: run } : f)),
    }));
  }

  function updateEdgeClass(edgeId: string, classification: EdgeClass) {
    pushHistory((prev) => ({
      ...prev,
      edges: prev.edges.map((e) => (e.id === edgeId ? { ...e, classification } : e)),
    }));
  }

  const { result, error } = computed;
  const totals = result ? scenarioTotals(result.estimate) : null;
  const wasteDisplay =
    result?.wasteRate != null ? (fractionToPercent(result.wasteRate) ?? result.wasteRate) : null;
  const selected = facets.find((f) => f.id === selectedFacetId) ?? null;

  return (
    <div className="web-map-workspace">
      <div className="web-map-workspace__head">
        <PageHeader
          title={route.label}
          description={
            orderId
              ? `Order ${orderId}`
              : 'Search an address — Field Pro scans the building outline, applies pitch, and prices from your rates.'
          }
          actions={
            <div className="web-actions" style={{ marginTop: 0 }}>
              <Button variant="secondary" size="sm" onClick={() => setPanelOpen((o) => !o)}>
                {panelOpen ? 'Hide panel' : 'Show panel'}
              </Button>
              <Button variant="primary" size="sm" loading={scanBusy} onClick={handleScanRoof}>
                {scanBusy ? 'Scanning…' : 'Scan roof'}
              </Button>
            </div>
          }
        />
        {suggestMsg && (
          <RiskNotice kind="preliminary_quote" severity="warning">
            {suggestMsg}
          </RiskNotice>
        )}
        <RiskNotice kind="preliminary_quote">
          Auto-scan uses licensed building footprints (OpenStreetMap) and optional Google Solar
          pitch/area — not a survey. Review the outline and pitch before a firm customer quote.
        </RiskNotice>
      </div>

      <div className={panelOpen ? 'web-map-workspace__body' : 'web-map-workspace__body web-map-workspace__body--wide'}>
        <div className="web-map-workspace__map">
          <MapGeocoder onSelect={handleGeocode} />
          <MapToolbar
            tool={tool}
            onToolChange={setTool}
            tools={['pan', 'polygon', 'select']}
            onUndo={undo}
            onRedo={redo}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onDelete={deleteSelected}
            canDelete={Boolean(selectedFacetId) || draftRing.length > 0}
            onSuggestOutline={scanBusy ? undefined : handleScanRoof}
            extra={
              <button type="button" className="web-map-tool" onClick={deleteLastVertex}>
                Delete vertex
              </button>
            }
          />
          <MapCanvas
            ref={mapRef}
            basemap="satellite"
            onClick={handleMapClick}
            onReady={(m) => setMapInstance(m)}
            interactive={tool === 'pan' || tool === 'select' || tool === 'polygon'}
          >
            <MapDrawLayer
              map={mapInstance}
              facets={facets}
              draftRing={draftRing.length ? draftRing : null}
              selectedFacetId={selectedFacetId}
            />
          </MapCanvas>
          {addressLabel && (
            <p className="web-map-workspace__address web-small">{addressLabel}</p>
          )}
          {saveStatus && (
            <p className="web-map-workspace__save web-muted web-small" aria-live="polite">
              {saveStatus}
            </p>
          )}
        </div>

        {panelOpen && (
          <aside className="web-map-workspace__panel" aria-label="Measurements and pricing">
            <EstimateLayerSection layer="measured" title="Facets">
              <Field label="Plan area unit">
                <select
                  className="fl-input"
                  value={areaUnit}
                  onChange={(e) => setAreaUnit(e.target.value as AreaDisplayUnit)}
                >
                  <option value="ft2">Square feet</option>
                  <option value="m2">Square metres</option>
                </select>
              </Field>
              {facets.length === 0 && (
                <p className="web-muted">
                  Choose <strong>Draw facet</strong>, click vertices on the map, then click near the
                  first point to close.
                </p>
              )}
              {facets.map((facet) => {
                const area = facetPlanAreas.find((a) => a.id === facet.id);
                return (
                  <div
                    key={facet.id}
                    className={
                      facet.id === selectedFacetId
                        ? 'web-map-facet web-map-facet--selected'
                        : 'web-map-facet'
                    }
                  >
                    <button
                      type="button"
                      className="web-map-facet__select"
                      onClick={() => setSelectedFacetId(facet.id)}
                    >
                      {facet.label}
                    </button>
                    <dl className="web-calc-stats">
                      <div>
                        <dt>Plan</dt>
                        <dd>
                          {area
                            ? `${formatQty(String(area.area.areaFt2.toFixed(1)), 1)} ft² / ${formatQty(String(area.area.areaM2.toFixed(2)), 2)} m²`
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                    <Field label="Pitch">
                      <div className="web-actions" style={{ marginTop: 0 }}>
                        <TextInput
                          inputMode="decimal"
                          value={facet.pitchRise}
                          onChange={(e) =>
                            updateFacetPitch(facet.id, e.target.value, facet.pitchRun)
                          }
                          aria-label="Pitch rise"
                        />
                        <span className="web-muted">/</span>
                        <TextInput
                          inputMode="decimal"
                          value={facet.pitchRun}
                          onChange={(e) =>
                            updateFacetPitch(facet.id, facet.pitchRise, e.target.value)
                          }
                          aria-label="Pitch run"
                        />
                      </div>
                      <div className="web-pitch-presets">
                        {PITCH_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            className="web-map-tool"
                            onClick={() => updateFacetPitch(facet.id, p.rise, p.run)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </div>
                );
              })}
              {selected && (
                <Button variant="ghost" size="sm" onClick={deleteSelected}>
                  Remove selected facet
                </Button>
              )}
            </EstimateLayerSection>

            <EstimateLayerSection layer="measured" title="Edge classification">
              {edges.length === 0 ? (
                <p className="web-muted">Edges appear after a facet is closed.</p>
              ) : (
                <div className="web-table-scroll">
                  <table className="web-matrix web-calc-table">
                    <thead>
                      <tr>
                        <th>Facet</th>
                        <th>#</th>
                        <th>Length ft</th>
                        <th>Class</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edges.map((e) => (
                        <tr key={e.id}>
                          <td>{e.facetId}</td>
                          <td>{e.edgeIndex + 1}</td>
                          <td>{e.lengthFt}</td>
                          <td>
                            <select
                              className="fl-input"
                              value={e.classification}
                              onChange={(ev) =>
                                updateEdgeClass(e.id, ev.target.value as EdgeClass)
                              }
                            >
                              <option value="unclassified">Unclassified</option>
                              <option value="eave">Eave</option>
                              <option value="rake">Rake</option>
                              <option value="ridge">Ridge</option>
                              <option value="hip">Hip</option>
                              <option value="valley">Valley</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </EstimateLayerSection>

            <EstimateLayerSection layer="assumption" title="Waste, labor and markup">
              <div className="web-calc-row">
                <Field label="Waste %">
                  <TextInput
                    inputMode="decimal"
                    value={wastePercent}
                    onChange={(e) => setWastePercent(e.target.value)}
                    suffix="%"
                  />
                </Field>
                <Field label="Labor $/square">
                  <TextInput
                    inputMode="decimal"
                    value={laborRate}
                    onChange={(e) => setLaborRate(e.target.value)}
                    prefix="$"
                  />
                </Field>
                <Field label="Overhead %">
                  <TextInput
                    inputMode="decimal"
                    value={overheadPercent}
                    onChange={(e) => setOverheadPercent(e.target.value)}
                    suffix="%"
                  />
                </Field>
                <Field label="Markup %">
                  <TextInput
                    inputMode="decimal"
                    value={markupPercent}
                    onChange={(e) => setMarkupPercent(e.target.value)}
                    suffix="%"
                  />
                </Field>
              </div>
              <p className="web-muted web-small">{WORKED_EXAMPLE_LABEL}.</p>
            </EstimateLayerSection>

            <EstimateLayerSection layer="assumption" title="Material packs">
              {materials.map((spec, index) => (
                <div key={spec.code} className="web-calc-row">
                  <Field label={spec.description}>
                    <span className="web-muted web-small">{spec.code}</span>
                  </Field>
                  <Field label={`Price / ${spec.packUnit}`}>
                    <TextInput
                      inputMode="decimal"
                      value={String(spec.unitPrice ?? '')}
                      onChange={(e) =>
                        setMaterials((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, unitPrice: e.target.value || null } : r,
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
                <p className="web-muted">Draw a closed facet to see live plan area and estimate.</p>
              )}
              {result && totals && (
                <>
                  <EstimateLayerSection layer="suggested" title="Live areas">
                    <dl className="web-calc-stats">
                      <div>
                        <dt>Plan</dt>
                        <dd>
                          {formatQty(result.takeoff.planFt2, 1)} ft² (
                          {formatQty(result.takeoff.planM2, 2)} m²)
                        </dd>
                      </div>
                      <div>
                        <dt>Sloped</dt>
                        <dd>
                          {result.takeoff.slopedFt2
                            ? `${formatQty(result.takeoff.slopedFt2, 2)} ft²`
                            : 'Unresolved (pitch missing)'}
                        </dd>
                      </div>
                      <div>
                        <dt>Squares</dt>
                        <dd>{formatQty(result.takeoff.squares, 3)}</dd>
                      </div>
                      <div>
                        <dt>Waste</dt>
                        <dd>
                          {wasteDisplay != null
                            ? `${wasteDisplay}% (${result.wasteSource})`
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  </EstimateLayerSection>

                  <EstimateLayerSection layer="suggested" title="Material takeoff">
                    <div className="web-table-scroll">
                      <table className="web-matrix web-calc-table">
                        <thead>
                          <tr>
                            <th>Material</th>
                            <th>Order</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.materials.map((line) => (
                            <tr key={line.code}>
                              <td>{line.code}</td>
                              <td>
                                {line.orderPacks ? `${line.orderPacks} ${line.packUnit}` : '—'}
                              </td>
                              <td>{line.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </EstimateLayerSection>

                  <EstimateLayerSection layer="approved" title="Estimate">
                    <div className="web-calc-total-head">
                      <StatusPill
                        status={
                          totals.status === 'priced'
                            ? totals.firm
                              ? 'approved'
                              : 'budgetary'
                            : 'review_required'
                        }
                        label={
                          totals.status === 'priced'
                            ? totals.firm
                              ? 'Firm'
                              : 'Range (not firm)'
                            : 'Pending review'
                        }
                        tone={
                          totals.status === 'priced'
                            ? totals.firm
                              ? 'success'
                              : 'warning'
                            : 'danger'
                        }
                      />
                    </div>
                    {!totals.firm && totals.status === 'priced' && (
                      <RiskNotice kind="preliminary_quote">
                        Low/base/high shown because inputs are bounded or uncertain.
                      </RiskNotice>
                    )}
                    <dl className="web-calc-stats">
                      <div>
                        <dt>Direct cost</dt>
                        <dd>{totals.direct}</dd>
                      </div>
                      <div>
                        <dt>{totals.firm ? 'Total' : 'Base total'}</dt>
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
