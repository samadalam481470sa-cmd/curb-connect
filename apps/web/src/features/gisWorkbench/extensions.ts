// Extensions panel tools: the workbench's built-in "plugins". Each tool is a fixed, named
// operation over the polygons of a layer the contractor picks — no arbitrary code, no
// third-party plugin loading. Geometry runs through @fieldline/geometry's operations module
// (turf-based union/intersect/difference/buffer), the same operations QGIS exposes from GEOS,
// rebuilt in TypeScript. Results are honest: a tool that finds nothing says so, and nothing
// here writes back to the source data — the result is a display overlay only.

import {
  bufferLonLatRing,
  differenceLonLatRings,
  geodesicArea,
  intersectLonLatRings,
  unionLonLatRings,
} from '@fieldline/geometry';
import type { GisFeature, LayerId } from './layers';

export type ExtensionToolId = 'union' | 'buffer' | 'intersect' | 'difference';

export interface ExtensionTool {
  id: ExtensionToolId;
  label: string;
  description: string;
  /** Second input layer needed (intersect/difference), or a distance input (buffer). */
  needsSecondLayer: boolean;
  needsDistance: boolean;
}

export const EXTENSION_TOOLS: readonly ExtensionTool[] = [
  {
    id: 'union',
    label: 'Merge polygons (union)',
    description: 'Combine every polygon on the picked layer into one outline — overlapping areas counted once.',
    needsSecondLayer: false,
    needsDistance: false,
  },
  {
    id: 'buffer',
    label: 'Buffer polygons',
    description: 'Grow every polygon on the picked layer outward by a set distance (e.g. a setback or easement offset).',
    needsSecondLayer: false,
    needsDistance: true,
  },
  {
    id: 'intersect',
    label: 'Overlap (intersect)',
    description: 'Keep only the ground where the first layer overlaps the second — e.g. parcels inside a hail swath.',
    needsSecondLayer: true,
    needsDistance: false,
  },
  {
    id: 'difference',
    label: 'Subtract (difference)',
    description: 'Cut the second layer out of the first — e.g. a parcel minus the stream corridor.',
    needsSecondLayer: true,
    needsDistance: false,
  },
] as const;

export interface ToolResult {
  features: GisFeature[];
  /** Plain-language result line — the tool's honest verdict. */
  summary: string;
  warnings: string[];
}

const SQFT_PER_SQM = 10.76391041671;

type Ring = Array<{ lon: number; lat: number }>;

/** The outer ring of every polygon feature (MultiPolygons contribute each part). */
function outerRings(features: readonly GisFeature[]): Ring[] {
  const rings: Ring[] = [];
  for (const feature of features) {
    if (feature.geometry.type === 'Polygon') {
      const outer = feature.geometry.coordinates[0];
      if (outer && outer.length >= 3) rings.push(outer.map(([lon, lat]) => ({ lon: lon!, lat: lat! })));
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const part of feature.geometry.coordinates) {
        const outer = part[0];
        if (outer && outer.length >= 3) rings.push(outer.map(([lon, lat]) => ({ lon: lon!, lat: lat! })));
      }
    }
  }
  return rings;
}

function ringsToFeatures(rings: readonly Ring[], toolLabel: string): GisFeature[] {
  return rings
    .filter((ring) => ring.length >= 3)
    .map((ring, i) => {
      const coords = ring.map((p) => [p.lon, p.lat]);
      const first = coords[0]!;
      const areaSqFt = geodesicArea(ring) * SQFT_PER_SQM;
      return {
        id: `tool-result-${i}`,
        geometry: { type: 'Polygon' as const, coordinates: [[...coords, first]] },
        properties: {
          tool: toolLabel,
          areaSqFt: Math.round(areaSqFt),
          acres: Number((areaSqFt / 43_560).toFixed(3)),
        },
      };
    });
}

export interface ToolInput {
  toolId: ExtensionToolId;
  layerA: LayerId;
  featuresA: readonly GisFeature[];
  layerB?: LayerId;
  featuresB?: readonly GisFeature[];
  /** Buffer distance in feet (converted to metres for the geometry engine). */
  bufferFeet?: number;
}

const MAX_TOOL_FEATURES = 200;

/**
 * Runs one extension tool. Pure and synchronous — the view asks the contractor to confirm
 * before calling this, and shows the summary + warnings verbatim.
 */
export function runExtensionTool(input: ToolInput): ToolResult {
  const tool = EXTENSION_TOOLS.find((t) => t.id === input.toolId);
  if (!tool) return { features: [], summary: 'Unknown tool.', warnings: [] };
  const warnings: string[] = [];

  const ringsA = outerRings(input.featuresA);
  if (ringsA.length === 0) {
    return {
      features: [],
      summary: `No polygons on the picked layer — ${tool.label} needs polygon features.`,
      warnings,
    };
  }
  if (ringsA.length > MAX_TOOL_FEATURES) {
    warnings.push(
      `Only the first ${MAX_TOOL_FEATURES} of ${ringsA.length} polygons were used — zoom in or filter the layer for the rest.`,
    );
  }
  const useA = ringsA.slice(0, MAX_TOOL_FEATURES);

  try {
    switch (input.toolId) {
      case 'union': {
        const merged = unionLonLatRings(useA);
        const features = ringsToFeatures(merged, tool.label);
        return {
          features,
          summary:
            features.length === 0
              ? 'The polygons could not be merged — check for self-intersecting outlines.'
              : `Merged ${useA.length} polygons into ${features.length} outline(s).`,
          warnings,
        };
      }
      case 'buffer': {
        const feet = input.bufferFeet ?? 0;
        if (!(feet > 0)) {
          return { features: [], summary: 'Enter a buffer distance greater than 0 ft.', warnings };
        }
        const metres = feet * 0.3048;
        const out: Ring[] = [];
        for (const ring of useA) out.push(...bufferLonLatRing(ring, metres));
        const features = ringsToFeatures(out, tool.label);
        return {
          features,
          summary:
            features.length === 0
              ? 'The buffer produced no outline — the polygons may be too small or invalid.'
              : `Buffered ${useA.length} polygon(s) by ${feet} ft into ${features.length} outline(s).`,
          warnings,
        };
      }
      case 'intersect':
      case 'difference': {
        const ringsB = outerRings(input.featuresB ?? []);
        if (ringsB.length === 0) {
          return {
            features: [],
            summary: 'The second layer has no polygons — pick a polygon layer to compare against.',
            warnings,
          };
        }
        if (ringsB.length > MAX_TOOL_FEATURES) {
          warnings.push(
            `Only the first ${MAX_TOOL_FEATURES} of ${ringsB.length} second-layer polygons were used.`,
          );
        }
        const useB = ringsB.slice(0, MAX_TOOL_FEATURES);
        const out: Ring[] = [];
        if (input.toolId === 'intersect') {
          // A ∩ (union of B): merge the second layer first, then intersect each A piece.
          const mergedB = unionLonLatRings(useB);
          for (const a of useA) {
            for (const b of mergedB) out.push(...intersectLonLatRings(a, b));
          }
        } else {
          // A − B: subtracting each B piece in turn is the same as subtracting their union.
          for (const a of useA) {
            let current: Ring[] = [a];
            for (const b of useB) {
              const next: Ring[] = [];
              for (const piece of current) next.push(...differenceLonLatRings(piece, b));
              current = next;
              if (current.length === 0) break;
            }
            out.push(...current);
          }
        }
        const features = ringsToFeatures(out, tool.label);
        return {
          features,
          summary:
            features.length === 0
              ? input.toolId === 'intersect'
                ? 'The two layers do not overlap in this view.'
                : 'Nothing remains — the second layer covers the first.'
              : `${tool.label} produced ${features.length} outline(s).`,
          warnings,
        };
      }
    }
  } catch {
    return {
      features: [],
      summary: 'The geometry engine could not run this tool on these shapes (invalid outline?).',
      warnings,
    };
  }
}
