// Attribution-compliant raster/vector styles for MapLibre.
// Prefer MapTiler when NEXT_PUBLIC_MAPTILER_KEY is set; else OpenFreeMap liberty / OSM + Esri imagery.

import type { StyleSpecification } from 'maplibre-gl';

export type MapBasemap = 'street' | 'satellite';

export interface BasemapConfig {
  readonly id: MapBasemap;
  readonly label: string;
  /** Style URL preferred when available (vector tiles). */
  readonly styleUrl: string | null;
  /** Inline style used when styleUrl is null (raster fallbacks). */
  readonly style: StyleSpecification | null;
  readonly attribution: string;
}

function maptilerKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim();
  return key || undefined;
}

function osmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

function esriImageryStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution:
          'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
  };
}

function maptilerSatelliteStyle(key: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      maptiler: {
        type: 'raster',
        tiles: [
          `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
        ],
        tileSize: 512,
        attribution: '© MapTiler © OpenStreetMap contributors',
        maxzoom: 20,
      },
    },
    layers: [{ id: 'maptiler-sat', type: 'raster', source: 'maptiler' }],
  };
}

const OPENFREEMAP_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';

export function resolveBasemap(basemap: MapBasemap): BasemapConfig {
  const key = maptilerKey();

  if (basemap === 'satellite') {
    if (key) {
      return {
        id: 'satellite',
        label: 'Satellite',
        styleUrl: null,
        style: maptilerSatelliteStyle(key),
        attribution: '© MapTiler © OpenStreetMap contributors',
      };
    }
    return {
      id: 'satellite',
      label: 'Satellite',
      styleUrl: null,
      style: esriImageryStyle(),
      attribution:
        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    };
  }

  if (key) {
    return {
      id: 'street',
      label: 'Street',
      styleUrl: `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`,
      style: null,
      attribution: '© MapTiler © OpenStreetMap contributors',
    };
  }

  return {
    id: 'street',
    label: 'Street',
    styleUrl: OPENFREEMAP_LIBERTY,
    style: osmRasterStyle(), // fallback if OpenFreeMap style fetch fails
    attribution: '© OpenStreetMap contributors · © OpenFreeMap',
  };
}

export const DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283];
export const DEFAULT_ZOOM = 4;
export const MAX_PITCH = 85;
