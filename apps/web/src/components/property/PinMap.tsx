'use client';

// RF-017-FE B: a draggable pin on a MapLibre map. The basemap is Esri World Imagery for
// VISUALIZATION ONLY (licensing rule: consumer tiles are never used for machine analysis), with
// its attribution always visible. Structure candidate footprints are outlined. When WebGL or the
// map library is unavailable, and always for keyboard users, the pin can be set by coordinates.
import type { GeoPoint, GeoPolygon } from '@fieldline/contracts';
import { useEffect, useRef, useState } from 'react';
import { ESRI_WORLD_IMAGERY } from './types';
import styles from './property.module.css';

export interface PinMapProps {
  point: GeoPoint;
  footprints?: { id: string; label: string; footprint: GeoPolygon | null; selected: boolean }[];
  onMove: (point: GeoPoint) => void;
}

type MapLike = { remove(): void; getSource(id: string): { setData(d: unknown): void } | undefined; on(e: string, f: () => void): void };
type MarkerLike = { setLngLat(c: [number, number]): MarkerLike; getLngLat(): { lng: number; lat: number }; on(e: string, f: () => void): void };

export function PinMap({ point, footprints = [], onMove }: PinMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLike | null>(null);
  const markerRef = useRef<MarkerLike | null>(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [lon, lat] = point.coordinates;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!container.current || typeof window === 'undefined' || !('WebGLRenderingContext' in window)) throw new Error('no webgl');
        const maplibre = await import('maplibre-gl');
        if (cancelled || !container.current) return;
        const map = new maplibre.Map({
          container: container.current,
          center: [lon, lat],
          zoom: 18,
          attributionControl: { compact: false, customAttribution: ESRI_WORLD_IMAGERY.attribution },
          style: {
            version: 8,
            sources: {
              imagery: { type: 'raster', tiles: [ESRI_WORLD_IMAGERY.tiles], tileSize: 256, maxzoom: ESRI_WORLD_IMAGERY.maxzoom, attribution: ESRI_WORLD_IMAGERY.attribution },
              footprints: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
            },
            layers: [
              { id: 'imagery', type: 'raster', source: 'imagery' },
              { id: 'footprints-line', type: 'line', source: 'footprints', paint: { 'line-color': ['case', ['get', 'selected'], '#22d3ee', '#f8fafc'], 'line-width': 2 } },
            ],
          },
        });
        const marker = new maplibre.Marker({ draggable: true }).setLngLat([lon, lat]).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLngLat();
          onMoveRef.current({ type: 'Point', coordinates: [round(p.lng), round(p.lat)] });
        });
        mapRef.current = map as unknown as MapLike;
        markerRef.current = marker as unknown as MarkerLike;
        map.on('load', () => !cancelled && setMapState('ready'));
      } catch {
        if (!cancelled) setMapState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once; later point changes move the marker below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerRef.current?.setLngLat([lon, lat]);
  }, [lon, lat]);

  useEffect(() => {
    const src = mapRef.current?.getSource('footprints');
    src?.setData({
      type: 'FeatureCollection',
      features: footprints.filter((f) => f.footprint).map((f) => ({ type: 'Feature', properties: { label: f.label, selected: f.selected }, geometry: f.footprint })),
    });
  }, [footprints, mapState]);

  return (
    <div className={styles.mapWrap}>
      <div ref={container} className={styles.map} role="img" aria-label="Aerial map for orientation. Drag the pin to the right building." />
      {mapState === 'unavailable' && <p className={styles.status}>The map cannot be shown on this device. Set the pin by coordinates below.</p>}
      <p className={styles.attribution}>{ESRI_WORLD_IMAGERY.attribution}</p>
      <fieldset className={styles.coords}>
        <legend>Pin position (longitude, latitude)</legend>
        <label>
          Longitude
          <input type="number" step="0.000001" value={lon} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onMove({ type: 'Point', coordinates: [e.target.valueAsNumber, lat] })} />
        </label>
        <label>
          Latitude
          <input type="number" step="0.000001" value={lat} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onMove({ type: 'Point', coordinates: [lon, e.target.valueAsNumber] })} />
        </label>
      </fieldset>
    </div>
  );
}

function round(v: number): number {
  return Math.round(v * 1e7) / 1e7;
}
