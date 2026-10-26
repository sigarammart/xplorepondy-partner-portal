/** Listeo (Purethemes CPT + CMB2 + CMB2 Field Slider) post meta. Not exposed on REST. */
export const LISTEO_META = {
  phone: "_phone",
  email: "_email",
  website: "_website",
  address: "_address",
  friendlyAddress: "_friendly_address",
  lat: "_geolocation_lat",
  lng: "_geolocation_long",
  gallery: "_gallery",
} as const;

export type ListeoContact = {
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  lat?: number;
  lng?: number;
};

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export function contactFromListeoMeta(meta: Record<string, unknown> | undefined): ListeoContact {
  if (!meta) return {};
  const lat = Number(meta[LISTEO_META.lat]);
  const lng = Number(meta[LISTEO_META.lng]);
  const website = firstString(meta[LISTEO_META.website]);
  const phone = firstString(meta[LISTEO_META.phone]);
  const email = firstString(meta[LISTEO_META.email]);
  const address = firstString(meta[LISTEO_META.address], meta[LISTEO_META.friendlyAddress]);
  return {
    phone: phone || undefined,
    email: email || undefined,
    website: website || undefined,
    address: address || undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
  };
}

export function websiteHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Prefer CMB2 `_address` (full Google Maps line) over `_friendly_address`. */
export function preferListeoAddress(...candidates: (string | undefined)[]) {
  const values = candidates.map((value) => value?.replace(/\s+/g, " ").trim()).filter(Boolean) as string[];
  if (!values.length) return undefined;
  const score = (value: string) => {
    let n = 0;
    if (/\b\d{6}\b/.test(value)) n += 8;
    if (/\bIndia\b/i.test(value)) n += 4;
    if (/,/.test(value)) n += (value.match(/,/g) ?? []).length * 2;
    n += Math.min(value.length, 120) / 20;
    return n;
  };
  return [...values].sort((a, b) => score(b) - score(a) || b.length - a.length)[0];
}
