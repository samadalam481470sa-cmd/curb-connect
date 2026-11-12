'use client';

// Editable aerial lawn outline. Points are deliberate user clicks/taps, not an AI property
// boundary, a survey or an automatic segmentation of vegetation.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { type Coordinate, polygonAreaSqFt } from './estimate';

const AERIAL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const DEFAULT_CENTER: [number, number] = [-96.797, 32.7767];
const GEO_EMPTY = { type: 'FeatureCollection' as const, features: [] as unknown[] };

function outlineData(points: readonly Coordinate[]) {
  const coords = points.map(p => [p.lon, p.lat]);
  const features: unknown[] = points.map((p, i) => ({
    type: 'Feature', properties: { index: i + 1 },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  }));
  if (coords.length >= 2) features.push({
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  });
  if (coords.length >= 3 && polygonAreaSqFt(points) !== null) features.push({
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
  });
  return { type: 'FeatureCollection' as const, features };
}

export function LawnSatelliteMap({
  points, onChange, onUseArea,
}: {
  points: readonly Coordinate[];
  onChange: (points: Coordinate[]) => void;
  onUseArea: (sqFt: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onChangeRef = useRef(onChange);
  const drawRef = useRef(false);
  const pointsRef = useRef(points);
  const [ready, setReady] = useState(false);
  const [draw, setDraw] = useState(false);
  const [labels, setLabels] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [mapError, setMapError] = useState('');
  const area = polygonAreaSqFt(points);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { pointsRef.current = points; }, [points]);
  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (disposed || !container.current) return;
        const first = pointsRef.current[0];
        const center: [number, number] = first ? [first.lon, first.lat] : DEFAULT_CENTER;
        map = new ml.Map({
          container: container.current, center,
          zoom: first ? 19 : 18, maxZoom: 21, pitch: 0,
          attributionControl: { compact: true },
          style: {
            version: 8,
            sources: {
              imagery: {
                type: 'raster', tiles: [AERIAL], tileSize: 256, maxzoom: 19,
                attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community',
              },
              labels: {
                type: 'raster', tiles: [LABELS], tileSize: 256,
                attribution: 'Place names © Esri',
              },
            },
            layers: [
              { id: 'imagery', type: 'raster', source: 'imagery' },
              { id: 'labels', type: 'raster', source: 'labels',
                layout: { visibility: 'none' } },
            ],
          },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          if (disposed || !map) return;
          map.addSource('lawn-outline', { type: 'geojson', data: GEO_EMPTY as never });
          map.addLayer({
            id: 'lawn-fill', type: 'fill', source: 'lawn-outline',
            filter: ['==', '$type', 'Polygon'],
            paint: { 'fill-color': '#50e3b0', 'fill-opacity': 0.18 },
          });
          map.addLayer({
            id: 'lawn-edge', type: 'line', source: 'lawn-outline',
            filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': '#21e8be', 'line-width': 3 },
          });
          map.addLayer({
            id: 'lawn-corners', type: 'circle', source: 'lawn-outline',
            filter: ['==', '$type', 'Point'],
            paint: {
              'circle-radius': 5, 'circle-color': '#e9ffed',
              'circle-stroke-color': '#03647d', 'circle-stroke-width': 2,
            },
          });
          const source = map.getSource('lawn-outline') as GeoJSONSource;
          source.setData(outlineData(pointsRef.current) as never);
          setReady(true);
        });
        map.on('click', event => {
          if (!drawRef.current || pointsRef.current.length >= 150) return;
          const next = [...pointsRef.current, {
            lon: event.lngLat.lng, lat: event.lngLat.lat,
          }];
          pointsRef.current = next;
          onChangeRef.current(next);
        });
      } catch {
        if (!disposed) setMapError('Satellite view is unavailable in this browser.');
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('lawn-outline') as GeoJSONSource | undefined;
    source?.setData(outlineData(points) as never);
  }, [points, ready]);

  const findAddress = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = search.trim();
    if (!mapRef.current || q.length < 3 || searching) return;
    setSearching(true);
    setMessage('Looking up the property…');
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw Error('Address service is currently unavailable.');
      const hits = await res.json() as { lat: string; lon: string; display_name: string }[];
      const hit = hits[0];
      const lat = Number(hit?.lat), lon = Number(hit?.lon);
      if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180)
        throw Error('No location found. Include a full street address and city.');
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 19.5, speed: 1.4 });
      setMessage(hit.display_name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Property search failed.');
    } finally {
      setSearching(false);
    }
  };
  const setDrawing = (next: boolean) => { setDraw(next); drawRef.current = next; };
  const update = (next: Coordinate[]) => { pointsRef.current = next; onChange(next); };
  return (
    <section className="cc-stack" style={{ gap: 10 }} aria-label="Satellite lawn measurement">
      <p className="web-muted web-small" style={{ margin: 0 }}>
        Trace the actual grass area on satellite imagery. Tap each corner; close your outline
        with at least three corners. Subtract buildings, paved surfaces and beds in the estimate.
        Tree cover can obscure grass, so verify the area on site.
      </p>
      <form role="search" onSubmit={findAddress}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        <label className="cc-sr-only" htmlFor="lawn-property-search">Find job address</label>
        <input id="lawn-property-search" className="cc-input"
          value={search} maxLength={160}
          placeholder="Find a lawn by street address"
          style={{ flex: '1 1 195px', minWidth: 0 }}
          onChange={e => setSearch(e.currentTarget.value)} />
        <button type="submit" className="cc-btn cc-btn--sm cc-btn--primary"
          disabled={!ready || searching || search.trim().length < 3}>
          {searching ? 'Searching…' : 'Find address'}
        </button>
      </form>
      <div style={{ height: 360, position: 'relative', borderRadius: 12,
        overflow: 'hidden', border: '1px solid #235166', background: '#102c3d' }}>
        <div ref={container} role="application" aria-label="Map for tracing lawn area"
          style={{ position: 'absolute', inset: 0, cursor: draw ? 'crosshair' : 'grab' }} />
        {!ready && (
          <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid',
            placeItems: 'center', pointerEvents: 'none',
            background: 'rgba(0,10,21,.8)', padding: 15 }}>
            {mapError || 'Loading satellite imagery…'}
          </div>
        )}
        <span style={{ position: 'absolute', left: 9, top: 9,
          background: 'rgba(0,13,28,.85)', borderRadius: 6, padding: 7,
          fontSize: 11, color: '#d7fdf1', pointerEvents: 'none' }}>
          SATELLITE · {draw ? 'TAP TO ADD LAWN CORNERS' : 'PAN AND ZOOM'}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        <button type="button" className="cc-btn cc-btn--sm cc-btn--primary" disabled={!ready}
          aria-pressed={draw} onClick={() => setDrawing(!draw)}>
          {draw ? 'Finish tracing' : 'Draw grass boundary'}
        </button>
        <button type="button" className="cc-btn cc-btn--sm" disabled={points.length === 0}
          onClick={() => update(points.slice(0, -1))}>Undo point</button>
        <button type="button" className="cc-btn cc-btn--sm" disabled={points.length === 0}
          onClick={() => { update([]); setDrawing(false); }}>Clear boundary</button>
        <button type="button" className="cc-btn cc-btn--sm" disabled={!ready}
          onClick={() => {
            const next = !labels;
            mapRef.current?.setLayoutProperty('labels', 'visibility',
              next ? 'visible' : 'none');
            setLabels(next);
          }}>{labels ? 'Hide labels' : 'Map labels'}</button>
        <button type="button" className="cc-btn cc-btn--sm"
          disabled={area === null || draw}
          onClick={() => { if (area !== null) onUseArea(area); }}>
          Use {area === null ? 'traced area' : area.toLocaleString() + ' ft²'}
        </button>
      </div>
      <p role="status" className="web-muted web-small" style={{ margin: 0 }}>
        {points.length} corners · {area !== null
          ? `Approximately ${area.toLocaleString()} ft² (${(area / 43560).toFixed(3)} acres)`
          : points.length >= 3 ? 'Invalid or self-crossing outline; undo and try again.'
            : 'Tap at least three distinct corners.'}
        {message ? ' · ' + message : ''}
      </p>
      <p className="web-muted web-small" style={{ margin: 0 }}>
        Satellite tiles © Esri and providers; property boundaries are not surveyed.
        Results depend on imagery age, zoom and visible grass.
      </p>
    </section>
  );
}
