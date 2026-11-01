'use client';

import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { useEffect } from 'react';
import { closeRing, type LngLat } from './geometry/polygonArea';
import type { MapOpening, MapPolygonFacet } from './types';
import { rectangleRingAround } from './openings';

const SOURCE = 'fl-draw';
const VERTEX_SOURCE = 'fl-draw-vertices';
const OPENING_SOURCE = 'fl-openings';

function facetCollection(
  facets: readonly MapPolygonFacet[],
  draftRing: readonly LngLat[] | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = facets
    .filter((f) => f.ring.length >= 3)
    .map((f) => ({
      type: 'Feature',
      properties: { id: f.id, label: f.label },
      geometry: {
        type: 'Polygon',
        coordinates: [closeRing(f.ring).map(([lng, lat]) => [lng, lat])],
      },
    }));
  if (draftRing && draftRing.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { id: 'draft', label: 'draft', draft: true },
      geometry: {
        type: 'LineString',
        coordinates: draftRing.map(([lng, lat]) => [lng, lat]),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function vertexCollection(
  facets: readonly MapPolygonFacet[],
  draftRing: readonly LngLat[] | null,
  selectedFacetId: string | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of facets) {
    f.ring.forEach(([lng, lat], i) => {
      features.push({
        type: 'Feature',
        properties: { facetId: f.id, index: i, selected: f.id === selectedFacetId },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
    });
  }
  draftRing?.forEach(([lng, lat], i) => {
    features.push({
      type: 'Feature',
      properties: { facetId: 'draft', index: i, selected: true },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
  });
  return { type: 'FeatureCollection', features };
}

function openingCollection(openings: readonly MapOpening[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = openings.map((o) => {
    const ring = o.ring ?? rectangleRingAround(o.center, o.widthFt, o.lengthFt);
    return {
      type: 'Feature',
      properties: { id: o.id, number: o.number, equipment: o.equipment },
      geometry: {
        type: 'Polygon',
        coordinates: [closeRing(ring).map(([lng, lat]) => [lng, lat])],
      },
    };
  });
  // Number labels as points
  for (const o of openings) {
    features.push({
      type: 'Feature',
      properties: { id: `${o.id}-label`, number: String(o.number), label: true },
      geometry: { type: 'Point', coordinates: [o.center[0], o.center[1]] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function ensureLayers(map: MapLibreMap) {
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'fl-draw-fill',
      type: 'fill',
      source: SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#0f5b5c',
        'fill-opacity': 0.28,
      },
    });
    map.addLayer({
      id: 'fl-draw-line',
      type: 'line',
      source: SOURCE,
      paint: {
        'line-color': '#0a3d4a',
        'line-width': 2.5,
      },
    });
  }
  if (!map.getSource(VERTEX_SOURCE)) {
    map.addSource(VERTEX_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'fl-draw-vertices',
      type: 'circle',
      source: VERTEX_SOURCE,
      paint: {
        'circle-radius': 7,
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0f5b5c',
      },
    });
  }
  if (!map.getSource(OPENING_SOURCE)) {
    map.addSource(OPENING_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'fl-openings-fill',
      type: 'fill',
      source: OPENING_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#1b4a87',
        'fill-opacity': 0.35,
      },
    });
    map.addLayer({
      id: 'fl-openings-line',
      type: 'line',
      source: OPENING_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'line-color': '#14212b',
        'line-width': 2,
        'line-dasharray': [2, 1],
      },
    });
    map.addLayer({
      id: 'fl-openings-label',
      type: 'symbol',
      source: OPENING_SOURCE,
      filter: ['==', ['get', 'label'], true],
      layout: {
        'text-field': ['get', 'number'],
        'text-size': 16,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#14212b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });
  }
}

export interface MapDrawLayerProps {
  readonly map: MapLibreMap | null;
  readonly facets?: readonly MapPolygonFacet[];
  readonly draftRing?: readonly LngLat[] | null;
  readonly selectedFacetId?: string | null;
  readonly openings?: readonly MapOpening[];
}

export function MapDrawLayer({
  map,
  facets = [],
  draftRing = null,
  selectedFacetId = null,
  openings = [],
}: MapDrawLayerProps) {
  useEffect(() => {
    if (!map) return;
    const sync = () => {
      try {
        ensureLayers(map);
        (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(
          facetCollection(facets, draftRing),
        );
        (map.getSource(VERTEX_SOURCE) as GeoJSONSource | undefined)?.setData(
          vertexCollection(facets, draftRing, selectedFacetId ?? null),
        );
        (map.getSource(OPENING_SOURCE) as GeoJSONSource | undefined)?.setData(
          openingCollection(openings),
        );
      } catch {
        // Style may still be loading after basemap switch.
      }
    };
    sync();
    map.on('styledata', sync);
    return () => {
      map.off('styledata', sync);
    };
  }, [map, facets, draftRing, selectedFacetId, openings]);

  return null;
}
