'use client';

import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type ErrorEvent,
  type MapMouseEvent,
} from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
} from 'react';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_PITCH, resolveBasemap, type MapBasemap } from './tiles';
import type { LngLat } from './geometry/polygonArea';

import 'maplibre-gl/dist/maplibre-gl.css';

export interface MapCanvasHandle {
  flyTo(lng: number, lat: number, zoom?: number): void;
  getMap(): MapLibreMap | null;
  project(lng: number, lat: number): { x: number; y: number } | null;
}

export interface MapCanvasProps {
  readonly className?: string;
  readonly basemap?: MapBasemap;
  readonly onBasemapChange?: (basemap: MapBasemap) => void;
  readonly initialCenter?: [number, number];
  readonly initialZoom?: number;
  readonly onClick?: (lngLat: LngLat, event: MapMouseEvent) => void;
  readonly onReady?: (map: MapLibreMap) => void;
  readonly children?: ReactNode;
  readonly interactive?: boolean;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    className,
    basemap: basemapProp = 'satellite',
    onBasemapChange,
    initialCenter = DEFAULT_CENTER,
    initialZoom = DEFAULT_ZOOM,
    onClick,
    onReady,
    children,
    interactive = true,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onClickRef = useRef(onClick);
  const onReadyRef = useRef(onReady);
  const [basemap, setBasemap] = useState<MapBasemap>(basemapProp);
  const [attribution, setAttribution] = useState('');
  const [ready, setReady] = useState(false);

  onClickRef.current = onClick;
  onReadyRef.current = onReady;

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom = 19) {
      mapRef.current?.flyTo({
        center: [lng, lat],
        zoom,
        essential: true,
        pitch: Math.min(mapRef.current.getPitch(), 60),
      });
    },
    getMap: () => mapRef.current,
    project(lng, lat) {
      const map = mapRef.current;
      if (!map) return null;
      const p = map.project([lng, lat]);
      return { x: p.x, y: p.y };
    },
  }));

  const applyBasemap = useCallback((map: MapLibreMap, next: MapBasemap) => {
    const cfg = resolveBasemap(next);
    setAttribution(cfg.attribution);
    const style = cfg.styleUrl ?? cfg.style;
    if (!style) return;
    map.setStyle(style, { diff: false });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const cfg = resolveBasemap(basemap);
    setAttribution(cfg.attribution);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: (cfg.styleUrl ?? cfg.style)!,
      center: initialCenter,
      zoom: initialZoom,
      maxPitch: MAX_PITCH,
      pitch: 45,
      bearing: -15,
      attributionControl: false,
      dragRotate: true,
      touchPitch: true,
      cooperativeGestures: false,
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-left');
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: cfg.attribution }),
      'bottom-right',
    );

    const onMapClick = (e: MapMouseEvent) => {
      onClickRef.current?.([e.lngLat.lng, e.lngLat.lat], e);
    };
    map.on('click', onMapClick);
    map.on('load', () => {
      setReady(true);
      onReadyRef.current?.(map);
    });
    // If OpenFreeMap style URL fails, fall back to OSM raster.
    map.on('error', (ev: ErrorEvent) => {
      const err = ev.error as { status?: number; message?: string } | undefined;
      if (cfg.styleUrl && err && (err.status === 404 || err.status === 0)) {
        const fallback = resolveBasemap('street');
        if (fallback.style) {
          map.setStyle(fallback.style);
          setAttribution(fallback.attribution);
        }
      }
    });

    mapRef.current = map;
    return () => {
      map.off('click', onMapClick);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Intentionally once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (basemapProp !== basemap) setBasemap(basemapProp);
  }, [basemapProp, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyBasemap(map, basemap);
  }, [basemap, ready, applyBasemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (interactive) {
      map.boxZoom.enable();
      map.dragPan.enable();
      map.dragRotate.enable();
      map.scrollZoom.enable();
      map.keyboard.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
    } else {
      map.boxZoom.disable();
      map.dragPan.disable();
      map.dragRotate.disable();
      map.scrollZoom.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    }
  }, [interactive]);

  function toggleBasemap() {
    const next: MapBasemap = basemap === 'satellite' ? 'street' : 'satellite';
    setBasemap(next);
    onBasemapChange?.(next);
  }

  return (
    <div className={className ? `web-map ${className}` : 'web-map'}>
      <div ref={containerRef} className="web-map__canvas" role="application" aria-label="Map" />
      <div className="web-map__basemap">
        <button
          type="button"
          className="web-map-tool"
          onClick={toggleBasemap}
          aria-pressed={basemap === 'satellite'}
        >
          {basemap === 'satellite' ? 'Street' : 'Satellite'}
        </button>
      </div>
      <p className="web-map__attr" aria-live="polite">
        {attribution}
      </p>
      {children}
    </div>
  );
});
