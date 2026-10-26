export type LatLng = { lat: number; lng: number };

/** Central reference when the visitor has not shared GPS. */
export const ANNA_SALAI: LatLng = { lat: 11.9334, lng: 79.8296 };
export const ANNA_SALAI_LABEL = "Anna Salai";

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function formatDistance(km: number, fromGps = false): string {
  const amount =
    km < 0.1 ? null : km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  if (fromGps) {
    if (!amount) return "Nearby";
    return `${amount} away`;
  }
  if (!amount) return `At ${ANNA_SALAI_LABEL}`;
  return `${amount} from ${ANNA_SALAI_LABEL}`;
}

export function listingDistanceKm(origin: LatLng | null, listing: { lat?: number; lng?: number }): number | undefined {
  if (!origin || listing.lat == null || listing.lng == null) return undefined;
  if (!Number.isFinite(listing.lat) || !Number.isFinite(listing.lng)) return undefined;
  return haversineKm(origin, { lat: listing.lat, lng: listing.lng });
}
