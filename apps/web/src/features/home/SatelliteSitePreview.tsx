'use client';

// Actual georeferenced aerial imagery, not a decorative 3D illustration.
// Reuses the same licensed-attribution raster provider and MapLibre engine as Roof Measurements.
// Google photorealistic 3D Tiles require a separate Google Maps Platform key and billing;
// this map does not fetch or scrape Google 3D geometry.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { earthSearchUrl, googleSatelliteUrl, validCoordinates } from './satelliteLinks';

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const START: [number, number] = [-96.797, 32.7767];

export function SatelliteSitePreview() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [place, setPlace] = useState('Dallas example — search a job address');
  const [center, setCenter] = useState({ lat: START[1], lon: START[0] });
  const [labels, setLabels] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (disposed || !container.current) return;
        map = new ml.Map({
          container: container.current,
          center: START,
          zoom: 18,
          minZoom: 2,
          maxZoom: 20,
          pitch: 0,
          attributionControl: { compact: true },
          style: {
            version: 8,
            sources: {
              aerial: {
                type: 'raster', tiles: [IMAGERY], tileSize: 256,
                attribution: ATTRIBUTION,
                maxzoom: 19,
              },
              places: {
                type: 'raster', tiles: [LABELS], tileSize: 256,
                attribution: 'Reference labels © Esri',
              },
            },
            layers: [
              { id: 'aerial', type: 'raster', source: 'aerial' },
              { id: 'places', type: 'raster', source: 'places', layout: { visibility: 'none' } },
            ],
          },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ showCompass: true }), 'top-right');
        map.on('load', () => { if (!disposed) setStatus('ready'); });
        map.on('moveend', () => {
          if (!disposed && map) {
            const p = map.getCenter();
            setCenter({ lat: p.lat, lon: p.lng });
          }
        });
        map.on('error', (event) => {
          if (!disposed && map && !map.isStyleLoaded()) {
            setError(event.error?.message ?? 'Imagery could not load.');
          }
        });
      } catch {
        if (!disposed) {
          setStatus('error');
          setError('This browser cannot initialize the satellite viewer.');
        }
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  const search = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = searchText.trim();
    if (q.length < 3 || !mapRef.current || searching) return;
    setSearching(true);
    setError('');
    try {
      // Intentionally user-initiated only; do not use public geocoder for background bulk searches.
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw Error('Address search is temporarily unavailable.');
      const result = await res.json() as { lat?: string; lon?: string; display_name?: string }[];
      const match = result[0];
      const lat = Number(match?.lat), lon = Number(match?.lon);
      if (!match || !validCoordinates(lat, lon)) throw Error('No matching address. Try a full street address and city.');
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 19, speed: 1.4 });
      setCenter({ lat, lon });
      setPlace(match.display_name ?? q);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Address lookup failed.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <section aria-label="Real satellite imagery of a construction property" style={{ minWidth: 0 }}>
      <form onSubmit={search} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 9 }}>
        <label htmlFor="site-satellite-address" className="cc-sr-only">Property street address</label>
        <input
          id="site-satellite-address" className="cc-input"
          style={{ flex: '1 1 190px', minWidth: 0 }}
          placeholder="Enter a job address, city and state"
          value={searchText}
          maxLength={180}
          onChange={e => setSearchText(e.currentTarget.value)}
        />
        <button type="submit" className="cc-btn cc-btn--sm cc-btn--primary"
          disabled={searching || status !== 'ready' || searchText.trim().length < 3}>
          {searching ? 'Locating…' : 'Show satellite'}
        </button>
      </form>
      <div style={{ position: 'relative', minHeight: 310, width: '100%',
        border: '1px solid #1e526a', borderRadius: 12, overflow: 'hidden', background: '#091624' }}>
        <div ref={container} role="application" aria-label="Interactive aerial property map, pan and zoom"
          style={{ position: 'absolute', inset: 0 }} />
        {status !== 'ready' && (
          <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid',
            placeItems: 'center', background: 'rgba(7,15,27,.8)', padding: 16, textAlign: 'center',
            pointerEvents: 'none' }}>
            {status === 'loading' ? 'Loading real aerial imagery…' : 'Satellite imagery unavailable in this browser.'}
          </div>
        )}
        <span style={{ position: 'absolute', left: 9, top: 9, zIndex: 1,
          padding: '5px 8px', background: 'rgba(0,12,23,.8)', borderRadius: 6,
          fontSize: 11, color: '#d6eef7', pointerEvents: 'none' }}>
          SATELLITE · REAL WORLD IMAGERY
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        marginTop: 9 }}>
        <button type="button" className="cc-btn cc-btn--sm"
          aria-pressed={labels} disabled={status !== 'ready'}
          onClick={() => {
            const next = !labels;
            mapRef.current?.setLayoutProperty('places', 'visibility', next ? 'visible' : 'none');
            setLabels(next);
          }}>{labels ? 'Hide map labels' : 'Show map labels'}</button>
        <a className="cc-btn cc-btn--sm" target="_blank" rel="noopener noreferrer"
          href={googleSatelliteUrl(center.lat, center.lon)}>Google Maps satellite</a>
        <a className="cc-btn cc-btn--sm" target="_blank" rel="noopener noreferrer"
          href={earthSearchUrl(place.includes('example') ? searchText : place, center.lat, center.lon)}>
          Google Earth · 3D where available
        </a>
      </div>
      <p className="web-muted web-small" style={{ margin: '8px 0 0' }}>
        {place}. Imagery shows aerial roofs, trees and surroundings where covered; capture date and
        resolution vary. This is not a survey or depth measurement. Google 3D opens separately;
        licensed in-app Google 3D tiles require Google Maps Platform billing.
      </p>
      {error && <p role="alert" className="web-muted web-small">{error}</p>}
    </section>
  );
}
