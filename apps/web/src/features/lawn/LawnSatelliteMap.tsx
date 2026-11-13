'use client';

// Multi-zone satellite measurement. Real Esri imagery + user-traced polygons,
// never claimed to be automated grass detection, a survey or cadastral boundaries.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import { polygonAreaSqFt } from './estimate';
import {
  measureLawnRegions, nudgeCoordinate, type LawnRegion,
} from './mapGeometry';

const AERIAL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
type MarkerConstructor = new (options: { element: HTMLElement; draggable: boolean }) => Marker;
const START: [number, number] = [-96.797, 32.7767];
const EMPTY = { type: 'FeatureCollection', features: [] };

function regionGeoJSON(regions: readonly LawnRegion[]) {
  const features: object[] = [];
  for (const region of regions) {
    const coords = region.points.map(p => [p.lon, p.lat]);
    const props = { id: region.id, kind: region.kind, name: region.name };
    if (coords.length >= 2) features.push({
      type: 'Feature', properties: props,
      geometry: { type: 'LineString', coordinates: [...coords, ...(coords.length >= 3 ? [coords[0]] : [])] },
    });
    if (coords.length >= 3 && polygonAreaSqFt(region.points) !== null) {
      features.push({
        type: 'Feature', properties: props,
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function LawnSatelliteMap({
  regions, onChange, onUseArea, address, onAddressSelected,
}: {
  regions: readonly LawnRegion[];
  onChange: (next: LawnRegion[]) => void;
  onUseArea: (grossSqFt: number, excludedSqFt: number) => void;
  address: string;
  onAddressSelected: (address: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker[]>([]);
  const markerCtor = useRef<MarkerConstructor | null>(null);
  const regionsRef = useRef(regions);
  const onChangeRef = useRef(onChange);
  const selectedIdRef = useRef('');
  const drawRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [draw, setDraw] = useState(false);
  const [corner, setCorner] = useState(0);
  const [nudgeFeet, setNudgeFeet] = useState(1);
  const [labels, setLabels] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [mapError, setMapError] = useState('');

  const active = regions.find(r => r.id === selectedId) ?? regions[0];
  const measurement = measureLawnRegions(regions);
  const canUse = ready && !draw && measurement.valid && measurement.netSqFt !== null;
  const select = (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setCorner(0);
    drawRef.current = false;
    setDraw(false);
  };
  const drawing = (enabled: boolean) => { drawRef.current = enabled; setDraw(enabled); };
  const modify = (next: LawnRegion[]) => { regionsRef.current = next; onChangeRef.current(next); };

  useEffect(() => { regionsRef.current = regions; }, [regions]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { selectedIdRef.current = active?.id ?? ''; }, [active?.id]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (disposed || !container.current) return;
        markerCtor.current = ml.Marker;
        const first = regionsRef.current.flatMap(x => x.points)[0];
        map = new ml.Map({
          container: container.current,
          center: first ? [first.lon, first.lat] : START,
          zoom: first ? 19 : 18, minZoom: 3, maxZoom: 21,
          pitch: 0, attributionControl: { compact: true },
          style: {
            version: 8,
            sources: {
              aerial: { type: 'raster', tiles: [AERIAL], tileSize: 256, maxzoom: 19,
                attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community' },
              labels: { type: 'raster', tiles: [LABELS], tileSize: 256,
                attribution: 'Reference labels © Esri' },
            },
            layers: [
              { id: 'aerial', type: 'raster', source: 'aerial' },
              { id: 'labels', type: 'raster', source: 'labels',
                layout: { visibility: 'none' } },
            ],
          },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          if (disposed || !map) return;
          map.addSource('lawn-regions', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'lawn-fills', type: 'fill', source: 'lawn-regions',
            filter: ['==', '$type', 'Polygon'],
            paint: {
              'fill-color': ['match', ['get', 'kind'], 'exclude', '#f59d38', '#21e7ab'],
              'fill-opacity': 0.23,
            },
          });
          map.addLayer({
            id: 'lawn-borders', type: 'line', source: 'lawn-regions',
            filter: ['==', '$type', 'LineString'],
            paint: {
              'line-color': ['match', ['get', 'kind'], 'exclude', '#ffab43', '#3bf7c3'],
              'line-width': 3,
            },
          });
          (map.getSource('lawn-regions') as GeoJSONSource).setData(
            regionGeoJSON(regionsRef.current) as never);
          setReady(true);
        });
        map.on('click', event => {
          if (!drawRef.current) return;
          const id = selectedIdRef.current;
          const all = regionsRef.current;
          const idx = all.findIndex(x => x.id === id);
          if (idx < 0 || all[idx]!.points.length >= 150) return;
          const next = all.map((x, i) => i === idx ? {
            ...x, points: [...x.points, { lat: event.lngLat.lat, lon: event.lngLat.lng }],
          } : x);
          modify(next);
        });
      } catch {
        if (!disposed) setMapError('Interactive aerial map is unavailable on this device.');
      }
    })();
    return () => {
      disposed = true;
      markerRef.current.forEach(marker => marker.remove());
      markerRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('lawn-regions') as GeoJSONSource | undefined)?.setData(
      regionGeoJSON(regions) as never);
    markerRef.current.forEach(marker => marker.remove());
    markerRef.current = [];
    const MarkerClass = markerCtor.current;
    if (!MarkerClass || !active) return;
    for (let i = 0; i < active.points.length; i++) {
      const point = active.points[i]!;
      const el = document.createElement('button');
      el.type = 'button';
      el.title = 'Edit corner ' + (i + 1);
      el.setAttribute('aria-label', 'Select or drag corner ' + (i + 1));
      el.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid #092b3a;' +
        'background:' + (i === corner ? '#fff' : '#73f4cd') +
        ';color:#08202a;font-size:9px;font-weight:700;box-shadow:0 0 5px #07111f;cursor:move;';
      el.textContent = String(i + 1);
      el.addEventListener('click', e => { e.stopPropagation(); setCorner(i); });
      const marker = new MarkerClass({ element: el, draggable: !draw })
        .setLngLat([point.lon, point.lat]).addTo(map);
      marker.on('dragend', () => {
        const loc = marker.getLngLat();
        const next = regionsRef.current.map(region => region.id === active.id ? {
          ...region,
          points: region.points.map((p, index) =>
            index === i ? { lat: loc.lat, lon: loc.lng } : p),
        } : region);
        modify(next);
        setCorner(i);
      });
      markerRef.current.push(marker);
    }
  }, [regions, active, ready, draw, corner]);

  const add = (kind: LawnRegion['kind']) => {
    if (regions.length >= 24) { setMessage('Maximum of 24 lawn and exclusion zones.'); return; }
    if (kind === 'exclude' && measurement.lawnZones === 0) {
      setMessage('Draw and finish a lawn zone before adding exclusions.');
      return;
    }
    const region: LawnRegion = {
      id: 'zone-' + crypto.randomUUID(), kind,
      name: kind === 'grass' ? 'Lawn ' + (regions.filter(r => r.kind === 'grass').length + 1) :
        'Non-mowable area ' + (regions.filter(r => r.kind === 'exclude').length + 1),
      points: [],
    };
    modify([...regions, region]);
    select(region.id);
    drawing(true);
    setMessage('Tap around the ' + (kind === 'grass' ? 'grass' : 'driveway, bed or building') +
      ' edge; then select Finish drawing.');
  };
  const findAddress = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = search.trim() || address.trim();
    if (!mapRef.current || q.length < 3 || searching) return;
    setSearching(true);
    setMessage('Looking for property…');
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw Error('Address search is temporarily unavailable.');
      const hits = await res.json() as { lat: string; lon: string; display_name: string }[];
      const hit = hits[0];
      const lat = Number(hit?.lat), lon = Number(hit?.lon);
      if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180)
        throw Error('Address not found. Include the street, city and state.');
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 19, speed: 1.4 });
      onAddressSelected(hit.display_name);
      setSearch(hit.display_name);
      setMessage('Located ' + hit.display_name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Address lookup failed.');
    } finally {
      setSearching(false);
    }
  };
  const nudge = (direction: 'north' | 'south' | 'east' | 'west') => {
    if (!active?.points[corner]) return;
    modify(regions.map(region => region.id === active.id ? {
      ...region,
      points: region.points.map((p, index) =>
        index === corner ? nudgeCoordinate(p, direction, nudgeFeet) : p),
    } : region));
  };
  const undo = () => {
    if (!active?.points.length) return;
    modify(regions.map(r => r.id === active.id ?
      { ...r, points: r.points.slice(0, -1) } : r));
    setCorner(Math.max(0, active.points.length - 2));
  };
  const remove = () => {
    if (!active || !window.confirm('Delete ' + active.name + ' from the saved measurement?')) return;
    modify(regions.filter(r => r.id !== active.id));
    select('');
  };
  const fit = () => {
    const map = mapRef.current;
    if (!map) return;
    const all = regions.flatMap(r => r.points);
    if (!all.length) return;
    const west = Math.min(...all.map(p => p.lon)), east = Math.max(...all.map(p => p.lon));
    const south = Math.min(...all.map(p => p.lat)), north = Math.max(...all.map(p => p.lat));
    map.fitBounds([[west, south], [east, north]], { padding: 50, maxZoom: 20 });
  };
  return (
    <section className="cc-stack" style={{ gap: 10 }} aria-label="Precise satellite lawn measurement">
      <p className="web-muted web-small" style={{ margin: 0 }}>
        Trace <strong>front, back and side lawns separately</strong>. Mark patios, flowerbeds,
        pools and buildings as <strong>orange exclusions</strong>. Finish each polygon before
        starting another. The app rejects overlapping areas that would distort your quote.
      </p>
      <form role="search" onSubmit={findAddress}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        <label className="cc-sr-only" htmlFor="lawn-property-search">Job property address</label>
        <input id="lawn-property-search" className="cc-input"
          value={search} maxLength={180} placeholder={address || 'Street address, city, state'}
          style={{ flex: '1 1 195px', minWidth: 0 }}
          onChange={e => setSearch(e.currentTarget.value)} />
        <button className="cc-btn cc-btn--sm cc-btn--primary" type="submit"
          disabled={!ready || searching || (search.trim() || address.trim()).length < 3}>
          {searching ? 'Locating…' : 'Go to property'}
        </button>
      </form>
      <div style={{ position: 'relative', height: 390, overflow: 'hidden',
        border: '1px solid #275a6d', borderRadius: 12, background: '#081b28' }}>
        <div ref={container} role="application"
          aria-label="Interactive satellite map. Trace grass polygons and drag numbered corners."
          style={{ position: 'absolute', inset: 0,
            cursor: draw ? 'crosshair' : 'grab' }} />
        {!ready && <div role="status" style={{ position: 'absolute', inset: 0,
          display: 'grid', placeItems: 'center', padding: 12,
          background: 'rgba(4,14,24,.8)', pointerEvents: 'none' }}>
          {mapError || 'Loading satellite imagery…'}
        </div>}
        <div style={{ position: 'absolute', top: 9, left: 9,
          background: 'rgba(0,15,24,.88)', color: '#e8fff8',
          borderRadius: 8, padding: '6px 9px', fontSize: 11, pointerEvents: 'none' }}>
          {draw ? 'TAP TO PLACE CORNERS · FINISH WHEN DONE' : 'SATELLITE · PAN, ZOOM, DRAG CORNERS'}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="cc-btn cc-btn--sm cc-btn--primary"
          disabled={!ready || regions.length >= 24 || draw}
          onClick={() => add('grass')}>+ Draw grass zone</button>
        <button type="button" className="cc-btn cc-btn--sm"
          disabled={!ready || regions.length >= 24 || draw || measurement.lawnZones === 0}
          onClick={() => add('exclude')}>+ Exclude driveway / bed</button>
        {draw && <button className="cc-btn cc-btn--sm cc-btn--primary"
          type="button" onClick={() => drawing(false)}>Finish drawing</button>}
        <button type="button" className="cc-btn cc-btn--sm" disabled={!ready}
          onClick={fit}>Fit all zones</button>
        <button type="button" className="cc-btn cc-btn--sm" disabled={!ready}
          onClick={() => { const next = !labels;
            mapRef.current?.setLayoutProperty('labels','visibility',next?'visible':'none');
            setLabels(next); }}>{labels ? 'Hide labels' : 'Show labels'}</button>
      </div>
      {regions.length > 0 && (
        <div className="cc-callout" style={{ display: 'grid', gap: 8 }}>
          <label className="cc-field">
            <span>Choose an outline to edit ({regions.length} shapes)</span>
            <select className="cc-input" value={active?.id ?? ''}
              onChange={e => select(e.currentTarget.value)}>
              {regions.map(r => <option key={r.id} value={r.id}>
                {r.kind === 'grass' ? 'Grass · ' : 'Exclude · '}{r.name}
                {' (' + r.points.length + ' corners)'}
              </option>)}
            </select>
          </label>
          {active && <>
            <label className="cc-field">
              <span>Outline name</span>
              <input className="cc-input" value={active.name} maxLength={90}
                onChange={e => modify(regions.map(r => r.id === active.id
                  ? { ...r, name: e.target.value } : r))} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="cc-btn cc-btn--sm" type="button"
                disabled={active.points.length === 0} onClick={undo}>Undo corner</button>
              <button className="cc-btn cc-btn--sm" type="button"
                disabled={draw} onClick={() => drawing(true)}>Add corners</button>
              <button className="cc-btn cc-btn--sm" type="button"
                onClick={remove}>Delete outline</button>
            </div>
            {!draw && active.points.length > 0 && <div className="cc-stack" style={{ gap: 8 }}>
              <p className="web-muted web-small" style={{ margin: 0 }}>
                For fine correction, drag a numbered corner on the map or select it below.
                Nudge by exact ground-distance steps; this improves your placement control,
                not the underlying satellite-image accuracy.
              </p>
              <div className="cc-form-grid">
                <label className="cc-field"><span>Corner</span>
                  <select className="cc-input" value={Math.min(corner,active.points.length-1)}
                    onChange={e => setCorner(Number(e.target.value))}>
                    {active.points.map((p,i) => <option key={i} value={i}>
                      Corner {i + 1} · {p.lat.toFixed(6)}, {p.lon.toFixed(6)}
                    </option>)}
                  </select>
                </label>
                <label className="cc-field"><span>Nudge step</span>
                  <select className="cc-input" value={nudgeFeet}
                    onChange={e => setNudgeFeet(Number(e.target.value))}>
                    <option value={0.5}>0.5 foot</option>
                    <option value={1}>1 foot</option>
                    <option value={5}>5 feet</option>
                  </select>
                </label>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                {(['north','west','east','south'] as const).map(dir =>
                  <button className="cc-btn cc-btn--sm" key={dir} type="button"
                    onClick={() => nudge(dir)}>
                    {dir === 'north' ? '↑' : dir === 'south' ? '↓' : dir === 'east' ? '→' : '←'}
                    {' ' + dir}
                  </button>)}
              </div>
            </div>}
          </>}
        </div>
      )}
      <div className="cc-callout" role="status" aria-live="polite">
        <strong>{measurement.netSqFt === null ? 'Measure needs correction' :
          measurement.netSqFt.toLocaleString() + ' ft² estimated mowable grass'}</strong>
        <div className="web-muted web-small">
          {measurement.lawnZones} grass zones · {measurement.exclusions} exclusions
          {' · '}Gross {measurement.grossSqFt.toLocaleString()} ft²
          {' · '}Excluded {measurement.excludedSqFt.toLocaleString()} ft²
          {' · '}Grass perimeter ≈ {measurement.grassPerimeterFt.toLocaleString()} ft
        </div>
        {measurement.issues.length > 0 &&
          <ul>{measurement.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul>}
        <button type="button" className="cc-btn cc-btn--primary"
          disabled={!canUse} onClick={() =>
            onUseArea(measurement.grossSqFt, measurement.excludedSqFt)}>
          Use mapped square footage in quote
        </button>
      </div>
      {message && <p className="web-muted web-small" role="status">{message}</p>}
      <p className="web-muted web-small" style={{ margin: 0 }}>
        Esri satellite imagery is not a boundary survey. Trees, shadows, elevation,
        map georeferencing and source image resolution introduce uncertainty;
        beyond source zoom 19, enlarging tiles does not add real image detail.
        Confirm dimensions on site before binding pricing or buying materials.
      </p>
    </section>
  );
}
