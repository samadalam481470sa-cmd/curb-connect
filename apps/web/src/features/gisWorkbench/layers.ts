// GIS Workbench layer registry: the five toggleable map layers, their styling defaults, the
// attribute columns the table shows, and the normalizers that turn each layer's existing data
// source into plain GeoJSON features. Pure code — no fetching here (the view does that), so the
// shapes are unit-testable.
//
// Data honesty: parcels/streams/roofs come from the /v1/gis/layers endpoints; permits come from
// the existing permit-lead search (only permits the feed published coordinates for are plotted —
// the rest are counted, never geocoded by guessing); hail comes from the existing NOAA swath
// endpoint. Nothing is invented here.

export type LayerId = 'parcels' | 'permits' | 'streams' | 'hail' | 'roofs';

export type LayerKind = 'polygon' | 'line' | 'point';

export interface LayerDef {
  id: LayerId;
  label: string;
  kind: LayerKind;
  defaultColor: string;
  /** Fill opacity for polygons; line/point opacity for the others. */
  defaultOpacity: number;
  /** Publisher note shown in the layer panel and carried onto the plan sheet. */
  sourceNote: string;
}

export const LAYER_DEFS: readonly LayerDef[] = [
  {
    id: 'parcels',
    label: 'Parcels (CAD)',
    kind: 'polygon',
    defaultColor: '#f5c451',
    defaultOpacity: 0.25,
    sourceNote:
      'Parcels: Collin Central Appraisal District + Dallas Central Appraisal District parcel services (appraisal use, not city zoning).',
  },
  {
    id: 'permits',
    label: 'Permit leads',
    kind: 'point',
    defaultColor: '#fb923c',
    defaultOpacity: 0.95,
    sourceNote:
      'Permit leads: city building-permit feeds via Permit Job Search. Only permits the feed published coordinates for are plotted.',
  },
  {
    id: 'streams',
    label: 'Streams (NHD)',
    kind: 'line',
    defaultColor: '#38bdf8',
    defaultOpacity: 0.95,
    sourceNote:
      'Streams: USGS National Hydrography Dataset (NHD), The National Map. Not for site-specific regulatory determinations.',
  },
  {
    id: 'hail',
    label: 'Hail swath',
    kind: 'polygon',
    defaultColor: '#e879f9',
    defaultOpacity: 0.3,
    sourceNote:
      'Hail: NOAA MRMS MESH swath or NOAA Storm Prediction Center approximate path — estimated hail size, not confirmed damage.',
  },
  {
    id: 'roofs',
    label: 'Traced roofs',
    kind: 'polygon',
    defaultColor: '#22d3ee',
    defaultOpacity: 0.3,
    sourceNote: 'Traced roofs: your company’s saved roof measurements in Field Pro.',
  },
] as const;

export function layerDef(id: LayerId): LayerDef {
  const def = LAYER_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown layer ${id}`);
  return def;
}

export type LayerStatus =
  | 'not_loaded'
  | 'loading'
  | 'ok'
  | 'empty'
  | 'unavailable'
  | 'error';

export interface LayerState {
  visible: boolean;
  color: string;
  opacity: number;
  status: LayerStatus;
  featureCount: number;
  /** Plain-language status line from the source (never invented). */
  message: string;
  checkedAt: string | null;
  truncated: boolean;
}

export function defaultLayerStates(): Record<LayerId, LayerState> {
  const states = {} as Record<LayerId, LayerState>;
  for (const def of LAYER_DEFS) {
    states[def.id] = {
      visible: def.id === 'parcels' || def.id === 'roofs',
      color: def.defaultColor,
      opacity: def.defaultOpacity,
      status: 'not_loaded',
      featureCount: 0,
      message: 'Not loaded yet.',
      checkedAt: null,
      truncated: false,
    };
  }
  return states;
}

/** One map feature, uniform across layers. Geometry is GeoJSON in lon/lat. */
export interface GisFeature {
  id: string;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] }
    | { type: 'LineString'; coordinates: number[][] }
    | { type: 'MultiLineString'; coordinates: number[][][] }
    | { type: 'Point'; coordinates: number[] };
  properties: Record<string, unknown>;
}

export interface AttributeColumn {
  key: string;
  label: string;
  numeric?: boolean;
  /** Short format hint for cellText: 'money' | 'acres' | 'sqft' | 'date' | 'text'. */
  format?: 'money' | 'acres' | 'sqft' | 'date' | 'text';
}

export const ATTRIBUTE_COLUMNS: Record<LayerId, readonly AttributeColumn[]> = {
  parcels: [
    { key: 'parcelId', label: 'Parcel ID' },
    { key: 'ownerName', label: 'Owner' },
    { key: 'situsAddress', label: 'Situs address' },
    { key: 'city', label: 'City' },
    { key: 'acres', label: 'Acres', numeric: true, format: 'acres' },
    { key: 'landUse', label: 'Appraisal use' },
    { key: 'landValue', label: 'Land value', numeric: true, format: 'money' },
    { key: 'marketValue', label: 'Market value', numeric: true, format: 'money' },
    { key: 'vintage', label: 'Data vintage' },
  ],
  permits: [
    { key: 'permitNumber', label: 'Permit #' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'projectType', label: 'Project' },
    { key: 'status', label: 'Status' },
    { key: 'issuedAt', label: 'Issued', format: 'date' },
    { key: 'value', label: 'Value', numeric: true, format: 'money' },
    { key: 'contractor', label: 'Contractor' },
    { key: 'score', label: 'Score', numeric: true },
    { key: 'grade', label: 'Grade' },
  ],
  streams: [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'ftype', label: 'NHD ftype', numeric: true },
  ],
  hail: [{ key: 'maxHailIn', label: 'Max hail (in)', numeric: true }],
  roofs: [
    { key: 'address', label: 'Address' },
    { key: 'label', label: 'Facet' },
    { key: 'planSqFt', label: 'Plan sq ft', numeric: true, format: 'sqft' },
    { key: 'slopedSqFt', label: 'Sloped sq ft', numeric: true, format: 'sqft' },
    { key: 'pitchRise', label: 'Pitch (rise/12)', numeric: true },
    { key: 'needsReview', label: 'Needs review' },
  ],
};

/** The permit-lead fields the workbench plots (subset of the search result lead). */
export interface PermitLeadLike {
  permitNumber: string;
  city: string;
  address: string;
  description: string;
  status: string;
  issuedAt: string | null;
  value: number;
  contractor: string;
  latitude?: number | null;
  longitude?: number | null;
  projectType: string;
  score: number;
  grade: string;
  sourceName: string;
}

export interface PermitsConversion {
  features: GisFeature[];
  /** Leads the feed published no coordinates for — counted, never placed. */
  withoutCoords: number;
}

/**
 * Plots only permits the feed published coordinates for. A permit without coordinates is
 * counted in `withoutCoords` and left off the map — never geocoded by guessing.
 */
export function permitsToFeatures(leads: readonly PermitLeadLike[]): PermitsConversion {
  const features: GisFeature[] = [];
  let withoutCoords = 0;
  for (const lead of leads) {
    const lat = lead.latitude;
    const lon = lead.longitude;
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      withoutCoords += 1;
      continue;
    }
    features.push({
      id: `permit-${lead.permitNumber}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layer: 'permits',
        permitNumber: lead.permitNumber,
        address: lead.address,
        city: lead.city,
        description: lead.description,
        status: lead.status,
        issuedAt: lead.issuedAt,
        value: lead.value,
        contractor: lead.contractor,
        projectType: lead.projectType,
        score: lead.score,
        grade: lead.grade,
        sourceName: lead.sourceName,
      },
    });
  }
  return { features, withoutCoords };
}

/** Stable table/highlight id for an API GeoJSON feature. */
export function apiFeatureId(layer: LayerId, properties: Record<string, unknown>, index: number): string {
  switch (layer) {
    case 'parcels':
      return `parcel-${String(properties.county ?? 'x')}-${String(properties.parcelId ?? index)}`;
    case 'roofs':
      return `roof-${String(properties.measurementId ?? 'x')}-${String(properties.label ?? index)}`;
    case 'streams':
      return `stream-${index}`;
    case 'hail':
      return `hail-${index}`;
    case 'permits':
      return `permit-${String(properties.permitNumber ?? index)}`;
  }
}
