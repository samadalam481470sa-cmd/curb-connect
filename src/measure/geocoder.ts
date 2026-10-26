/**
 * Address search. With VITE_GOOGLE_MAPS_API_KEY set it uses Google Places autocomplete (the
 * suggestions Google Maps shows) and Google Geocoding; otherwise Esri's World Geocoding
 * Service, which also resolves house-number addresses worldwide.
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

interface GooglePlacesAutocompleteResponse {
  suggestions?: { placePrediction?: { placeId: string; text: { text: string } } }[];
  error?: { message: string };
}

interface GooglePlaceDetails {
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  error?: { message: string };
}

const GOOGLE_PLACE_PREFIX = "google-place:";

// Google bills autocomplete per session; one token covers the keystrokes and the final pick.
let placesSessionToken = crypto.randomUUID();

async function googlePlaceSuggestions(
  query: string,
  near: { lat: number; lng: number } | undefined,
  signal?: AbortSignal
): Promise<GeocodeSuggestion[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleKey! },
    body: JSON.stringify({
      input: query,
      sessionToken: placesSessionToken,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {})
    })
  });
  const data = (await response.json()) as GooglePlacesAutocompleteResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `Address search failed (${response.status}).`);
  }
  return (data.suggestions ?? [])
    .map((item) => item.placePrediction)
    .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction))
    .map((prediction) => ({ text: prediction.text.text, key: `${GOOGLE_PLACE_PREFIX}${prediction.placeId}` }));
}

async function googlePlaceDetails(placeId: string): Promise<GeocodeResult[]> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(placesSessionToken)}`;
  placesSessionToken = crypto.randomUUID();
  const response = await fetch(url, {
    headers: { "X-Goog-Api-Key": googleKey!, "X-Goog-FieldMask": "formattedAddress,location,types" }
  });
  const data = (await response.json()) as GooglePlaceDetails;
  if (!response.ok || data.error || !data.location) {
    throw new Error(data.error?.message ?? `Address lookup failed (${response.status}).`);
  }
  const isAddress = data.types?.some((type) => ["street_address", "premise", "subpremise"].includes(type));
  return [
    {
      label: data.formattedAddress ?? "",
      lat: data.location.latitude,
      lng: data.location.longitude,
      precision: isAddress ? "ROOFTOP" : "GEOMETRIC_CENTER"
    }
  ];
}

/** Type-ahead suggestions, biased toward `near` (usually the current map centre). */
export async function suggestAddresses(
  text: string,
  near?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeSuggestion[]> {
  const query = text.trim();
  if (query.length < 3) {
    return [];
  }
  if (googleKey) {
    return googlePlaceSuggestions(query, near, signal);
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

  if (googleKey && suggestionKey.startsWith(GOOGLE_PLACE_PREFIX)) {
    return googlePlaceDetails(suggestionKey.slice(GOOGLE_PLACE_PREFIX.length));
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
