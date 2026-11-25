'use client';

// Hailstorm map: NOAA hail reports as markers over the same Esri World Imagery
// satellite base the roof tracer uses (see ../map/RoofMap.tsx), plus the hail
// swath — the exact hail path as polygons drawn over the satellite imagery, so
// the path shows directly over the houses visible on the map. MapLibre is
// loaded lazily; markers are one GeoJSON point source, sized by hail magnitude.
// The parent owns the event list and the selection — this component only shows
// the map and reports which event was picked. The swath comes from
// /v1/roof-storms/swath (days=1); a measured MRMS swath renders solid, an
// approximate path from storm reports renders dashed and tagged as approximate.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useApi } from '../../../lib/session';
import { SwathSchema, type HailEvent, type Swath } from './api';
import { swathBounds } from './swath';

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIB =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const DEFAULT_CENTER: [number, number] = [-96.797, 32.7767];
const EMPTY = { type: 'FeatureCollection' as const, features: [] as unknown[] };

function hailGeoJson(events: readonly HailEvent[]) {
  return {
    type: 'FeatureCollection' as const,
    features: events.map((e) => ({
      type: 'Feature' as const,
      properties: { id: e.id, mag: e.magnitudeIn },
      geometry: { type: 'Point' as const, coordinates: [e.lon, e.lat] },
    })),
  };
}

export interface HailStormMapProps {
  events: readonly HailEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function HailStormMapInner({ events, selectedId, onSelect }: HailStormMapProps) {
  const { api } = useApi();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const callbacks = useRef({ onSelect });
  useEffect(() => {
    callbacks.current = { onSelect };
  }, [onSelect]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // The hail swath for the last day: the exact hail path as polygons, drawn
  // over the satellite imagery. Fetched here so the map owns its own layer.
  const swathQuery = useQuery({
    queryKey: ['roof-storm-swath', 1],
    queryFn: () =>
      api.get('/v1/roof-storms/swath', { schema: SwathSchema, query: { days: 1 } }),
    staleTime: 60_000,
    retry: false,
  });
  const swath: Swath | null = swathQuery.data ?? null;
  const hasSwath =
    swath?.status === 'ok' && swath.swath.features.length > 0;
  const isApproximate = swath?.kind === 'approximate_path';

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
          zoom: 5,
          maxZoom: 18,
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
              { id: 'labels', type: 'raster', source: 'labels' },
            ],
          },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ visualizePitch: false }), 'top-right');
        map.addControl(new ml.ScaleControl({ unit: 'imperial' }), 'bottom-left');
        map.on('load', () => {
          if (!map) return;
          // Swath first, so the hail-point markers draw on top of it.
          map.addSource('swath', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'swath-fill',
            type: 'fill',
            source: 'swath',
            paint: {
              'fill-color': '#f97316',
              'fill-opacity': 0.35,
            },
          });
          map.addLayer({
            id: 'swath-line',
            type: 'line',
            source: 'swath',
            paint: {
              'line-color': '#f97316',
              'line-width': 2,
            },
          });
          map.addLayer({
            id: 'swath-line-dashed',
            type: 'line',
            source: 'swath',
            paint: {
              'line-color': '#f97316',
              'line-width': 2,
              'line-dasharray': [2, 2],
            },
          });
          map.addSource('hail', { type: 'geojson', data: EMPTY as never });
          map.addLayer({
            id: 'hail-points',
            type: 'circle',
            source: 'hail',
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 0.5, 7, 1, 10, 2, 14, 3, 18],
              'circle-color': '#f97316',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
              'circle-opacity': 0.9,
            },
          });
          setReady(true);
        });
        map.on('click', 'hail-points', (e) => {
          const hit = e.features?.[0];
          const id = hit?.properties?.id;
          if (typeof id === 'string') callbacks.current.onSelect(id);
        });
        map.on('mouseenter', 'hail-points', () => {
          if (map) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'hail-points', () => {
          if (map) map.getCanvas().style.cursor = '';
        });
      } catch (err) {
        if (!disposed) setFailed(err instanceof Error ? err.message : 'Map failed to load');
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource('hail') as GeoJSONSource | undefined;
    src?.setData(hailGeoJson(events) as never);
  }, [ready, events]);

  // Swath layer: measured MRMS swath = solid fill + solid outline; approximate
  // path = lighter fill + dashed outline (two line layers, one visible at a
  // time). No swath means no layers drawn.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('swath') as GeoJSONSource | undefined;
    src?.setData((hasSwath ? swath!.swath : EMPTY) as never);
    map.setPaintProperty('swath-fill', 'fill-opacity', isApproximate ? 0.15 : 0.35);
    map.setLayoutProperty('swath-line', 'visibility', isApproximate ? 'none' : 'visible');
    map.setLayoutProperty(
      'swath-line-dashed',
      'visibility',
      isApproximate ? 'visible' : 'none',
    );
  }, [ready, swath, hasSwath, isApproximate]);

  useEffect(() => {
    if (!ready || !selectedId) return;
    const event = events.find((e) => e.id === selectedId);
    if (!event) return;
    mapRef.current?.flyTo({ center: [event.lon, event.lat], zoom: 9, speed: 1.4 });
  }, [ready, selectedId, events]);

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = swathBounds(hasSwath ? swath!.swath : null);
    const lons = events.map((e) => e.lon);
    const lats = events.map((e) => e.lat);
    if (bounds) {
      lons.push(bounds[0][0], bounds[1][0]);
      lats.push(bounds[0][1], bounds[1][1]);
    }
    if (lons.length === 0) return;
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 9, duration: 600 },
    );
  };

  return (
    <div className="cc-roofmap">
      <div className="cc-roofmap__stage">
        <div ref={container} className="cc-roofmap__canvas" data-testid="hail-storm-map" aria-label="Hailstorm map" role="application" />
        {!ready && !failed && (
          <div className="cc-roofmap__overlay" aria-live="polite">
            <span className="cc-mono">Initializing imagery…</span>
          </div>
        )}
        {failed && (
          <div className="cc-roofmap__overlay" role="alert">
            <span>Map could not start ({failed}). The event list below still works.</span>
          </div>
        )}
        <div className="cc-roofmap__tools" role="toolbar" aria-label="Hail map tools">
          <button type="button" className="cc-btn cc-btn--sm" onClick={fitAll} disabled={!ready || (events.length === 0 && !hasSwath)}>
            Fit storms
          </button>
        </div>
      </div>
      <ul aria-label="Hail events">
        {events.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className="cc-btn cc-btn--sm"
              aria-pressed={selectedId === e.id}
              onClick={() => onSelect(e.id)}
            >
              {e.magnitudeIn.toFixed(2)}&quot; hail · {e.location}, {e.state} · {e.date} {e.timeUtc} UTC
            </button>
          </li>
        ))}
        {events.length === 0 && (
          <li className="web-muted web-small" role="status">
            No hail reported in the selected period.
          </li>
        )}
      </ul>
      <p className="web-muted web-small">
        Hail reports: NOAA Storm Prediction Center daily storm reports. Marker size grows with hail size.
      </p>
      {/* Hail swath legend: the endpoint's note verbatim, plus source and check time. */}
      {swathQuery.isPending && (
        <p className="web-muted web-small" aria-live="polite">
          Loading hail swath…
        </p>
      )}
      {swathQuery.isError && (
        <p className="web-muted web-small" role="alert">
          Hail swath could not be loaded. The event list still works.
        </p>
      )}
      {swath && !swathQuery.isPending && (
        <p className="web-muted web-small" role="status">
          {hasSwath ? (
            <>
              {isApproximate && <strong>Approximate path — </strong>}
              Hail swath: {swath.note} Source: {swath.source} · checked{' '}
              {new Date(swath.checkedAt).toLocaleString()} · {swath.eventCount} hail
              event{swath.eventCount === 1 ? '' : 's'} in the swath period.
            </>
          ) : (
            <>
              No hail swath for the selected period
              {swath.message ? `: ${swath.message}` : '.'}
            </>
          )}
        </p>
      )}
    </div>
  );
}

export const HailStormMap = memo(HailStormMapInner);
