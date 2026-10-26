import type { Listing } from "@/lib/types";

/** Prefer the original WP upload over Listeo crops like `-399x397.jpg`. */
export function uncropImage(url?: string): string {
  if (!url) return "";
  return url.replace(/-\d{2,4}x\d{2,4}(?=\.[a-zA-Z]+$)/, "");
}

export function isRemoteImage(url?: string): boolean {
  return !!url && /^https?:\/\//i.test(url) && /wp-content\/uploads|upload\.wikimedia\.org/i.test(url);
}

export function isLocalFallback(url?: string): boolean {
  return !!url && url.startsWith("/images/");
}

export function pickListingImage(...urls: Array<string | undefined>): string {
  const cleaned = urls.map((url) => uncropImage(url?.trim() ?? "")).filter(Boolean);
  const remote = cleaned.find((url) => isRemoteImage(url));
  if (remote) return remote;
  return cleaned.find((url) => !isLocalFallback(url)) ?? cleaned[0] ?? "";
}

export function uniqueImages(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      const url = uncropImage(raw);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}


/** Preserve WordPress gallery image URLs exactly as supplied. Some galleries only have
 * generated thumbnail files and the uncropped/original filename may not exist. */
export function uniqueGalleryImages(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      const url = raw?.trim() ?? "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

const LOCAL_GALLERY: Record<string, string[]> = {
  "promenade-beach": ["/images/promenade.jpg", "/images/lighthouse.jpg", "/images/beach.jpg"],
  "eden-beach": ["/images/beach.jpg", "/images/promenade.jpg"],
  "paradise-beach": ["/images/beach.jpg", "/images/surf.jpg"],
  "serenity-beach": ["/images/surf.jpg", "/images/beach.jpg"],
  "old-lighthouse": ["/images/lighthouse.jpg", "/images/promenade.jpg"],
  "gandhi-statue": ["/images/promenade.jpg", "/images/lighthouse.jpg"],
  "aayi-mandapam": ["/images/french-quarter.jpg", "/images/church.jpg"],
  "sri-aurobindo-ashram": ["/images/french-quarter.jpg", "/images/church.jpg"],
  "sacred-heart-basilica": ["/images/basilica.jpg", "/images/church.jpg"],
  "our-lady-of-angels": ["/images/church.jpg", "/images/french-quarter.jpg"],
  "immaculate-conception": ["/images/church.jpg", "/images/basilica.jpg"],
  "manakula-vinayagar": ["/images/temple.jpg", "/images/french-quarter.jpg"],
  "matrimandir-view": ["/images/matrimandir.jpg"],
  "auroville-matrimandir": ["/images/matrimandir.jpg"],
  auroville: ["/images/matrimandir.jpg"],
  "le-cafe": ["/images/promenade.jpg", "/images/cafe.jpg"],
  "baker-street": ["/images/cafe.jpg", "/images/french-quarter.jpg"],
  "coromandel-cafe": ["/images/cafe.jpg", "/images/hotel.jpg"],
  "cafe-des-arts": ["/images/cafe.jpg", "/images/french-quarter.jpg"],
  "villa-shanti": ["/images/hotel.jpg", "/images/french-quarter.jpg"],
};

export function listingPhotos(listing: Listing): string[] {
  // WordPress can return a generic/fallback featured image alongside the real
  // single gallery image. For a listing with exactly one gallery image, use
  // that image as the sole hero image instead of rendering the fallback as a
  // second thumbnail.
  if (listing.gallery?.length === 1) {
    return uniqueGalleryImages(listing.gallery, listing.menuImages);
  }

  return uniqueGalleryImages([listing.image], listing.gallery, listing.menuImages, LOCAL_GALLERY[listing.slug]);
}

export function listingCover(listing: Listing): string {
  const photos = listingPhotos(listing);
  return pickListingImage(...photos) || listing.image;
}

export function extractOgImage(html: string): string {
  const match =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
  const url = uncropImage(match?.[1] ?? "");
  return /^https?:\/\//i.test(url) ? url : "";
}
