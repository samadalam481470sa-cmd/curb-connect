'use client';

// Map-first roof tracing (RF-023). MapLibre is loaded lazily so the rest of the workspace paints
// first. Imagery is Esri World Imagery (display use, attribution shown). Map state lives here; the
// parent only receives finished facet rings, so panning and drawing never rerender the page.
import 'maplibre-gl/dist/maplibre-gl.css';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useApi } from '../../../lib/session';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { facetsGeoJson, type MapFacet, type MapFacetResult } from './facetMath';
import { cleanOutlineSegments } from './outlineMath';

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

const PointSchema=z.object({lon:z.number(),lat:z.number()});
const FootprintCandidateSchema=z.object({
  id:z.string(),label:z.string(),ring:z.array(PointSchema).min(3),
  planAreaSqFt:z.number().positive(),distanceMeters:z.number().nonnegative(),
  containsTarget:z.boolean(),sourceUrl:z.url(),
});
const FootprintResultSchema=z.object({
  status:z.enum(['found','no_footprint','upstream_unavailable']),
  provider:z.literal('openstreetmap'),message:z.string(),
  candidates:z.array(FootprintCandidateSchema),
});
type FootprintCandidate=z.infer<typeof FootprintCandidateSchema>;
const sqft=(n:number)=>Math.round(n).toLocaleString('en-US');
function suggestedGeoJson(candidate:FootprintCandidate|null){
  if(!candidate) return EMPTY;
  const coords=candidate.ring.map(pt=>[pt.lon,pt.lat]);
  return {type:'FeatureCollection' as const,features:[{
    type:'Feature' as const,properties:{source:'OpenStreetMap'},
    geometry:{type:'Polygon' as const,coordinates:[[...coords,coords[0]!]]},
  }]};
}

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
  /** Increment to zoom the map to the current facets (e.g. after loading a saved roof). */
  fitSignal?: number;
  outline?: LonLat[];
  onOutlineDrawn?: (ring: LonLat[]) => void;
  onAutoOutline?: (ring: LonLat[]) => void;
  onAutoFacet?: (ring: LonLat[]) => void;
}

function RoofMapInner({
  facets,
  results,
  selectedId,
  onSelect,
  onFacetDrawn,
  fitSignal = 0,
  outline = [],
  onOutlineDrawn,
  onAutoOutline,
  onAutoFacet,
}: RoofMapProps) {
  const {api}=useApi();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const draft = useRef<LonLat[]>([]);
  const cursor = useRef<LonLat | null>(null);
  const frame = useRef<number | null>(null);
  const drawingRef = useRef(false);
  const drawTarget = useRef<'facet' | 'outline'>('facet');
  const callbacks = useRef({ onSelect, onFacetDrawn, onOutlineDrawn,onAutoOutline,onAutoFacet });
  useEffect(() => {
    callbacks.current = { onSelect, onFacetDrawn, onOutlineDrawn,onAutoOutline,onAutoFacet };
  }, [onSelect, onFacetDrawn, onOutlineDrawn,onAutoOutline,onAutoFacet]);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawingTargetLabel, setDrawingTargetLabel] = useState<'FACET' | 'OUTLINE'>('FACET');
  const [vertexCount, setVertexCount] = useState(0);
  const [view, setView] = useState<MapView>('satellite');
  const [query, setQuery] = useState('');
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [coords, setCoords] = useState<string>('');
  const [searchBusy,setSearchBusy]=useState(false);
  const [resolvedAddress,setResolvedAddress]=useState<LonLat|null>(null);
  const searchSequence=useRef(0);
  const [findBusy,setFindBusy]=useState(false);
  const [findMessage,setFindMessage]=useState('');
  const [candidates,setCandidates]=useState<FootprintCandidate[]>([]);
  const [selectedCandidateId,setSelectedCandidateId]=useState<string|null>(null);
  const suggested=candidates.find(c=>c.id===selectedCandidateId)??null;
  const lookupSequence=useRef(0);

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
    if (ring.length >= 3) {
      if (drawTarget.current === 'outline') callbacks.current.onOutlineDrawn?.(ring.slice());
      else callbacks.current.onFacetDrawn(ring.slice());
    }
    mapRef.current?.dragPan.enable();
    mapRef.current?.touchZoomRotate.enable();
    draft.current = [];
    cursor.current = null;
    drawingRef.current = false;
    setDrawing(false);
    setVertexCount(0);
    paintDraft();
  }, [paintDraft]);

  const cancel = useCallback(() => {
    mapRef.current?.dragPan.enable();
    mapRef.current?.touchZoomRotate.enable();
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
          map.addSource('outline', { type: 'geojson', data: EMPTY as never });
          map.addSource('candidate', { type: 'geojson', data: EMPTY as never });
          map.addLayer({ id: 'house-outline', type: 'line', source: 'outline',
            paint: { 'line-color': '#85f7ff', 'line-width': 3.5, 'line-opacity': 1,
              'line-dasharray':[2,1] } });
          map.addLayer({ id:'candidate-fill',type:'fill',source:'candidate',
            paint:{'fill-color':'#fac56b','fill-opacity':0.16} });
          map.addLayer({ id:'candidate-line',type:'line',source:'candidate',
            paint:{'line-color':'#ffd37d','line-width':3.5,'line-dasharray':[2,1]} });
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

  // Explicit footprint: never infer a convex hull from overlapping roof planes.
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource('outline') as GeoJSONSource | undefined;
    const segments = cleanOutlineSegments(facets, outline);
    source?.setData(segments.length > 0 ? {
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
        geometry: { type: 'MultiLineString',
          coordinates: segments.map(segment => segment.map(p => [p.lon, p.lat])) } }],
    } as never : EMPTY as never);
  }, [ready, outline, facets]);

  // Proposed building footprint is independent OSM data, never an altered satellite tile.
  useEffect(()=>{
    if(!ready)return;
    const src=mapRef.current?.getSource('candidate') as GeoJSONSource|undefined;
    src?.setData(suggestedGeoJson(suggested) as never);
  },[ready,suggested]);

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
    // Clean temporarily reveals imagery while tracing a new outline so users can locate corners.
    const previewImagery = drawing && drawTarget.current === 'outline';
    map.setLayoutProperty('imagery', 'visibility', view === 'blueprint' && !previewImagery ? 'none' : 'visible');
    map.setLayoutProperty('labels', 'visibility', view === 'hybrid' ? 'visible' : 'none');
    for (const layer of ['facet-fill', 'facet-glow', 'facet-line']) {
      map.setLayoutProperty(layer, 'visibility', view === 'blueprint' ? 'none' : 'visible');
    }
    map.setLayoutProperty('house-outline', 'visibility',
      (view === 'blueprint' || outline.length >= 3) ? 'visible' : 'none');
  }, [ready, view, drawing, outline.length]);

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

  const startDrawing = (target: 'facet' | 'outline') => {
    setCandidates([]);
    setSelectedCandidateId(null);
    setFindMessage('');
    drawTarget.current = target;
    setDrawingTargetLabel(target === 'outline' ? 'OUTLINE' : 'FACET');
    // Disable map pan during a tap-to-place drawing on touch screens.
    mapRef.current?.dragPan.disable();
    mapRef.current?.touchZoomRotate.disable();
    draft.current = [];
    drawingRef.current = true;
    setDrawing(true);
    setVertexCount(0);
    callbacks.current.onSelect(null);
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !mapRef.current) {setSearchMsg('Enter a complete job address first.');return;}
    const seq=++searchSequence.current;
    setSearchBusy(true);
    setResolvedAddress(null);
    setCandidates([]);setSelectedCandidateId(null);setFindMessage('');
    setSearchMsg('Searching address…');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' },cache:'no-store' });
      if(!res.ok)throw Error('Address lookup unavailable');
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if(seq!==searchSequence.current)return;
      const hit = data[0];
      if (!hit || !Number.isFinite(Number(hit.lon)) || !Number.isFinite(Number(hit.lat))) {
        setSearchMsg('No match. Try a complete street address and city.');
        return;
      }
      const location={lon:Number(hit.lon),lat:Number(hit.lat)};
      setResolvedAddress(location);
      mapRef.current?.flyTo({ center:[location.lon,location.lat], zoom:19.5,speed:1.6 });
      setSearchMsg(hit.display_name+' · address located');
    } catch {
      if(seq===searchSequence.current)
        setSearchMsg('Address search unavailable. You can still trace the roof manually.');
    } finally {
      if(seq===searchSequence.current)setSearchBusy(false);
    }
  };

  const findUnderTrees=async()=>{
    if(!resolvedAddress){
      setFindMessage('Fly to a complete street address first so the correct building is selected.');
      return;
    }
    const seq=++lookupSequence.current;
    setFindBusy(true);
    setFindMessage('Checking independent mapped building outlines near the address…');
    setCandidates([]);setSelectedCandidateId(null);
    try{
      const result=await api.post('/v1/imagery/roof-footprint',{
        lat:resolvedAddress.lat,lon:resolvedAddress.lon,
      },{schema:FootprintResultSchema});
      if(seq!==lookupSequence.current)return;
      setCandidates(result.candidates);
      setSelectedCandidateId(result.candidates[0]?.id??null);
      setFindMessage(result.message);
    }catch{
      if(seq===lookupSequence.current)
        setFindMessage('Building lookup failed. Use Trace house outline or Trace facet instead.');
    }finally{
      if(seq===lookupSequence.current)setFindBusy(false);
    }
  };

  const focusCandidate=(candidate:FootprintCandidate)=>{
    setSelectedCandidateId(candidate.id);
    const map=mapRef.current;
    if(!map)return;
    const lons=candidate.ring.map(p=>p.lon);
    const lats=candidate.ring.map(p=>p.lat);
    map.fitBounds([[Math.min(...lons),Math.min(...lats)],
      [Math.max(...lons),Math.max(...lats)]],{padding:70,maxZoom:20,duration:500});
  };
  const applyOutline=()=>{
    if(!suggested)return;
    callbacks.current.onAutoOutline?.(suggested.ring.slice());
    setView('blueprint');
    setFindMessage('Mapped building outline displayed without satellite tree imagery. Confirm the shape and eaves on site.');
  };
  const applyPlanFacet=()=>{
    if(!suggested || facets.length>0)return;
    callbacks.current.onAutoOutline?.(suggested.ring.slice());
    callbacks.current.onAutoFacet?.(suggested.ring.slice());
    setView('blueprint');
    setFindMessage('One provisional roof area added from the building footprint. Enter actual pitch below; split complex roof planes before quoting.');
  };

  // Fit to the drawn facets.
  const fit = useCallback(() => {
    const map = mapRef.current;
    const pts = view === 'blueprint' && outline.length >= 3 ? outline : facets.flatMap((f) => f.ring);
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
  }, [facets, outline, view]);

  useEffect(() => {
    if (ready && fitSignal > 0) fit();
    // Only an explicit signal fits; ordinary facet edits must not move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitSignal]);

  return (
    <div className="cc-roofmap">
      <form className="cc-roofmap__search" onSubmit={search} role="search">
        <input
          className="cc-input"
          aria-label="Job address"
          placeholder="Job address, e.g. 1500 Marilla St, Dallas TX"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            searchSequence.current+=1;
            lookupSequence.current+=1;
            setSearchBusy(false);setFindBusy(false);
            setResolvedAddress(null);setCandidates([]);setSelectedCandidateId(null);
            setFindMessage('');setSearchMsg(null);
          }}
        />
        <button type="submit" className="cc-btn cc-btn--sm" disabled={searchBusy||!ready||!query.trim()}>
          {searchBusy?'Locating…':'Fly to'}
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
        {view !== 'blueprint' && <div className="cc-roofmap__grid" aria-hidden="true" />}

        <div className="cc-roofmap__tools" role="toolbar" aria-label="Map tools">
          {!drawing ? (
            <>
            <button
              type="button"
              className="cc-btn cc-btn--sm cc-btn--primary"
              onClick={() => startDrawing(view === 'blueprint' ? 'outline' : 'facet')}
              disabled={!ready}
            >
              {view === 'blueprint' ? 'Trace outline' : 'Trace facet'}
            </button>
            {view !== 'blueprint' && <button type="button" className="cc-btn cc-btn--sm"
              disabled={!ready} onClick={() => startDrawing('outline')}>
              Trace house outline
            </button>}
            </>
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
            disabled={!ready || (facets.length === 0 && outline.length === 0)}
          >
            Fit roof
          </button>
          {!drawing && <button type="button" className="cc-btn cc-btn--sm"
            disabled={!ready||!resolvedAddress||findBusy}
            onClick={()=>void findUnderTrees()}>
            {findBusy?'Finding roof…':'Find roof under trees'}
          </button>}
          <div className="cc-seg" role="group" aria-label="Map view">
            {(['satellite', 'hybrid', 'blueprint'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={view === v ? 'cc-seg__btn cc-seg__btn--on' : 'cc-seg__btn'}
                onClick={() => {
                  if (drawing) cancel();
                  setView(v);
                }}
              >
                {v === 'satellite' ? 'Satellite' : v === 'hybrid' ? 'Hybrid' : 'Clean'}
              </button>
            ))}
          </div>
        </div>

        <div className="cc-roofmap__hud cc-mono" aria-hidden="true">
          {drawing
            ? `DRAW ${drawingTargetLabel} · tap corners · Finish to close`
            : view === 'blueprint' && outline.length < 3
              ? 'CLEAN · showing the combined traced facet edge; tap Trace outline to correct'
              : coords}
        </div>
      </div>
      <section className="cc-roofmap__auto" aria-label="Tree-obscured roof assistance">
        <p className="web-muted web-small">
          Trees blocking the roof? Search the address, then choose <strong>Find roof under trees</strong>.
          This retrieves independent OpenStreetMap building footprints, not a tree-erased Google photo.
        </p>
        {findMessage && <p role="status" className="web-muted web-small">{findMessage}</p>}
        {candidates.length>0&&<>
          <div className="cc-roofmap__candidates" role="group" aria-label="Nearby mapped buildings">
            {candidates.map(c=><button type="button" className="cc-btn cc-btn--sm"
              key={c.id} aria-pressed={selectedCandidateId===c.id}
              onClick={()=>focusCandidate(c)}>
              {c.containsTarget?'At address':'Nearby'} · {sqft(c.planAreaSqFt)} ft² · {c.distanceMeters} m
            </button>)}
          </div>
          {suggested&&<div className="cc-roofmap__choice">
            <p className="web-muted web-small">
              <strong>{suggested.label}</strong> · approx. {sqft(suggested.planAreaSqFt)} ft² building ground area.
              Roof overhangs and slopes are not yet included.
            </p>
            <div className="cc-roofmap__choice-actions">
              <button type="button" className="cc-btn cc-btn--sm cc-btn--primary" onClick={applyOutline}>
                Show clean tree-free outline
              </button>
              <button type="button" className="cc-btn cc-btn--sm"
                disabled={facets.length>0} onClick={applyPlanFacet}>
                Auto-calculate roof plan size
              </button>
              <button type="button" className="cc-btn cc-btn--sm"
                onClick={()=>{setCandidates([]);setSelectedCandidateId(null);setFindMessage('Candidate discarded.');}}>
                Discard suggestion
              </button>
            </div>
            {facets.length>0 && <p className="web-muted web-small" role="status">
              Existing facets are protected. Remove them before using a single building footprint as a roof proxy,
              or use Show clean tree-free outline only.
            </p>}
            <a className="web-muted web-small" href={suggested.sourceUrl}
              rel="noopener noreferrer" target="_blank">Mapped building source © OpenStreetMap contributors (ODbL)</a>
          </div>}
        </>}
        <p className="web-muted web-small">A building footprint is not a measured roof. Verify correct address,
          missing eaves, ridge lines, pitch, levels and visible obstructions. No unseen roof pixels are fabricated.</p>
      </section>
      {view === 'blueprint' && <p className="web-muted web-small" role="status">
        Clean shows only your separately traced building footprint—not roof facet seams.
        {outline.length < 3 ? ' The preview is derived from your traced facets; trace the footprint against satellite imagery to confirm it.' : ' The selected mapped or manually traced outline is displayed; verify it against the site.'}
      </p>}
      {searchMsg && <p className="web-muted web-small cc-roofmap__msg">{searchMsg}</p>}
    </div>
  );
}

export const RoofMap = memo(RoofMapInner);
