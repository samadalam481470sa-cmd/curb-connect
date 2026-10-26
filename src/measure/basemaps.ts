import L from "leaflet";

/**
 * Basemap layers. Satellite is the default: Esri World Imagery with road and place labels
 * on top (a "hybrid" view). When VITE_GOOGLE_MAPS_API_KEY is set, Google's satellite tiles
 * from the Map Tiles API are added and used instead.
 */

const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const arcgisKey = import.meta.env.VITE_ARCGIS_API_KEY as string | undefined;

const ESRI_BASE = "https://server.arcgisonline.com/ArcGIS/rest/services";
const esriAttribution =
  'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';
const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Deepest zoom with real imagery; Leaflet upscales tiles beyond this instead of showing grey. */
export const ESRI_NATIVE_MAX_ZOOM = 19;
export const GOOGLE_NATIVE_MAX_ZOOM = 22;
export const MAP_MAX_ZOOM = 22;

function esriTileUrl(service: string): string {
  const url = `${ESRI_BASE}/${service}/MapServer/tile/{z}/{y}/{x}`;
  return arcgisKey ? `${url}?token=${encodeURIComponent(arcgisKey)}` : url;
}

export function esriImagery(): L.TileLayer {
  return L.tileLayer(esriTileUrl("World_Imagery"), {
    maxNativeZoom: ESRI_NATIVE_MAX_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    attribution: esriAttribution
  });
}

function esriLabels(): L.LayerGroup {
  const options = { maxNativeZoom: ESRI_NATIVE_MAX_ZOOM, maxZoom: MAP_MAX_ZOOM, pane: "overlayPane" };
  return L.layerGroup([
    L.tileLayer(esriTileUrl("Reference/World_Transportation"), options),
    L.tileLayer(esriTileUrl("Reference/World_Boundaries_and_Places"), options)
  ]);
}

export function streetLayer(): L.TileLayer {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,
    maxZoom: MAP_MAX_ZOOM,
    attribution: osmAttribution
  });
}

interface GoogleSession {
  session: string;
}

/** Starts a Google Map Tiles API session for satellite imagery with road labels; returns the tile URL. */
async function googleSatelliteUrl(): Promise<string | null> {
  if (!googleKey) {
    return null;
  }
  const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(googleKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US", layerTypes: ["layerRoadmap"] })
  });
  if (!response.ok) {
    throw new Error(`Google map tiles are unavailable (${response.status}). Check the API key and that the Map Tiles API is enabled.`);
  }
  const { session } = (await response.json()) as GoogleSession;
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(googleKey)}`;
}

export interface BasemapSetup {
  /** Layer for the magnifier loupe, matching the default basemap. */
  loupeLayer: () => L.TileLayer;
  /** Non-fatal problem to show the user, e.g. a rejected Google key. */
  warning?: string;
}

/** Adds the basemaps and layer switcher to `map`. Satellite hybrid is shown first. */
export async function addBasemaps(map: L.Map): Promise<BasemapSetup> {
  const hybrid = L.layerGroup([esriImagery(), esriLabels()]);
  const baseLayers: Record<string, L.Layer> = {
    "Satellite + labels": hybrid,
    Satellite: esriImagery(),
    Street: streetLayer()
  };
  hybrid.addTo(map);
  const control = L.control.layers(baseLayers, undefined, { position: "topright" }).addTo(map);

  try {
    const googleUrl = await googleSatelliteUrl();
    if (googleUrl) {
      const google = L.tileLayer(googleUrl, {
        maxNativeZoom: GOOGLE_NATIVE_MAX_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        attribution: "Map data &copy; Google"
      });
      control.addBaseLayer(google, "Google satellite");
      map.removeLayer(hybrid);
      google.addTo(map);
      return { loupeLayer: () => L.tileLayer(googleUrl, { maxNativeZoom: GOOGLE_NATIVE_MAX_ZOOM, maxZoom: 24 }) };
    }
  } catch (error) {
    return {
      loupeLayer: () => L.tileLayer(esriTileUrl("World_Imagery"), { maxNativeZoom: ESRI_NATIVE_MAX_ZOOM, maxZoom: 24 }),
      warning: error instanceof Error ? error.message : "Google map tiles are unavailable."
    };
  }

  return {
    loupeLayer: () => L.tileLayer(esriTileUrl("World_Imagery"), { maxNativeZoom: ESRI_NATIVE_MAX_ZOOM, maxZoom: 24 })
  };
}
