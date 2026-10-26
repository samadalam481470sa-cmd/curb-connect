/**
 * Address search. Uses Google's Geocoding API when VITE_GOOGLE_MAPS_API_KEY is set,
 * otherwise Esri's World Geocoding Service, which resolves house-number addresses worldwide.
 * Results are only used to move the map, not stored, which keeps Esri usage within its
 * non-stored geocoding terms. Set VITE_ARCGIS_API_KEY for commercial traffic.
 */

export interface GeocodeSuggestion {
  text: string;
  /** Esri magic key that resolves this exact suggestion; empty for providers without one. */
  key: string;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  /** Rough precision of the match, e.g. "PointAddress", "StreetAddress", "Locality", "ROOFTOP". */
  precision: string;
}

const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const arcgisKey = import.meta.env.VITE_ARCGIS_API_KEY as string | undefined;
const ESRI_GEOCODER = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

export const geocoderName = googleKey ? "Google" : "Esri";

function esriParams(params: Record<string, string>): string {
  const search = new URLSearchParams({ f: "json", ...params });
  if (arcgisKey) {
    search.set("token", arcgisKey);
  }
  return search.toString();
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Address search failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

interface EsriSuggestResponse {
  suggestions?: { text: string; magicKey: string; isCollection: boolean }[];
  error?: { message: string };
}

interface EsriCandidatesResponse {
  candidates?: {
    address: string;
    location: { x: number; y: number };
    score: number;
    attributes?: { Addr_type?: string };
  }[];
  error?: { message: string };
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: {
    formatted_address: string;
    geometry: { location: { lat: number; lng: number }; location_type: string };
  }[];
}

/** Type-ahead suggestions, biased toward `near` (usually the current map centre). */
export async function suggestAddresses(
  text: string,
  near?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeSuggestion[]> {
  const query = text.trim();
  if (query.length < 3 || googleKey) {
    // Google type-ahead needs the Places API; with Google we search on submit instead.
    return [];
  }

  const params: Record<string, string> = { text: query, maxSuggestions: "6" };
  if (near) {
    params.location = `${near.lng},${near.lat}`;
  }
  const data = await getJson<EsriSuggestResponse>(`${ESRI_GEOCODER}/suggest?${esriParams(params)}`, signal);
  if (data.error) {
    throw new Error(data.error.message);
  }
  return (data.suggestions ?? []).filter((item) => !item.isCollection).map((item) => ({ text: item.text, key: item.magicKey }));
}

/** Resolves free text, or a suggestion picked from `suggestAddresses`, to map coordinates. Best match first. */
export async function geocodeAddress(
  text: string,
  suggestionKey = "",
  near?: { lat: number; lng: number }
): Promise<GeocodeResult[]> {
  const query = text.trim();
  if (!query) {
    return [];
  }

  if (googleKey) {
    const params = new URLSearchParams({ address: query, key: googleKey });
    const data = await getJson<GoogleGeocodeResponse>(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (data.status === "ZERO_RESULTS") {
      return [];
    }
    if (data.status !== "OK") {
      throw new Error(data.error_message ?? `Address search failed (${data.status}).`);
    }
    return data.results.map((result) => ({
      label: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      precision: result.geometry.location_type
    }));
  }

  const params: Record<string, string> = { singleLine: query, maxLocations: "5", outFields: "Addr_type" };
  if (suggestionKey) {
    params.magicKey = suggestionKey;
  }
  if (near) {
    params.location = `${near.lng},${near.lat}`;
  }
  const data = await getJson<EsriCandidatesResponse>(`${ESRI_GEOCODER}/findAddressCandidates?${esriParams(params)}`);
  if (data.error) {
    throw new Error(data.error.message);
  }
  return (data.candidates ?? [])
    .filter((candidate) => candidate.score >= 80)
    .map((candidate) => ({
      label: candidate.address,
      lat: candidate.location.y,
      lng: candidate.location.x,
      precision: candidate.attributes?.Addr_type ?? ""
    }));
}

/**
 * Zoom level that frames a result: the deepest sharp imagery level (19) for a house,
 * wider for streets and cities.
 */
export function zoomForPrecision(precision: string): number {
  if (["PointAddress", "Subaddress", "ROOFTOP", "RANGE_INTERPOLATED", "StreetAddress", "StreetInt"].includes(precision)) {
    return 19;
  }
  if (["StreetName", "GEOMETRIC_CENTER", "POI"].includes(precision)) {
    return 18;
  }
  if (["Postal", "PostalExt", "Neighborhood", "District"].includes(precision)) {
    return 15;
  }
  return 13;
}
