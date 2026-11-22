'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface MapLead {
  permitNumber: string;
  address: string;
  city: string;
  stage?: string;
  latitude?: number | null;
  longitude?: number | null;
}

const valid = (p: MapLead) =>
  p.latitude !== null && p.latitude !== undefined &&
  p.longitude !== null && p.longitude !== undefined &&
  Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
  p.latitude >= 25 && p.latitude <= 37 && p.longitude >= -107 && p.longitude <= -93;

const STAGE_COLORS: Record<string, string> = {
  planning: '#dbb02d',
  application: '#6683d4',
  permitted: '#288958',
  completed: '#6c7782',
  unknown: '#bd5555',
};

export function PermitLeadMap({ leads }: { leads: readonly MapLead[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const located = useMemo(() => leads.filter(valid), [leads]);

  useEffect(() => {
    if (!el.current || !located.length) return;
    let disposed = false;
    let cleanup = () => {};
    // Lazy-load the same MapLibre dependency already used by the roof/lawn workspaces.
    void import('maplibre-gl').then((lib) => {
      if (disposed || !el.current) return;
      const start = located[0]!;
      const map = new lib.Map({
        container: el.current,
        style: {
          version: 8,
          sources: {
            imagery: {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community',
            },
          },
          layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
        },
        center: [start.longitude!, start.latitude!],
        zoom: 11,
      });
      const bounds = new lib.LngLatBounds(
        [start.longitude!, start.latitude!],
        [start.longitude!, start.latitude!],
      );
      for (const p of located) {
        new lib.Marker({ color: STAGE_COLORS[p.stage ?? 'unknown'] ?? STAGE_COLORS.unknown })
          .setLngLat([p.longitude!, p.latitude!])
          .setPopup(new lib.Popup().setText(
            (p.address || 'Address not published') + ', ' + p.city +
            ' · Permit ' + p.permitNumber + ' · ' + (p.stage ?? 'unknown stage'),
          ))
          .addTo(map);
        bounds.extend([p.longitude!, p.latitude!]);
      }
      if (located.length > 1) map.fitBounds(bounds, { padding: 45, maxZoom: 13 });
      map.on('error', () => setError('The satellite map could not load. Lead records remain available below.'));
      cleanup = () => map.remove();
    }).catch(() => {
      if (!disposed) setError('The satellite map could not load. Lead records remain available below.');
    });
    return () => { disposed = true; cleanup(); };
  }, [located]);

  return (
    <section className="web-card" aria-labelledby="lead-map-title">
      <h2 id="lead-map-title">Verified-location project map</h2>
      <p className="web-muted web-small">
        Yellow = planning · Blue = application · Green = permitted · Gray = completed · Red = unknown.
        Pins appear only when the government feed provides usable coordinates; addresses are
        never placed at invented coordinates.
      </p>
      {located.length ? (
        <div ref={el} aria-label="Interactive map of projects with source coordinates"
          style={{ width: '100%', height: 390, borderRadius: 12, overflow: 'hidden' }} />
      ) : (
        <p className="web-muted">None of these records included verified map coordinates.
          Open the city record or address in Maps instead.</p>
      )}
      {error && <p role="status" className="web-muted">{error}</p>}
      <p className="web-small">{located.length} of {leads.length} leads have source coordinates.</p>
    </section>
  );
}
