import { GOOGLE_MAPS_KEY, loadGooglePlaces } from "@/lib/google-maps";

export type PlaceSuggestion = {
  id: string;
  label: string;
  lat?: number;
  lng?: number;
};

const PONDY_BIAS = { lat: 11.934, lng: 79.832 };

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const googleHits = await searchGooglePlaces(q);
  if (googleHits.length) return googleHits;
  return searchNominatim(q);
}

/** Google Places-only autocomplete for forms that must not silently substitute OSM results. */
export async function searchGooglePlacesOnly(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return searchGooglePlaces(q);
}

function withPlacesTimeout<T>(promise: Promise<T>, ms = 3000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      () => { window.clearTimeout(timer); resolve(null); },
    );
  });
}

async function searchGooglePlaces(query: string): Promise<PlaceSuggestion[]> {
  const places = await loadGooglePlaces();
  if (!places) return [];

  // First use Google's current autocomplete endpoint, but never let a stalled
  // request keep the input spinner running indefinitely.
  if (places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
    try {
      const response = await withPlacesTimeout(places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        includedRegionCodes: ["in"],
        locationBias: { center: PONDY_BIAS, radius: 180000 },
      }), 3000);
      const hits = (response?.suggestions ?? []).map((suggestion) => ({
        id: suggestion.placePrediction?.placeId ?? "",
        label: suggestion.placePrediction?.text?.text ?? "",
      })).filter((hit) => hit.id && hit.label).slice(0, 6);
      if (hits.length) return hits;
    } catch {
      // Continue to the other Google Places search methods.
    }
  }

  if (places.AutocompleteService) {
    try {
      const service = new places.AutocompleteService();
      const response = await withPlacesTimeout(new Promise<Array<{ description: string; place_id: string }>>((resolve) => {
        service.getPlacePredictions({
          input: query,
          componentRestrictions: { country: "in" },
          location: PONDY_BIAS,
          radius: 180000,
        }, (results) => resolve(results ?? []));
      }), 3000);
      const hits = (response ?? []).slice(0, 6).map((row) => ({ id: row.place_id, label: row.description }));
      if (hits.length) return hits;
    } catch {
      // Continue to Google text search.
    }
  }

  // Google Places Text Search fallback helps when autocomplete predictions are
  // unavailable for a query but Google can still find the place by name.
  if (places.Place?.searchByText) {
    try {
      const response = await withPlacesTimeout(places.Place.searchByText({
        textQuery: query + ", Puducherry, India",
        fields: ["id", "displayName", "formattedAddress", "location"],
        maxResultCount: 6,
        language: "en",
        region: "IN",
      }), 3500);
      const hits = (response?.places ?? []).map((place) => ({
        id: place.id ?? "",
        label: [place.displayName, place.formattedAddress].filter(Boolean).join(", "),
        lat: place.location?.lat(),
        lng: place.location?.lng(),
      })).filter((hit) => hit.id && hit.label);
      if (hits.length) return hits;
    } catch {
      // Continue to the legacy text search.
    }
  }

  if (places.PlacesService) {
    try {
      const service = new places.PlacesService(document.createElement("div"));
      if (!service.findPlaceFromQuery) return [];
      const response = await withPlacesTimeout(new Promise<Array<{ place_id?: string; name?: string; formatted_address?: string }>>((resolve) => {
        service.findPlaceFromQuery!({
          query: query + ", Puducherry, India",
          fields: ["place_id", "name", "formatted_address"],
          locationBias: { center: PONDY_BIAS, radius: 180000 },
        }, (rows) => resolve(rows ?? []));
      }), 3000);
      return (response ?? []).filter((row) => row.place_id && (row.name || row.formatted_address))
        .slice(0, 6)
        .map((row) => ({ id: row.place_id!, label: [row.name, row.formatted_address].filter(Boolean).join(", ") }));
    } catch {
      return [];
    }
  }
  return [];
}
export async function resolvePlace(hit: PlaceSuggestion): Promise<PlaceSuggestion> {
  if (hit.lat != null && hit.lng != null) return hit;
  const details = await googlePlaceDetails(hit.id);
  if (details) return { ...hit, ...details, label: details.label || hit.label };
  const geo = await geocodeLabel(hit.label);
  return geo ?? hit;
}

async function googlePlaceDetails(placeId: string): Promise<PlaceSuggestion | null> {
  if (!placeId || placeId.startsWith("osm:")) return null;
  const places = await loadGooglePlaces();
  if (!places?.PlacesService) return null;
  try {
    const service = new places.PlacesService(document.createElement("div"));
    const place = await new Promise<{ formatted_address?: string; name?: string; geometry?: { location?: { lat: () => number; lng: () => number } } } | null>(
      (resolve) => {
        service.getDetails({ placeId, fields: ["geometry", "formatted_address", "name"] }, (row) => resolve(row));
      },
    );
    const loc = place?.geometry?.location;
    if (!loc) return null;
    return {
      id: placeId,
      label: place.formatted_address || place.name || "",
      lat: loc.lat(),
      lng: loc.lng(),
    };
  } catch {
    return null;
  }
}

async function searchNominatim(query: string): Promise<PlaceSuggestion[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=0&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ place_id: number; display_name: string; lat: string; lon: string }>;
    return rows.map((row) => ({
      id: `osm:${row.place_id}`,
      label: row.display_name,
      lat: Number(row.lat),
      lng: Number(row.lon),
    }));
  } catch {
    return [];
  }
}

async function geocodeLabel(label: string): Promise<PlaceSuggestion | null> {
  const hits = await searchNominatim(label);
  return hits[0] ?? null;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const row = (await res.json()) as { display_name?: string };
    return row.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

export function googleMapsKey() {
  return GOOGLE_MAPS_KEY;
}
