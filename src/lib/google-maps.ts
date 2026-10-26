/** Browser Maps JS key — restrict by HTTP referrer in Google Cloud. */
export const GOOGLE_MAPS_KEY = "AIzaSyDmg7R_HkimYT2rDsGUozY4MzSfOUTMNGk";

type GoogleMapsNs = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap;
  Marker: new (opts: Record<string, unknown>) => GoogleMarker;
  LatLngBounds: new () => GoogleLatLngBounds;
  Polyline?: new (opts: Record<string, unknown>) => GooglePolyline;
  Route?: GoogleRouteClass;
  DirectionsService?: GoogleDirectionsServiceClass;
  Geocoder?: new () => GoogleGeocoder;
  SymbolPath: { CIRCLE: unknown };
  event: { clearInstanceListeners: (x: unknown) => void; trigger: (instance: unknown, eventName: string) => void };
  ColorScheme?: { DARK: string; LIGHT: string };
  RenderingType?: { RASTER: string; VECTOR: string };
};

export type GoogleMap = {
  setOptions: (opts: Record<string, unknown>) => void;
  setCenter: (c: { lat: number; lng: number }) => void;
  setZoom: (z: number) => void;
  getZoom: () => number | undefined;
  getBounds?: () => { getNorthEast: () => { lat: () => number; lng: () => number }; getSouthWest: () => { lat: () => number; lng: () => number } } | undefined;
  panTo: (c: { lat: number; lng: number }) => void;
  fitBounds: (b: GoogleLatLngBounds, pad?: number) => void;
  addListener: (ev: string, fn: () => void) => void;
};

export type GoogleMarker = {
  setMap: (m: GoogleMap | null) => void;
  setIcon: (icon: unknown) => void;
  setLabel: (label: unknown) => void;
  setZIndex: (z: number) => void;
  setPosition: (c: { lat: number; lng: number }) => void;
  addListener: (ev: string, fn: () => void) => void;
};

export type GoogleLatLngBounds = {
  extend: (c: { lat: number; lng: number }) => void;
};

export type GooglePolyline = {
  setMap: (m: GoogleMap | null) => void;
  setPath: (path: Array<{ lat: number; lng: number }>) => void;
};

export type GoogleRouteClass = {
  computeRoutes: (request: Record<string, unknown>) => Promise<{
    routes?: Array<{
      path?: Array<unknown>;
      legs?: Array<{ path?: Array<unknown> }>;
    }>;
  }>;
};

export type GoogleGeocoder = {
  geocode: (request: { address: string }, callback: (results: Array<{ geometry: { location: { lat: () => number; lng: () => number } } }> | null, status: string) => void) => void;
};

export type GoogleDirectionsServiceClass = new () => {
  route: (request: Record<string, unknown>) => Promise<{
    routes?: Array<{
      overview_path?: Array<unknown>;
      legs?: Array<{ overview_path?: Array<unknown> }>;
    }>;
  }>;
};

type MapsBootstrap = {
  Map?: GoogleMapsNs["Map"];
  Marker?: GoogleMapsNs["Marker"];
  LatLngBounds?: GoogleMapsNs["LatLngBounds"];
  Polyline?: GoogleMapsNs["Polyline"];
  Route?: GoogleMapsNs["Route"];
  DirectionsService?: GoogleMapsNs["DirectionsService"];
  Geocoder?: GoogleMapsNs["Geocoder"];
  SymbolPath?: GoogleMapsNs["SymbolPath"];
  event?: GoogleMapsNs["event"];
  ColorScheme?: GoogleMapsNs["ColorScheme"];
  RenderingType?: GoogleMapsNs["RenderingType"];
  importLibrary?: (name: string) => Promise<Record<string, unknown>>;
};

declare global {
  interface Window {
    google?: { maps: MapsBootstrap };
    gm_authFailure?: () => void;
  }
}

let loading: Promise<boolean> | null = null;
let authFailed = false;
let mapsNs: GoogleMapsNs | null = null;

export function googleMapsApi(): GoogleMapsNs | null {
  if (typeof window === "undefined" || authFailed) return null;
  if (mapsNs && typeof mapsNs.Map === "function") return mapsNs;
  return null;
}

function isReadyNs(ns: Partial<GoogleMapsNs> | null | undefined): ns is GoogleMapsNs {
  return !!ns && typeof ns.Map === "function" && typeof ns.Marker === "function" && typeof ns.LatLngBounds === "function";
}

async function resolveMapsNamespace(): Promise<GoogleMapsNs | null> {
  const bootstrap = window.google?.maps;
  if (!bootstrap) return null;
  try {
    let mapsLib: Record<string, unknown> = bootstrap as unknown as Record<string, unknown>;
    let markerLib: Record<string, unknown> = bootstrap as unknown as Record<string, unknown>;
    if (typeof bootstrap.importLibrary === "function") {
      mapsLib = await bootstrap.importLibrary("maps");
      try {
        markerLib = await bootstrap.importLibrary("marker");
      } catch {
        markerLib = (window.google?.maps ?? mapsLib) as unknown as Record<string, unknown>;
      }
      try {
        const routesLib = await bootstrap.importLibrary("routes");
        mapsLib = { ...mapsLib, Route: routesLib.Route, DirectionsService: routesLib.DirectionsService };
      } catch {
        /* Route library unavailable; map can still render without routing. */
      }
    }
    const root = window.google?.maps;
    const ns: Partial<GoogleMapsNs> = {
      Map: (mapsLib.Map ?? root?.Map) as GoogleMapsNs["Map"],
      Marker: (markerLib.Marker ?? mapsLib.Marker ?? root?.Marker) as GoogleMapsNs["Marker"],
      LatLngBounds: (mapsLib.LatLngBounds ?? root?.LatLngBounds) as GoogleMapsNs["LatLngBounds"],
      Polyline: (mapsLib.Polyline ?? root?.Polyline) as GoogleMapsNs["Polyline"],
      Route: (mapsLib.Route ?? root?.Route) as GoogleMapsNs["Route"],
      DirectionsService: (mapsLib.DirectionsService ?? root?.DirectionsService) as GoogleMapsNs["DirectionsService"],
      Geocoder: (mapsLib.Geocoder ?? root?.Geocoder) as GoogleMapsNs["Geocoder"],
      SymbolPath: (root?.SymbolPath ?? mapsLib.SymbolPath) as GoogleMapsNs["SymbolPath"],
      event: (root?.event ?? mapsLib.event) as GoogleMapsNs["event"],
      ColorScheme: (mapsLib.ColorScheme ?? root?.ColorScheme) as GoogleMapsNs["ColorScheme"],
      RenderingType: (mapsLib.RenderingType ?? root?.RenderingType) as GoogleMapsNs["RenderingType"],
    };
    return isReadyNs(ns) ? ns : null;
  } catch {
    return null;
  }
}

export function loadGoogleMaps(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (authFailed) return Promise.resolve(false);
  if (isReadyNs(mapsNs)) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    const existing = await resolveMapsNamespace();
    if (existing) {
      mapsNs = existing;
      return true;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const prev = window.gm_authFailure;
      window.gm_authFailure = () => {
        authFailed = true;
        try {
          prev?.();
        } catch {
          /* ignore */
        }
        finish();
      };
      const existingScript = document.querySelector<HTMLScriptElement>("script[data-xp-gmaps]");
      if (existingScript) {
        existingScript.addEventListener("load", () => finish());
        existingScript.addEventListener("error", () => finish());
        window.setTimeout(finish, 12000);
        if (window.google?.maps) finish();
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&v=weekly&loading=async`;
      script.async = true;
      script.defer = true;
      script.dataset.xpGmaps = "1";
      script.onload = () => finish();
      script.onerror = () => finish();
      document.head.appendChild(script);
      window.setTimeout(finish, 12000);
    });
    if (authFailed) return false;

    // The Maps script's onload can fire just before importLibrary() exposes
    // the complete namespace. Retry briefly instead of leaving the first
    // mounted map stuck on its loading overlay until the component remounts.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (authFailed) return false;
      mapsNs = await resolveMapsNamespace();
      if (isReadyNs(mapsNs)) return true;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    }
    mapsNs = null;
    return false;
  })();
  loading.then((ok) => {
    if (!ok) loading = null;
  });
  return loading;
}

export const GOOGLE_MAP_DARK = [
  { elementType: "geometry", stylers: [{ color: "#3b4d50" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#3b4d50" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#eef5f3" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#607477" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#dbe6e3" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#244348" }] },
];

export const GOOGLE_MAP_LIGHT = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c5dce0" }] },
];

type GooglePlaceReview = {
  authorAttribution?: {
    displayName?: string;
    uri?: string;
    photoURI?: string;
  };
  rating?: number;
  relativePublishTimeDescription?: string;
  text?: string | { text?: string };
};

type ModernGooglePlace = {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  location?: { lat: () => number; lng: () => number };
  rating?: number;
  userRatingCount?: number;
  googleMapsURI?: string;
  reviews?: GooglePlaceReview[];
  fetchFields: (request: { fields: string[] }) => Promise<void>;
};

type ModernGooglePlaceClass = {
  new (options: { id: string }): ModernGooglePlace;
  searchByText: (request: {
    textQuery: string;
    fields: string[];
    maxResultCount?: number;
    language?: string;
    region?: string;
  }) => Promise<{ places: ModernGooglePlace[] }>;
};

export type GooglePlacesLib = {
  Place?: ModernGooglePlaceClass;
  AutocompleteService?: new () => {
    getPlacePredictions: (
      req: Record<string, unknown>,
      cb: (preds: Array<{ description: string; place_id: string }> | null) => void,
    ) => void;
  };
  PlacesService?: new (el: HTMLElement) => {
    getDetails: (
      req: Record<string, unknown>,
      cb: (
        place:
          | {
              formatted_address?: string;
              name?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
              rating?: number;
              user_ratings_total?: number;
              url?: string;
              reviews?: Array<{
                author_name?: string;
                author_url?: string;
                profile_photo_url?: string;
                rating?: number;
                relative_time_description?: string;
                text?: string;
              }>;
            }
          | null,
        status?: string,
      ) => void,
    ) => void;
    findPlaceFromQuery?: (
      req: Record<string, unknown>,
      cb: (
        places: Array<{
          place_id?: string;
          name?: string;
          formatted_address?: string;
          rating?: number;
          user_ratings_total?: number;
          url?: string;
        }> | null,
        status?: string,
      ) => void,
    ) => void;
  };
  AutocompleteSuggestion?: {
    fetchAutocompleteSuggestions: (req: Record<string, unknown>) => Promise<{
      suggestions: Array<{
        placePrediction?: { text?: { text?: string }; placeId?: string };
      }>;
    }>;
  };
};

let placesLib: GooglePlacesLib | null = null;

export async function loadGooglePlaces(): Promise<GooglePlacesLib | null> {
  if (typeof window === "undefined" || authFailed) return null;
  if (placesLib?.PlacesService || placesLib?.AutocompleteService || placesLib?.AutocompleteSuggestion) return placesLib;
  await loadGoogleMaps();
  const bootstrap = window.google?.maps;
  if (!bootstrap) return null;
  try {
    if (typeof bootstrap.importLibrary === "function") {
      placesLib = (await bootstrap.importLibrary("places")) as GooglePlacesLib;
    } else {
      placesLib = (bootstrap as { places?: GooglePlacesLib }).places ?? null;
    }
  } catch {
    placesLib = (window.google?.maps as { places?: GooglePlacesLib } | undefined)?.places ?? null;
  }
  return placesLib;
}
