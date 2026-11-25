'use client';

// GIS Workbench: the desktop-GIS equivalent inside Field Pro. Layer panel with styling
// (color/opacity/visibility), an attribute table for the active layer, click-to-identify,
// geodesic measure tools, a print-layout composer that exports a DRAFT plan sheet PDF, a 3D
// terrain view with traced roofs standing on it, and an extensions panel of built-in geometry
// tools. Every layer reads from an existing live source (CAD parcels, USGS NHD streams, the
// permit-lead search, the NOAA hail swath, your saved roofs) — a down source says so, and no
// feature is ever invented or silently dropped (truncation and coordinate-less permits are
// counted out loud).
import {
  GisParcelsResponseSchema,
  GisPrintResponseSchema,
  GisRoofsResponseSchema,
  GisStreamsResponseSchema,
} from '@fieldline/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { useApi, useSession } from '../../lib/session';
import { SwathSchema } from '../roof/storms/api';
import { cellText, filterRows, identifyRows, sortRows, type TableSort } from './attributeTable';
import { EXTENSION_TOOLS, runExtensionTool, type ExtensionToolId, type ToolResult } from './extensions';
import {
  ATTRIBUTE_COLUMNS,
  LAYER_DEFS,
  apiFeatureId,
  defaultLayerStates,
  layerDef,
  permitsToFeatures,
  type GisFeature,
  type LayerId,
  type LayerState,
} from './layers';
import { measureArea, measureDistance, type MeasurePoint } from './measure';
import {
  PAGE_SIZES,
  buildLayerSummary,
  buildLegend,
  buildSourceNotes,
  pageDimensions,
  scaleBar,
  type Orientation,
  type PageSize,
} from './printLayout';
import { Terrain3D } from './Terrain3D';
import { WorkbenchMap, type MeasureMode, type WorkbenchMapHandle, type WorkbenchView } from './WorkbenchMap';

const TRADES = {
  grading: 'Grading and site work',
  concrete: 'Concrete and curb cutting',
  roofing: 'Roofing',
  materials: 'Building materials supply',
  framing: 'Framing and lumber',
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  general: 'General subcontracting',
} as const;
type Trade = keyof typeof TRADES;

// Minimal mirror of the permit-search result leads (same fields Permit Job Search reads).
const PermitResultSchema = z.object({
  leads: z.array(
    z.object({
      permitNumber: z.string(),
      city: z.string(),
      address: z.string(),
      description: z.string(),
      status: z.string(),
      issuedAt: z.string().nullable(),
      value: z.number(),
      contractor: z.string(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      projectType: z.string(),
      score: z.number(),
      grade: z.string(),
      sourceName: z.string(),
    }),
  ),
});

export function GisWorkbenchView() {
  return (
    <RouteGate routeId="gisWorkbench">
      <GisWorkbenchContent />
    </RouteGate>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'The request failed.';
}

function centroid(feature: GisFeature): { lon: number; lat: number } | null {
  const g = feature.geometry;
  if (g.type === 'Point') return { lon: g.coordinates[0]!, lat: g.coordinates[1]! };
  const ring =
    g.type === 'Polygon'
      ? g.coordinates[0]
      : g.type === 'MultiPolygon'
        ? g.coordinates[0]?.[0]
        : g.type === 'LineString'
          ? g.coordinates
          : g.coordinates[0];
  if (!ring || ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x!;
    lat += y!;
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

function GisWorkbenchContent() {
  const { api } = useApi();
  const session = useSession();
  const mapRef = useRef<WorkbenchMapHandle>(null);

  const [layerStates, setLayerStates] = useState<Record<LayerId, LayerState>>(defaultLayerStates);
  const [features, setFeatures] = useState<Record<LayerId, GisFeature[]>>({
    parcels: [],
    permits: [],
    streams: [],
    hail: [],
    roofs: [],
  });
  const [activeLayer, setActiveLayer] = useState<LayerId>('parcels');
  const [view, setView] = useState<WorkbenchView | null>(null);
  const [identified, setIdentified] = useState<{ layerId: LayerId; feature: GisFeature } | null>(null);
  const [highlighted, setHighlighted] = useState<GisFeature | null>(null);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [filter, setFilter] = useState('');
  const [measureMode, setMeasureMode] = useState<MeasureMode>('off');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [show3d, setShow3d] = useState(false);

  // Permit layer inputs.
  const [trade, setTrade] = useState<Trade>('roofing');
  const [city, setCity] = useState('Dallas');

  // Print composer.
  const [pageSize, setPageSize] = useState<PageSize>('letter');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [sheetTitle, setSheetTitle] = useState('GIS Workbench plan sheet');
  const [printBusy, setPrintBusy] = useState(false);
  const [printMsg, setPrintMsg] = useState<string | null>(null);

  // Extensions panel.
  const [toolId, setToolId] = useState<ExtensionToolId>('union');
  const [toolLayerA, setToolLayerA] = useState<LayerId>('parcels');
  const [toolLayerB, setToolLayerB] = useState<LayerId>('hail');
  const [bufferFeet, setBufferFeet] = useState(50);
  const [toolConfirming, setToolConfirming] = useState(false);
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);

  const loadedBbox = useRef<string>('');
  const tool = EXTENSION_TOOLS.find((t) => t.id === toolId)!;
  const printCheck = session.check('export:create');

  const setLayer = useCallback((id: LayerId, patch: Partial<LayerState>) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const setLayerFeatures = useCallback((id: LayerId, next: GisFeature[]) => {
    setFeatures((prev) => ({ ...prev, [id]: next }));
  }, []);

  const loadBboxLayer = useCallback(
    async (id: 'parcels' | 'streams' | 'roofs', bounds: WorkbenchView['bounds']) => {
      setLayer(id, { status: 'loading', message: 'Loading…' });
      try {
        if (id === 'parcels') {
          const res = await api.post('/v1/gis/layers/parcels', { bbox: bounds }, { schema: GisParcelsResponseSchema });
          const next = res.features.map((f, i) => ({
            id: apiFeatureId('parcels', f.properties as Record<string, unknown>, i),
            geometry: f.geometry as GisFeature['geometry'],
            properties: f.properties as Record<string, unknown>,
          }));
          setLayerFeatures('parcels', next);
          setLayer('parcels', {
            status: res.status === 'upstream_unavailable' ? 'unavailable' : res.status,
            featureCount: res.featureCount,
            message: res.message,
            checkedAt: res.checkedAt,
            truncated: res.truncated,
          });
        } else if (id === 'streams') {
          const res = await api.post('/v1/gis/layers/streams', { bbox: bounds }, { schema: GisStreamsResponseSchema });
          const next = res.features.map((f, i) => ({
            id: apiFeatureId('streams', f.properties as Record<string, unknown>, i),
            geometry: f.geometry as GisFeature['geometry'],
            properties: f.properties as Record<string, unknown>,
          }));
          setLayerFeatures('streams', next);
          setLayer('streams', {
            status: res.status === 'upstream_unavailable' ? 'unavailable' : res.status,
            featureCount: res.featureCount,
            message: res.message,
            checkedAt: res.checkedAt,
            truncated: res.truncated,
          });
        } else {
          const res = await api.post('/v1/gis/layers/roofs', { bbox: bounds }, { schema: GisRoofsResponseSchema });
          const next = res.features.map((f, i) => ({
            id: apiFeatureId('roofs', f.properties as Record<string, unknown>, i),
            geometry: f.geometry as GisFeature['geometry'],
            properties: f.properties as Record<string, unknown>,
          }));
          setLayerFeatures('roofs', next);
          setLayer('roofs', {
            status: res.status,
            featureCount: res.featureCount,
            message:
              res.unreadable > 0
                ? `${res.message} ${res.unreadable} saved measurement(s) could not be read and were left off.`
                : res.message,
            checkedAt: res.checkedAt,
            truncated: false,
          });
        }
      } catch (err) {
        setLayer(id, { status: 'error', message: errorMessage(err) });
      }
    },
    [api, setLayer, setLayerFeatures],
  );

  const loadHail = useCallback(async () => {
    setLayer('hail', { status: 'loading', message: 'Loading…' });
    try {
      const res = await api.get('/v1/roof-storms/swath', { schema: SwathSchema, query: { days: 1 } });
      const next: GisFeature[] = res.swath.features.map((f, i) => ({
        id: apiFeatureId('hail', {}, i),
        geometry: f.geometry as GisFeature['geometry'],
        properties: { layer: 'hail', maxHailIn: f.properties.maxHailIn, kind: res.kind, date: res.date },
      }));
      setLayerFeatures('hail', next);
      setLayer('hail', {
        status: res.status === 'unavailable' ? 'unavailable' : next.length > 0 ? 'ok' : 'empty',
        featureCount: next.length,
        message: `${res.message} ${res.note}`,
        checkedAt: res.checkedAt,
        truncated: false,
      });
    } catch (err) {
      setLayer('hail', { status: 'error', message: errorMessage(err) });
    }
  }, [api, setLayer, setLayerFeatures]);

  const loadPermits = useCallback(async () => {
    const home = city.trim();
    if (home.length < 2) {
      setLayer('permits', { status: 'error', message: 'Enter a city to search permits for.' });
      return;
    }
    setLayer('permits', { status: 'loading', message: 'Searching permits…' });
    try {
      const res = await api.post(
        '/v1/permit-leads/search',
        { trade, cities: [home], homeCity: home, days: 90, earlyOnly: false },
        { schema: PermitResultSchema },
      );
      const { features: plotted, withoutCoords } = permitsToFeatures(res.leads);
      setLayerFeatures('permits', plotted);
      setLayer('permits', {
        status: plotted.length > 0 ? 'ok' : 'empty',
        featureCount: plotted.length,
        message: `${plotted.length} permit(s) plotted for ${home} (${TRADES[trade]}). ${withoutCoords} more had no published coordinates and are counted here, not placed on the map.`,
        checkedAt: new Date().toISOString(),
        truncated: false,
      });
    } catch (err) {
      setLayer('permits', { status: 'error', message: errorMessage(err) });
    }
  }, [api, city, trade, setLayer, setLayerFeatures]);

  const loadVisible = useCallback(
    (bounds: WorkbenchView['bounds']) => {
      const key = `${bounds.west.toFixed(4)},${bounds.south.toFixed(4)},${bounds.east.toFixed(4)},${bounds.north.toFixed(4)}`;
      loadedBbox.current = key;
      for (const id of ['parcels', 'streams', 'roofs'] as const) {
        if (layerStates[id].visible) void loadBboxLayer(id, bounds);
      }
    },
    [layerStates, loadBboxLayer],
  );

  // First load once the map reports its view.
  useEffect(() => {
    if (view && loadedBbox.current === '') loadVisible(view.bounds);
  }, [view, loadVisible]);

  const toggleLayer = (id: LayerId, visible: boolean) => {
    setLayer(id, { visible });
    if (!visible) return;
    if (id === 'hail') void loadHail();
    else if (id === 'permits') void loadPermits();
    else if (view) void loadBboxLayer(id, view.bounds);
  };

  const onIdentify = useCallback(
    (layerId: LayerId, featureId: string) => {
      const feature = features[layerId].find((f) => f.id === featureId);
      if (!feature) return;
      setIdentified({ layerId, feature });
      setHighlighted(feature);
      setActiveLayer(layerId);
    },
    [features],
  );

  const onRowClick = (feature: GisFeature) => {
    setHighlighted(feature);
    setIdentified({ layerId: activeLayer, feature });
    const c = centroid(feature);
    if (c) mapRef.current?.flyTo(c.lon, c.lat);
  };

  const tableRows = useMemo(() => {
    const columns = ATTRIBUTE_COLUMNS[activeLayer];
    const filtered = filterRows(features[activeLayer], filter, columns);
    return sort ? sortRows(filtered, sort, columns) : filtered;
  }, [activeLayer, features, filter, sort]);

  const distance = useMemo(
    () => (measureMode === 'distance' ? measureDistance(measurePoints) : null),
    [measureMode, measurePoints],
  );
  const area = useMemo(
    () => (measureMode === 'area' ? measureArea(measurePoints) : null),
    [measureMode, measurePoints],
  );

  const runTool = () => {
    const result = runExtensionTool({
      toolId,
      layerA: toolLayerA,
      featuresA: features[toolLayerA],
      layerB: toolLayerB,
      featuresB: features[toolLayerB],
      bufferFeet,
    });
    setToolResult(result);
    setToolConfirming(false);
  };

  const exportSheet = async () => {
    const current = mapRef.current?.getView() ?? view;
    const png = mapRef.current?.capturePng();
    if (!current || !png) {
      setPrintMsg('The map is not ready to print yet — wait for it to load, then try again.');
      return;
    }
    setPrintBusy(true);
    setPrintMsg(null);
    try {
      const bar = scaleBar(current.centerLat, current.zoom, current.canvasCssWidth);
      const res = await api.post(
        '/v1/gis/print',
        {
          organizationName:
            session.me.memberships.find((m) => m.orgId === session.me.activeOrgId)?.orgDisplayName ??
            'Field Pro workspace',
          title: sheetTitle.trim() || 'GIS Workbench plan sheet',
          pageSize,
          orientation,
          mapImageDataUrl: png,
          centerLat: current.centerLat,
          centerLon: current.centerLon,
          zoom: current.zoom,
          bearing: current.bearing,
          scaleBarLabel: bar.label,
          scaleBarWidthFraction: bar.widthFraction,
          legend: buildLegend(layerStates),
          layerSummary: buildLayerSummary(layerStates),
          sourceNotes: buildSourceNotes(layerStates),
        },
        { schema: GisPrintResponseSchema },
      );
      const bytes = Uint8Array.from(atob(res.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setPrintMsg(`Plan sheet ${res.filename} downloaded (${res.pages} page). It is a DRAFT — not a survey.`);
    } catch (err) {
      setPrintMsg(errorMessage(err));
    } finally {
      setPrintBusy(false);
    }
  };

  const dims = pageDimensions(pageSize, orientation);

  return (
    <div className="gis-workbench">
      <PageHeader
        title="GIS Workbench"
        description="Map workspace: parcels, permits, streams, hail and your traced roofs as toggleable layers, with attribute tables, measuring, a plan-sheet printer, 3D terrain and built-in geometry tools."
      />

      <div className="gis-layout">
        <aside className="gis-sidebar" aria-label="Layers and tools">
          <section className="web-card gis-panel" aria-labelledby="gis-layers-heading">
            <h2 id="gis-layers-heading">Layers</h2>
            {LAYER_DEFS.map((def) => {
              const state = layerStates[def.id];
              return (
                <div key={def.id} className="gis-layer-row">
                  <div className="gis-layer-head">
                    <label>
                      <input
                        type="checkbox"
                        checked={state.visible}
                        onChange={(e) => toggleLayer(def.id, e.target.checked)}
                      />{' '}
                      {def.label}
                    </label>
                    <button
                      type="button"
                      className="web-button web-button-secondary gis-mini"
                      aria-pressed={activeLayer === def.id}
                      onClick={() => setActiveLayer(def.id)}
                    >
                      {activeLayer === def.id ? 'Table: on' : 'Table'}
                    </button>
                  </div>
                  <div className="gis-layer-controls">
                    <label>
                      Color
                      <input
                        type="color"
                        value={state.color}
                        onChange={(e) => setLayer(def.id, { color: e.target.value })}
                      />
                    </label>
                    <label>
                      Opacity
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={state.opacity}
                        onChange={(e) => setLayer(def.id, { opacity: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <p className="web-muted web-small" role="status">
                    {state.status === 'loading' ? 'Loading…' : state.message}
                    {state.truncated ? ' (capped — zoom in for the rest)' : ''}
                  </p>
                </div>
              );
            })}
            <button
              type="button"
              className="web-button web-button-secondary"
              onClick={() => view && loadVisible(view.bounds)}
            >
              Reload layers for this view
            </button>
          </section>

          <section className="web-card gis-panel" aria-labelledby="gis-permits-heading">
            <h2 id="gis-permits-heading">Permit layer search</h2>
            <label className="gis-field">
              Trade
              <select value={trade} onChange={(e) => setTrade(e.target.value as Trade)}>
                {Object.entries(TRADES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="gis-field">
              City
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <button type="button" className="web-button" onClick={() => void loadPermits()}>
              Load permits
            </button>
            <p className="web-muted web-small">
              Same search as Permit Job Search. Only permits the feed published coordinates for are
              plotted; the rest are counted in the layer status, never placed by guessing.
            </p>
          </section>

          <section className="web-card gis-panel" aria-labelledby="gis-measure-heading">
            <h2 id="gis-measure-heading">Measure</h2>
            <div className="gis-button-row" role="group" aria-label="Measure mode">
              <button
                type="button"
                className="web-button web-button-secondary"
                aria-pressed={measureMode === 'distance'}
                onClick={() => {
                  setMeasureMode(measureMode === 'distance' ? 'off' : 'distance');
                  setMeasurePoints([]);
                }}
              >
                Distance
              </button>
              <button
                type="button"
                className="web-button web-button-secondary"
                aria-pressed={measureMode === 'area'}
                onClick={() => {
                  setMeasureMode(measureMode === 'area' ? 'off' : 'area');
                  setMeasurePoints([]);
                }}
              >
                Area
              </button>
              <button
                type="button"
                className="web-button web-button-secondary"
                onClick={() => setMeasurePoints((p) => p.slice(0, -1))}
                disabled={measurePoints.length === 0}
              >
                Undo point
              </button>
              <button
                type="button"
                className="web-button web-button-secondary"
                onClick={() => setMeasurePoints([])}
                disabled={measurePoints.length === 0}
              >
                Clear
              </button>
            </div>
            <p className="web-muted web-small" role="status">
              {measureMode === 'off'
                ? 'Pick Distance or Area, then click points on the map. Measured on the WGS84 ellipsoid (GeographicLib) — the same math QGIS uses.'
                : distance
                  ? `Distance: ${distance.label} (${distance.segments} segment(s))`
                  : area
                    ? `Area: ${area.label}`
                    : `${measurePoints.length} point(s) — keep clicking${measureMode === 'distance' ? ' (2+ for a distance)' : ' (3+ for an area)'}.`}
            </p>
          </section>

          <section className="web-card gis-panel" aria-labelledby="gis-ext-heading">
            <h2 id="gis-ext-heading">Extensions</h2>
            <p className="web-muted web-small">
              Built-in geometry tools. They run on the layers you pick and draw a result overlay —
              nothing is written back to the source data.
            </p>
            <label className="gis-field">
              Tool
              <select value={toolId} onChange={(e) => setToolId(e.target.value as ExtensionToolId)}>
                {EXTENSION_TOOLS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="web-muted web-small">{tool.description}</p>
            <label className="gis-field">
              Layer
              <select value={toolLayerA} onChange={(e) => setToolLayerA(e.target.value as LayerId)}>
                {LAYER_DEFS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({features[d.id].length} loaded)
                  </option>
                ))}
              </select>
            </label>
            {tool.needsSecondLayer ? (
              <label className="gis-field">
                Second layer
                <select value={toolLayerB} onChange={(e) => setToolLayerB(e.target.value as LayerId)}>
                  {LAYER_DEFS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} ({features[d.id].length} loaded)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {tool.needsDistance ? (
              <label className="gis-field">
                Distance (ft)
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={bufferFeet}
                  onChange={(e) => setBufferFeet(Number(e.target.value))}
                />
              </label>
            ) : null}
            {toolConfirming ? (
              <div className="gis-confirm" role="group" aria-label="Confirm tool run">
                <p className="web-small">
                  Run <strong>{tool.label}</strong> on {layerDef(toolLayerA).label}
                  {tool.needsSecondLayer ? ` and ${layerDef(toolLayerB).label}` : ''}? The result is
                  a display overlay only.
                </p>
                <div className="gis-button-row">
                  <button type="button" className="web-button" onClick={runTool}>
                    Yes, run it
                  </button>
                  <button
                    type="button"
                    className="web-button web-button-secondary"
                    onClick={() => setToolConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="web-button" onClick={() => setToolConfirming(true)}>
                Run tool…
              </button>
            )}
            {toolResult ? (
              <div role="status">
                <p className="web-small">{toolResult.summary}</p>
                {toolResult.warnings.map((w) => (
                  <p key={w} className="web-muted web-small">
                    {w}
                  </p>
                ))}
                <button
                  type="button"
                  className="web-button web-button-secondary"
                  onClick={() => setToolResult(null)}
                >
                  Clear result
                </button>
              </div>
            ) : null}
          </section>

          <section className="web-card gis-panel" aria-labelledby="gis-print-heading">
            <h2 id="gis-print-heading">Print layout</h2>
            <label className="gis-field">
              Title
              <input type="text" value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} />
            </label>
            <label className="gis-field">
              Page size
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSize)}>
                {Object.entries(PAGE_SIZES).map(([id, def]) => (
                  <option key={id} value={id}>
                    {def.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="gis-field">
              Orientation
              <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
            <p className="web-muted web-small">
              Sheet: {dims.widthIn} × {dims.heightIn} in, map frame = current view, legend from visible
              layers, scale bar approximate at map centre, north arrow from the map bearing. The PDF
              says DRAFT PLAN SHEET — not a survey.
            </p>
            {printCheck.allowed ? (
              <button type="button" className="web-button" disabled={printBusy} onClick={() => void exportSheet()}>
                {printBusy ? 'Rendering…' : 'Export plan sheet PDF'}
              </button>
            ) : (
              <p className="web-muted web-small" role="status">
                Printing needs the export permission. {printCheck.reason ?? ''}
              </p>
            )}
            {printMsg ? (
              <p className="web-small" role="status">
                {printMsg}
              </p>
            ) : null}
          </section>

          <section className="web-card gis-panel" aria-labelledby="gis-3d-heading">
            <h2 id="gis-3d-heading">3D terrain</h2>
            <p className="web-muted web-small">
              USGS 3DEP ground heights around the map centre with your traced roofs standing on it.
              Not a survey.
            </p>
            <button
              type="button"
              className="web-button web-button-secondary"
              aria-pressed={show3d}
              onClick={() => setShow3d((v) => !v)}
            >
              {show3d ? 'Back to 2D map' : 'Show 3D terrain'}
            </button>
          </section>
        </aside>

        <div className="gis-main">
          {show3d && view ? (
            <section className="web-card gis-panel" aria-label="3D terrain view">
              <Terrain3D centerLat={view.centerLat} centerLon={view.centerLon} roofs={features.roofs} />
            </section>
          ) : (
            <WorkbenchMap
              ref={mapRef}
              layerStates={layerStates}
              features={features}
              toolResultFeatures={toolResult?.features ?? []}
              toolResultColor="#a78bfa"
              activeLayer={activeLayer}
              measureMode={measureMode}
              measurePoints={measurePoints}
              onMeasurePoint={(p) => setMeasurePoints((prev) => [...prev, p])}
              onIdentify={onIdentify}
              onViewChange={setView}
              highlighted={highlighted}
            />
          )}

          {identified ? (
            <section className="web-card gis-panel" aria-labelledby="gis-identify-heading">
              <div className="gis-panel-head">
                <h2 id="gis-identify-heading">Identify — {layerDef(identified.layerId).label}</h2>
                <button
                  type="button"
                  className="web-button web-button-secondary gis-mini"
                  onClick={() => {
                    setIdentified(null);
                    setHighlighted(null);
                  }}
                >
                  Close
                </button>
              </div>
              <dl className="gis-identify">
                {identifyRows(identified.feature, ATTRIBUTE_COLUMNS[identified.layerId]).map((row) => (
                  <div key={row.label} className="gis-identify-row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="web-card gis-panel" aria-labelledby="gis-table-heading">
            <div className="gis-panel-head">
              <h2 id="gis-table-heading">
                Attribute table — {layerDef(activeLayer).label} ({tableRows.length} of{' '}
                {features[activeLayer].length})
              </h2>
              <label className="gis-filter">
                <span className="gis-visually-hidden">Filter rows</span>
                <input
                  type="search"
                  placeholder="Filter rows…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
            </div>
            {features[activeLayer].length === 0 ? (
              <p className="web-muted">
                Nothing loaded for this layer yet. Turn it on in the layer panel (or reload for this
                view) and its records will appear here.
              </p>
            ) : (
              <div className="gis-table-scroll">
                <table className="gis-table">
                  <thead>
                    <tr>
                      {ATTRIBUTE_COLUMNS[activeLayer].map((column) => {
                        const isSorted = sort?.key === column.key;
                        return (
                          <th key={column.key} scope="col" aria-sort={isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                            <button
                              type="button"
                              className="gis-sort"
                              onClick={() =>
                                setSort((prev) =>
                                  prev?.key === column.key
                                    ? { key: column.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
                                    : { key: column.key, direction: 'asc' },
                                )
                              }
                            >
                              {column.label}
                              {isSorted ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.slice(0, 300).map((feature) => (
                      <tr
                        key={feature.id}
                        className={highlighted?.id === feature.id ? 'gis-row-selected' : undefined}
                        onClick={() => onRowClick(feature)}
                      >
                        {ATTRIBUTE_COLUMNS[activeLayer].map((column) => (
                          <td key={column.key}>{cellText(feature.properties[column.key], column)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tableRows.length > 300 ? (
                  <p className="web-muted web-small">
                    Showing the first 300 of {tableRows.length} rows — filter to narrow down.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
