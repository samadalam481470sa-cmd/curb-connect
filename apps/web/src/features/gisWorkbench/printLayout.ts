// Print-layout math for the GIS Workbench plan sheet: page sizes, the scale bar, the north
// arrow, and the legend. Pure functions so the sheet geometry is unit-testable.
//
// Scale honesty: web-mercator scale varies across the sheet; the bar is computed at the map
// centre and the sheet says so ("scale approximate at map centre"). The ground resolution uses
// the standard 512-pixel tile formula for MapLibre GL.

import { LAYER_DEFS, type LayerId, type LayerState } from './layers';

export type PageSize = 'letter' | 'legal' | 'tabloid';
export type Orientation = 'portrait' | 'landscape';

export const PAGE_SIZES: Record<PageSize, { label: string; widthIn: number; heightIn: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', widthIn: 8.5, heightIn: 11 },
  legal: { label: 'Legal (8.5 × 14 in)', widthIn: 8.5, heightIn: 14 },
  tabloid: { label: 'Tabloid (11 × 17 in)', widthIn: 11, heightIn: 17 },
};

/** Printable page dimensions in inches for a size + orientation. */
export function pageDimensions(size: PageSize, orientation: Orientation): { widthIn: number; heightIn: number } {
  const base = PAGE_SIZES[size];
  return orientation === 'landscape'
    ? { widthIn: base.heightIn, heightIn: base.widthIn }
    : { widthIn: base.widthIn, heightIn: base.heightIn };
}

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TILE_SIZE = 512;
const M_PER_FT = 0.3048;

/** Ground metres per screen pixel at a latitude + zoom (web mercator, 512-px tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
}

const NICE_DISTANCES_FT = [25, 50, 100, 200, 500, 1000, 2000, 5280, 10560] as const;

function niceLabel(feet: number): string {
  if (feet >= 5280) {
    const miles = feet / 5280;
    return `${miles === Math.round(miles) ? miles : miles.toFixed(2)} mi`;
  }
  return `${feet.toLocaleString('en-US')} ft`;
}

export interface ScaleBar {
  label: string;
  /** Bar width as a fraction of the map canvas CSS width (0..1). */
  widthFraction: number;
  /** Ground distance the bar represents, in feet. */
  distanceFt: number;
}

/**
 * Picks the largest "nice" distance whose bar fits in 40% of the canvas width, so the printed
 * bar reads cleanly (100 ft, 500 ft, 1 mi …) and is measured at the map centre.
 */
export function scaleBar(lat: number, zoom: number, canvasCssWidth: number): ScaleBar {
  const mpp = metresPerPixel(lat, zoom);
  const maxPx = Math.max(40, canvasCssWidth * 0.4);
  let chosen = NICE_DISTANCES_FT[0] as number;
  for (const feet of NICE_DISTANCES_FT) {
    const px = (feet * M_PER_FT) / mpp;
    if (px <= maxPx) chosen = feet;
  }
  const px = (chosen * M_PER_FT) / mpp;
  return {
    label: niceLabel(chosen),
    widthFraction: Math.min(1, Math.max(0.02, px / Math.max(1, canvasCssWidth))),
    distanceFt: chosen,
  };
}

/** North-arrow rotation on the sheet: the inverse of the map bearing. */
export function northArrowRotation(bearing: number): number {
  return bearing === 0 ? 0 : -bearing;
}

export interface LegendEntry {
  label: string;
  color: string;
}

/** Legend = the layers actually visible on the sheet, in registry order. */
export function buildLegend(states: Record<LayerId, LayerState>): LegendEntry[] {
  return LAYER_DEFS.filter((def) => states[def.id].visible).map((def) => ({
    label: def.label,
    color: states[def.id].color,
  }));
}

export interface LayerSummaryLine {
  label: string;
  featureCount: number;
  status: string;
}

const STATUS_WORDS: Record<LayerState['status'], string> = {
  not_loaded: 'Not loaded',
  loading: 'Loading',
  ok: 'Loaded',
  empty: 'Loaded — nothing in this view',
  unavailable: 'Source unavailable',
  error: 'Failed to load',
};

/** One line per layer for the sheet's layer table — the honest state at export time. */
export function buildLayerSummary(states: Record<LayerId, LayerState>): LayerSummaryLine[] {
  return LAYER_DEFS.map((def) => {
    const state = states[def.id];
    return {
      label: def.label,
      featureCount: state.featureCount,
      status: STATUS_WORDS[state.status],
    };
  });
}

/** Source notes for the sheet: the imagery line plus every visible layer's publisher note. */
export function buildSourceNotes(states: Record<LayerId, LayerState>): string[] {
  const notes = [
    'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
    'Scale approximate at map centre. DRAFT plan sheet — not a survey.',
  ];
  for (const def of LAYER_DEFS) {
    if (states[def.id].visible) notes.push(def.sourceNote);
  }
  return notes;
}
