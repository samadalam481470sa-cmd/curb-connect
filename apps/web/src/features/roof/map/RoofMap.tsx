'use client';

// Map-first roof tracing (RF-023). MapLibre is loaded lazily so the rest of the workspace paints
// first. Imagery is Esri World Imagery (display use, attribution shown). Map state lives here; the
// parent only receives finished facet rings, so panning and drawing never rerender the page.
import 'maplibre-gl/dist/maplibre-gl.css';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { facetsGeoJson, type MapFacet, type MapFacetResult } from './facetMath';

type LonLat = { lon: number; lat: number };
export type MapView = 'satellite' | 'hybrid' | 'blueprint';

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIB =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · Search © OpenStreetMap contributors';

// Dallas default; the contractor flies to the job address.
const DEFAULT_CENTER: [number, number] = [-96.797, 32.7767];
const CLOSE_PX = 12;

const EMPTY = { type: 'FeatureCollection' as const, features: [] as unknown[] };

function draftGeoJson(points: LonLat[], cursor: LonLat | null) {
  const coords = points.map((p) => [p.lon, p.lat]);
  const features: unknown[] = points.map((p, i) => ({
    type: 'Feature',
    properties: { first: i === 0 ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  }));
  const line = cursor ? [...coords, [cursor.lon, cursor.lat]] : coords;
  if (line.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: line },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

export interface RoofMapProps {
  facets: readonly MapFacet[];
  results: readonly MapFacetResult[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFacetDrawn: (ring: LonLat[]) => void;
}

function RoofMapInner({ facets, results, selectedId, onSelect, onFacetDrawn }: RoofMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const draft = useRef<LonLat[]>([]);
  const cursor = useRef<LonLat | null>(null);
  const frame = useRef<number | null>(null);
  const drawingRef = useRef(false);
  const callbacks = useRef({ onSelect, onFacetDrawn });
  useEffect(() => {
    callbacks.current = { onSelect, onFacetDrawn };
  }, [onSelect, onFacetDrawn]);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [vertexCount, setVertexCount] = useState(0);
  const [view, setView] = useState<MapView>('satellite');
  const [query, setQuery] = useState('');
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [coords, setCoords] = useState<string>('');

  // Draft redraws are coalesced to one per animation frame (no jank on fast mouse moves).
  const paintDraft = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const src = mapRef.current?.getSource('draft') as GeoJSONSource | undefined;
      src?.setData(
        draftGeoJson(draft.current, drawingRef.current ? cursor.current : null) as never,
      );
    });
  }, []);

  const finish = useCallback(() => {
    const ring = draft.current;
    if (ring.length >= 3) callbacks.current.onFacetDrawn(ring.slice());
    draft.current = [];
    cursor.current = null;
    drawingRef.current = false;
    setDrawing(false);
    setVertexCount(0);
    paintDraft();
  }, [paintDraft]);

  const cancel = useCallback(() => {
    draft.current = [];
    cursor.current = null;
    drawingRef.current = false;
    setDrawing(false);
    setVertexCount(0);
    paintDraft();
  }, [paintDraft]);

  const undo = useCallback(() => {
    draft.current = draft.current.slice(0, -1);
    setVertexCount(draft.current.length);
    paintDraft();
  }, [paintDraft]);

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let map: MlMap | null = null;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (disposed || !container.current) return;
        // Served from public/ (scripts/copy-maplibre-worker.mjs); the version query busts caches.
        ml.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
        map = new ml.Map({
          container: container.current,
          center: DEFAULT_CENTER,
          zoom: 18,
          maxZoom: 21,
          doubleClickZoom: false,
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
              { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'none' } },
            ],
          },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new ml.ScaleControl({ unit: 'imperial' }), 'bottom-left');

        map.on('load', () => {
          if (!map) return;
          map.addSource('facets', { type: 'geojson', data: EMPTY as never });
          map.addSource('draft', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'facet-fill',
            type: 'fill',
            source: 'facets',
            paint: {
              'fill-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                '#67e8f9',
                '#22d3ee',
              ],
              'fill-opacity': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                0.35,
                0.18,
              ],
            },
          });
          map.addLayer({
            id: 'facet-glow',
            type: 'line',
            source: 'facets',
            paint: {
              'line-color': '#22d3ee',
              'line-width': 8,
              'line-blur': 6,
              'line-opacity': 0.45,
            },
          });
          map.addLayer({
            id: 'facet-line',
            type: 'line',
            source: 'facets',
            paint: {
              'line-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                '#ffffff',
                '#a5f3fc',
              ],
              'line-width': 2,
            },
          });
          map.addLayer({
            id: 'draft-line',
            type: 'line',
            source: 'draft',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: { 'line-color': '#c4b5fd', 'line-width': 2, 'line-dasharray': [2, 1.5] },
          });
          map.addLayer({
            id: 'draft-pts',
            type: 'circle',
            source: 'draft',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': ['case', ['==', ['get', 'first'], 1], 7, 5],
              'circle-color': ['case', ['==', ['get', 'first'], 1], '#a78bfa', '#e6f1ff'],
              'circle-stroke-color': '#050a12',
              'circle-stroke-width': 2,
            },
          });
          setReady(true);
        });

        map.on('click', (e: MapMouseEvent) => {
          if (!map) return;
          if (drawingRef.current) {
            const pts = draft.current;
            if (pts.length >= 3) {
              const first = map.project([pts[0]!.lon, pts[0]!.lat]);
              if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX) {
                finish();
                return;
              }
            }
            draft.current = [...pts, { lon: e.lngLat.lng, lat: e.lngLat.lat }];
            setVertexCount(draft.current.length);
            paintDraft();
            return;
          }
          const hit = map.queryRenderedFeatures(e.point, { layers: ['facet-fill'] })[0];
          callbacks.current.onSelect(hit ? String(hit.properties?.id ?? '') || null : null);
        });

        map.on('dblclick', (e) => {
          if (drawingRef.current) {
            e.preventDefault();
            finish();
          }
        });

        map.on('mousemove', (e: MapMouseEvent) => {
          cursor.current = { lon: e.lngLat.lng, lat: e.lngLat.lat };
          if (drawingRef.current) paintDraft();
        });

        // Coordinate readout is throttled to camera settle, not every frame.
        const readout = () => {
          if (!map) return;
          const c = map.getCenter();
          setCoords(`${c.lat.toFixed(5)}°, ${c.lng.toFixed(5)}° · z${map.getZoom().toFixed(1)}`);
        };
        map.on('moveend', readout);
        readout();
      } catch (err) {
        if (!disposed) setFailed(err instanceof Error ? err.message : 'Map failed to load');
      }
    })();
    return () => {
      disposed = true;
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      map?.remove();
      mapRef.current = null;
    };
  }, [finish, paintDraft]);

  // Facet data -> map source (only when facets change).
  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource('facets') as GeoJSONSource | undefined;
    src?.setData(facetsGeoJson(facets, results) as never);
  }, [ready, facets, results]);

  // Selection highlight via feature-state (no data rewrite).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const f of facets) {
      map.setFeatureState({ source: 'facets', id: f.id }, { selected: f.id === selectedId });
    }
  }, [ready, facets, selectedId]);

  // View mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty('imagery', 'visibility', view === 'blueprint' ? 'none' : 'visible');
    map.setLayoutProperty('labels', 'visibility', view === 'hybrid' ? 'visible' : 'none');
  }, [ready, view]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  }, [drawing, ready]);

  // Keyboard: Enter finishes, Escape cancels, Backspace removes the last vertex.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))
        return;
      if (e.key === 'Escape') cancel();
      else if (e.key === 'Enter') finish();
      else if (e.key === 'Backspace') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, cancel, finish, undo]);

  const startDrawing = () => {
    draft.current = [];
    drawingRef.current = true;
    setDrawing(true);
    setVertexCount(0);
    callbacks.current.onSelect(null);
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !mapRef.current) return;
    setSearchMsg('Searching…');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      const hit = data[0];
      if (!hit) {
        setSearchMsg('No match. Try a full street address with city.');
        return;
      }
      mapRef.current.flyTo({ center: [Number(hit.lon), Number(hit.lat)], zoom: 19.5, speed: 1.6 });
      setSearchMsg(hit.display_name);
    } catch {
      setSearchMsg('Address search is unavailable right now. Pan to the roof by hand.');
    }
  };

  // Fit to the drawn facets.
  const fit = () => {
    const map = mapRef.current;
    const pts = facets.flatMap((f) => f.ring);
    if (!map || pts.length === 0) return;
    const lons = pts.map((p) => p.lon);
    const lats = pts.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 20.5, duration: 600 },
    );
  };

  return (
    <div className="cc-roofmap">
      <form className="cc-roofmap__search" onSubmit={search} role="search">
        <input
          className="cc-input"
          aria-label="Job address"
          placeholder="Job address, e.g. 1500 Marilla St, Dallas TX"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <button type="submit" className="cc-btn cc-btn--sm">
          Fly to
        </button>
      </form>

      <div className="cc-roofmap__stage">
        <div ref={container} className="cc-roofmap__canvas" data-testid="roof-map" />
        {!ready && !failed && (
          <div className="cc-roofmap__overlay" aria-live="polite">
            <span className="cc-mono">Initializing imagery…</span>
          </div>
        )}
        {failed && (
          <div className="cc-roofmap__overlay" role="alert">
            <span>Map could not start ({failed}). Use the manual facet table below.</span>
          </div>
        )}
        <div className="cc-roofmap__grid" aria-hidden="true" />

        <div className="cc-roofmap__tools" role="toolbar" aria-label="Map tools">
          {!drawing ? (
            <button
              type="button"
              className="cc-btn cc-btn--sm cc-btn--primary"
              onClick={startDrawing}
              disabled={!ready}
            >
              Trace facet
            </button>
          ) : (
            <>
              <button
                type="button"
                className="cc-btn cc-btn--sm cc-btn--primary"
                onClick={finish}
                disabled={vertexCount < 3}
              >
                Finish ({vertexCount})
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--sm"
                onClick={undo}
                disabled={vertexCount === 0}
              >
                Undo point
              </button>
              <button type="button" className="cc-btn cc-btn--sm" onClick={cancel}>
                Cancel
              </button>
            </>
          )}
          <button
            type="button"
            className="cc-btn cc-btn--sm"
            onClick={fit}
            disabled={!ready || facets.length === 0}
          >
            Fit roof
          </button>
          <div className="cc-seg" role="group" aria-label="Map view">
            {(['satellite', 'hybrid', 'blueprint'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={view === v ? 'cc-seg__btn cc-seg__btn--on' : 'cc-seg__btn'}
                onClick={() => setView(v)}
              >
                {v === 'satellite' ? 'Satellite' : v === 'hybrid' ? 'Hybrid' : 'Clean'}
              </button>
            ))}
          </div>
        </div>

        <div className="cc-roofmap__hud cc-mono" aria-hidden="true">
          {drawing
            ? 'DRAW · click corners · click first point or Enter to close · Esc cancels'
            : coords}
        </div>
      </div>
      {searchMsg && <p className="web-muted web-small cc-roofmap__msg">{searchMsg}</p>}
    </div>
  );
}

export const RoofMap = memo(RoofMapInner);
