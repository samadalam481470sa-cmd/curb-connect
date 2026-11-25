'use client';

// GIS Workbench map: MapLibre GL over Esri World Imagery, the same stack as the roof tracer,
// with one GeoJSON source per workbench layer. Layer color/opacity/visibility are applied with
// setPaintProperty/setLayoutProperty so styling never rewrites data. Click identifies features
// (queryRenderedFeatures over the visible layer stack); measure mode turns clicks into points
// for the parent's geodesic measure tools. The canvas keeps its drawing buffer so the print
// composer can capture the exact view the contractor sees.
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { LAYER_DEFS, type GisFeature, type LayerId, type LayerState } from './layers';
import type { MeasurePoint } from './measure';

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIB =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · Search © OpenStreetMap contributors';

// Dallas default, like the roof tracer; the contractor flies to the job.
const DEFAULT_CENTER: [number, number] = [-96.797, 32.7767];
const EMPTY = { type: 'FeatureCollection' as const, features: [] as unknown[] };

export interface WorkbenchView {
  centerLat: number;
  centerLon: number;
  zoom: number;
  bearing: number;
  bounds: { west: number; south: number; east: number; north: number };
  canvasCssWidth: number;
}

export interface WorkbenchMapHandle {
  /** PNG data URL of the current view (for the plan sheet), or null if the map is not ready. */
  capturePng: () => string | null;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  getView: () => WorkbenchView | null;
}

export type MeasureMode = 'off' | 'distance' | 'area';

export interface WorkbenchMapProps {
  layerStates: Record<LayerId, LayerState>;
  features: Record<LayerId, readonly GisFeature[]>;
  toolResultFeatures: readonly GisFeature[];
  toolResultColor: string;
  activeLayer: LayerId;
  measureMode: MeasureMode;
  measurePoints: readonly MeasurePoint[];
  onMeasurePoint: (point: MeasurePoint) => void;
  onIdentify: (layerId: LayerId, featureId: string) => void;
  onViewChange: (view: WorkbenchView) => void;
  /** Feature to outline (from the attribute table or identify). */
  highlighted: GisFeature | null;
}

const sourceId = (layer: LayerId) => `gis-${layer}`;
const fillId = (layer: LayerId) => `gis-${layer}-fill`;
const lineId = (layer: LayerId) => `gis-${layer}-line`;
const pointId = (layer: LayerId) => `gis-${layer}-point`;

function toGeoJson(features: readonly GisFeature[]) {
  return {
    type: 'FeatureCollection' as const,
    features: features.map((f) => ({
      type: 'Feature' as const,
      id: f.id,
      geometry: f.geometry,
      properties: { ...f.properties, __fid: f.id },
    })),
  };
}

function measureGeoJson(points: readonly MeasurePoint[], mode: MeasureMode) {
  const coords = points.map((p) => [p.lon, p.lat]);
  const features: unknown[] = points.map((p, i) => ({
    type: 'Feature',
    properties: { first: i === 0 ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  }));
  if (coords.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  if (mode === 'area' && coords.length >= 3) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]!]] },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

function WorkbenchMapInner(
  props: WorkbenchMapProps,
  ref: React.Ref<WorkbenchMapHandle>,
) {
  const {
    layerStates,
    features,
    toolResultFeatures,
    toolResultColor,
    activeLayer,
    measureMode,
    measurePoints,
    onMeasurePoint,
    onIdentify,
    onViewChange,
    highlighted,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [coords, setCoords] = useState('');

  const callbacks = useRef({ onMeasurePoint, onIdentify, onViewChange });
  useEffect(() => {
    callbacks.current = { onMeasurePoint, onIdentify, onViewChange };
  }, [onMeasurePoint, onIdentify, onViewChange]);

  const stateRef = useRef({ layerStates, activeLayer, measureMode });
  useEffect(() => {
    stateRef.current = { layerStates, activeLayer, measureMode };
  }, [layerStates, activeLayer, measureMode]);

  const readView = useCallback((map: MlMap): WorkbenchView => {
    const center = map.getCenter();
    const bounds = map.getBounds();
    return {
      centerLat: center.lat,
      centerLon: center.lng,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      bounds: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      canvasCssWidth: container.current?.clientWidth ?? map.getCanvas().clientWidth,
    };
  }, []);

  useImperativeHandle(ref, () => ({
    capturePng: () => {
      const map = mapRef.current;
      if (!map || !ready) return null;
      try {
        return map.getCanvas().toDataURL('image/png');
      } catch {
        return null;
      }
    },
    flyTo: (lon, lat, zoom) => {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(mapRef.current.getZoom(), 17) });
    },
    getView: () => (mapRef.current ? readView(mapRef.current) : null),
  }));

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (disposed || !container.current) return;
        ml.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
        map = new ml.Map({
          container: container.current,
          center: DEFAULT_CENTER,
          zoom: 16,
          maxZoom: 21,
          doubleClickZoom: false,
          // Keep the drawing buffer so the print composer can capture the exact view.
          canvasContextAttributes: { preserveDrawingBuffer: true },
          attributionControl: { compact: true },
          style: {
            version: 8,
            sources: {
              imagery: {
                type: 'raster',
                tiles: [ESRI_IMAGERY],
                tileSize: 256,
                maxzoom: 19,
                attribution: ESRI_ATTRIB,
              },
              labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 19 },
            },
            layers: [
              { id: 'bg', type: 'background', paint: { 'background-color': '#050a12' } },
              {
                id: 'imagery',
                type: 'raster',
                source: 'imagery',
                paint: { 'raster-fade-duration': 150 },
              },
              { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'visible' } },
            ],
          },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new ml.ScaleControl({ unit: 'imperial' }), 'bottom-left');

        map.on('load', () => {
          if (!map) return;
          for (const def of LAYER_DEFS) {
            map.addSource(sourceId(def.id), { type: 'geojson', data: EMPTY as never });
            if (def.kind === 'polygon') {
              map.addLayer({
                id: fillId(def.id),
                type: 'fill',
                source: sourceId(def.id),
                paint: { 'fill-color': def.defaultColor, 'fill-opacity': def.defaultOpacity },
              });
              map.addLayer({
                id: lineId(def.id),
                type: 'line',
                source: sourceId(def.id),
                paint: { 'line-color': def.defaultColor, 'line-width': 1.5, 'line-opacity': 0.9 },
              });
            } else if (def.kind === 'line') {
              map.addLayer({
                id: lineId(def.id),
                type: 'line',
                source: sourceId(def.id),
                paint: { 'line-color': def.defaultColor, 'line-width': 2.5, 'line-opacity': def.defaultOpacity },
              });
            } else {
              map.addLayer({
                id: pointId(def.id),
                type: 'circle',
                source: sourceId(def.id),
                paint: {
                  'circle-radius': 6,
                  'circle-color': def.defaultColor,
                  'circle-opacity': def.defaultOpacity,
                  'circle-stroke-color': '#050a12',
                  'circle-stroke-width': 1.5,
                },
              });
            }
          }
          // Extension-tool results overlay (display only, never source data).
          map.addSource('gis-tool-result', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'gis-tool-result-fill',
            type: 'fill',
            source: 'gis-tool-result',
            paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.3 },
          });
          map.addLayer({
            id: 'gis-tool-result-line',
            type: 'line',
            source: 'gis-tool-result',
            paint: { 'line-color': '#a78bfa', 'line-width': 2.5, 'line-dasharray': [2, 1] },
          });
          // Highlight outline for the table/identify selection.
          map.addSource('gis-highlight', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'gis-highlight-line',
            type: 'line',
            source: 'gis-highlight',
            paint: { 'line-color': '#ffffff', 'line-width': 3.5 },
          });
          map.addLayer({
            id: 'gis-highlight-point',
            type: 'circle',
            source: 'gis-highlight',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': 11,
              'circle-color': 'rgba(255,255,255,0)',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 3,
            },
          });
          // Measure points/line/area.
          map.addSource('gis-measure', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'gis-measure-fill',
            type: 'fill',
            source: 'gis-measure',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': '#c4b5fd', 'fill-opacity': 0.25 },
          });
          map.addLayer({
            id: 'gis-measure-line',
            type: 'line',
            source: 'gis-measure',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: { 'line-color': '#c4b5fd', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
          });
          map.addLayer({
            id: 'gis-measure-pts',
            type: 'circle',
            source: 'gis-measure',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': ['case', ['==', ['get', 'first'], 1], 7, 5],
              'circle-color': ['case', ['==', ['get', 'first'], 1], '#a78bfa', '#e6f1ff'],
              'circle-stroke-color': '#050a12',
              'circle-stroke-width': 2,
            },
          });
          setReady(true);
          callbacks.current.onViewChange(readView(map));
        });

        map.on('click', (e: MapMouseEvent) => {
          if (!map) return;
          const { layerStates: states, activeLayer: active, measureMode: mode } = stateRef.current;
          if (mode !== 'off') {
            callbacks.current.onMeasurePoint({ lon: e.lngLat.lng, lat: e.lngLat.lat });
            return;
          }
          // Identify: active layer first, then the rest of the visible stack.
          const order: LayerId[] = [active, ...LAYER_DEFS.map((d) => d.id).filter((id) => id !== active)];
          for (const layerId of order) {
            if (!states[layerId].visible) continue;
            const def = LAYER_DEFS.find((d) => d.id === layerId)!;
            const ids =
              def.kind === 'polygon'
                ? [fillId(layerId)]
                : def.kind === 'line'
                  ? [lineId(layerId)]
                  : [pointId(layerId)];
            const hit = map.queryRenderedFeatures(e.point, { layers: ids })[0];
            const fid = hit?.properties?.__fid;
            if (typeof fid === 'string' && fid !== '') {
              callbacks.current.onIdentify(layerId, fid);
              return;
            }
          }
        });

        const settle = () => {
          if (!map) return;
          const c = map.getCenter();
          setCoords(`${c.lat.toFixed(5)}°, ${c.lng.toFixed(5)}° · z${map.getZoom().toFixed(1)}`);
          callbacks.current.onViewChange(readView(map));
        };
        map.on('moveend', settle);
        settle();
      } catch (err) {
        if (!disposed) setFailed(err instanceof Error ? err.message : 'Map failed to load');
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, [readView]);

  // Layer data -> sources.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    for (const def of LAYER_DEFS) {
      const src = map.getSource(sourceId(def.id)) as GeoJSONSource | undefined;
      src?.setData(toGeoJson(features[def.id]) as never);
    }
  }, [ready, features]);

  // Tool result overlay.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('gis-tool-result') as GeoJSONSource | undefined;
    src?.setData(toGeoJson(toolResultFeatures) as never);
    map.setPaintProperty('gis-tool-result-fill', 'fill-color', toolResultColor);
    map.setPaintProperty('gis-tool-result-line', 'line-color', toolResultColor);
  }, [ready, toolResultFeatures, toolResultColor]);

  // Styling: visibility, color, opacity per layer.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    for (const def of LAYER_DEFS) {
      const state = layerStates[def.id];
      const visibility = state.visible ? 'visible' : 'none';
      if (def.kind === 'polygon') {
        map.setLayoutProperty(fillId(def.id), 'visibility', visibility);
        map.setLayoutProperty(lineId(def.id), 'visibility', visibility);
        map.setPaintProperty(fillId(def.id), 'fill-color', state.color);
        map.setPaintProperty(fillId(def.id), 'fill-opacity', state.opacity);
        map.setPaintProperty(lineId(def.id), 'line-color', state.color);
      } else if (def.kind === 'line') {
        map.setLayoutProperty(lineId(def.id), 'visibility', visibility);
        map.setPaintProperty(lineId(def.id), 'line-color', state.color);
        map.setPaintProperty(lineId(def.id), 'line-opacity', state.opacity);
      } else {
        map.setLayoutProperty(pointId(def.id), 'visibility', visibility);
        map.setPaintProperty(pointId(def.id), 'circle-color', state.color);
        map.setPaintProperty(pointId(def.id), 'circle-opacity', state.opacity);
      }
    }
    map.getCanvas().style.cursor = measureMode !== 'off' ? 'crosshair' : '';
  }, [ready, layerStates, measureMode]);

  // Measure overlay.
  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource('gis-measure') as GeoJSONSource | undefined;
    src?.setData(measureGeoJson(measurePoints, measureMode) as never);
  }, [ready, measurePoints, measureMode]);

  // Highlight outline.
  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource('gis-highlight') as GeoJSONSource | undefined;
    src?.setData(
      (highlighted
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: highlighted.geometry, properties: {} }],
          }
        : EMPTY) as never,
    );
  }, [ready, highlighted]);

  const search = useCallback(async () => {
    const map = mapRef.current;
    const q = query.trim();
    if (!map || q === '') return;
    setSearchMsg('Searching…');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
      const first = rows[0];
      if (!first) {
        setSearchMsg('No match — try a fuller address (street, city, TX).');
        return;
      }
      map.flyTo({ center: [Number(first.lon), Number(first.lat)], zoom: 18 });
      setSearchMsg(first.display_name ?? 'Found.');
    } catch {
      setSearchMsg('Address search is unavailable right now.');
    }
  }, [query]);

  if (failed) {
    return (
      <div className="gis-map gis-map-failed" role="alert">
        <p>The map could not load: {failed}</p>
        <p className="web-muted">Check your connection and reload the page. Layer data is unaffected.</p>
      </div>
    );
  }

  return (
    <div className="gis-map-wrap">
      <div className="gis-map-toolbar">
        <label className="gis-search">
          <span className="gis-visually-hidden">Fly to address</span>
          <input
            type="search"
            value={query}
            placeholder="Fly to address (street, city, TX)"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
        </label>
        <button type="button" className="web-button web-button-secondary" onClick={() => void search()}>
          Go
        </button>
        <span className="gis-coords" aria-live="polite">
          {coords}
        </span>
      </div>
      {searchMsg ? (
        <p className="gis-search-msg web-muted web-small" role="status">
          {searchMsg}
        </p>
      ) : null}
      <div ref={container} className="gis-map" aria-label="GIS workbench map" />
    </div>
  );
}

export const WorkbenchMap = memo(forwardRef(WorkbenchMapInner));
