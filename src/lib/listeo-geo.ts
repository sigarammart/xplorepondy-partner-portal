import type { Category, ListingTaxTerm } from "@/lib/types";
import { categoryFromKindName } from "@/lib/listing-categories";
import { pickListingImage, uniqueImages } from "@/lib/media";
import { cachedOriginText } from "@/lib/origin-cache";
import { decodeEntities } from "@/lib/utils";

export type ListeoGeo = {
  slug: string;
  name: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviews?: number;
  address?: string;
  friendlyAddress?: string;
  image?: string;
  gallery?: string[];
  kind?: string;
  category?: Category;
  categoryTerms?: ListingTaxTerm[];
  id?: number;
  featured?: boolean;
};

function urlTail(url: string) {
  return url.split("/").filter(Boolean).pop() ?? "";
}

function decode(raw: string): string {
  return decodeEntities(raw.replace(/&#038;/g, "&"));
}

function categoryFromCard(kind: string, listingType: string): Category {
  const mapped = categoryFromKindName(kind);
  if (mapped) return mapped;
  const hay = `${kind} ${listingType}`.toLowerCase();
  if (/hotel|guest|stay|resort|homestay|villa|property/.test(hay)) return "stay";
  if (/cafe|restaurant|pub|bar|food|pizza|bakery|night/.test(hay)) return "food";
  if (/bike|rental|scuba|sport|adventure|activity|tour|kayak|workshop|class|photo|salon|spa/.test(hay)) {
    return "activities";
  }
  if (/beach|heritage|temple|church|ashram|museum|park|attraction|spiritual/.test(hay)) return "places";
  if (listingType === "rental") return "activities";
  return "places";
}

function hasValidGeo(value: { lat?: number; lng?: number } | undefined): value is { lat: number; lng: number } {
  return typeof value?.lat === "number"
    && Number.isFinite(value.lat)
    && value.lat >= -90
    && value.lat <= 90
    && typeof value.lng === "number"
    && Number.isFinite(value.lng)
    && value.lng >= -180
    && value.lng <= 180
    && !(value.lat === 0 && value.lng === 0);
}

export function parseListeoGeoHtml(html: string): ListeoGeo[] {
  const bySlug = new Map<string, ListeoGeo>();
  const chunks = html.split(/listing-geo-data/);

  for (const chunk of chunks.slice(1)) {
    const window = chunk.slice(0, 9000);
    const lat = Number(window.match(/data-latitude="([\d.-]+)"/)?.[1]);
    const lng = Number(window.match(/data-longitude="([\d.-]+)"/)?.[1]);
    const parsedGeo = { lat, lng };
    const hasGeo = hasValidGeo(parsedGeo);

    // Support absolute and relative listing links. A card can appear more
    // than once in AJAX HTML, so extract the slug before deduplicating.
    const href = window.match(/(?:https?:\/\/(?:www\.)?xplorepondy\.com)?\/listing\/([^"'/?#\s]+)/i);
    const slug = href?.[1] ? href[1].replace(/\/$/, "") : "";
    if (!slug) continue;

    const name = decode(window.match(/data-title="([^"]*)"/)?.[1] ?? "");
    const rating = Number(window.match(/data-rating="([\d.]+)"/)?.[1]);
    const reviews = Number(window.match(/data-reviews="(\d+)"/)?.[1]);
    const friendlyAddress = decode(window.match(/data-friendly-address="([^"]*)"/)?.[1] ?? "");
    const address = decode(window.match(/data-address="([^"]*)"/)?.[1] ?? "");
    const poster = window.match(/data-image="([^"]+)"/)?.[1];
    const slides = [...window.matchAll(/src="(https:\/\/xplorepondy\.com\/wp-content\/uploads\/[^"]+)"/g)].map(
      (m) => m[1],
    );
    const gallery = uniqueImages(slides);
    const image = pickListingImage(poster, gallery[0]);
    const listingType = window.match(/data-listing-type="([^"]*)"/)?.[1] ?? "";
    const categoryNames = [
      ...window.matchAll(/listing-category-tag-nl[^>]*>([^<]+)/gi),
    ]
      .flatMap((match) => decode(match[1] ?? "").split(","))
      .map((value) => value.trim())
      .filter(Boolean);

    const categorySlugsFromClasses = [
      ...window.matchAll(/(?:^|[\s"'])listing_category-([a-z0-9-]+)/gi),
    ].map((match) => match[1] ?? "").filter(Boolean);
    for (const categorySlug of categorySlugsFromClasses) {
      if (categoryNames.some((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-") === categorySlug)) continue;
      categoryNames.push(
        categorySlug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      );
    }
    const categoryTerms: ListingTaxTerm[] = [];
    const categorySeen = new Set<string>();
    for (const categoryName of categoryNames) {
      const categorySlug = categoryName
        .toLowerCase()
        .replace(/&/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!categorySlug || categorySeen.has(categorySlug)) continue;
      categorySeen.add(categorySlug);
      categoryTerms.push({ name: categoryName, slug: categorySlug });
    }
    const kind = categoryNames[0] ?? "";
    const id = Number(window.match(/data-post-id="(\d+)"/)?.[1] || window.match(/data-id="(\d+)"/)?.[1]);
    const featured =
      /<(?:div|span)[^>]*class="[^"]*\bfeatured-nl\b/.test(window) || /\bbadge-nl featured-nl\b/.test(window);

    const entry: ListeoGeo = {
      slug,
      name: name || slug,
      lat: hasGeo ? lat : undefined,
      lng: hasGeo ? lng : undefined,
      rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      reviews: Number.isFinite(reviews) && reviews > 0 ? reviews : undefined,
      address: address || undefined,
      friendlyAddress: friendlyAddress || undefined,
      image: image || undefined,
      gallery: gallery.length ? gallery : undefined,
      kind: kind || undefined,
      category: categoryFromCard(kind, listingType),
      categoryTerms: categoryTerms.length ? categoryTerms : undefined,
      id: Number.isFinite(id) && id > 0 ? id : undefined,
      featured: featured || undefined,
    };

    const previous = bySlug.get(slug);
    if (!previous) {
      bySlug.set(slug, entry);
      continue;
    }

    // Don't let a duplicate card without coordinates mask a later copy that
    // contains the listing's actual geo data.
    bySlug.set(slug, {
      ...previous,
      name: previous.name && previous.name !== slug ? previous.name : entry.name,
      lat: hasGeo ? lat : previous.lat,
      lng: hasGeo ? lng : previous.lng,
      rating: previous.rating ?? entry.rating,
      reviews: previous.reviews ?? entry.reviews,
      address: previous.address || entry.address,
      friendlyAddress: previous.friendlyAddress || entry.friendlyAddress,
      image: previous.image || entry.image,
      gallery: previous.gallery?.length ? previous.gallery : entry.gallery,
      kind: previous.kind || entry.kind,
      category: previous.category || entry.category,
      categoryTerms: previous.categoryTerms?.length ? previous.categoryTerms : entry.categoryTerms,
      id: previous.id ?? entry.id,
      featured: previous.featured || entry.featured,
    });
  }

  return [...bySlug.values()];
}

async function fetchListeoPage(
  page: number,
  perPage: number,
): Promise<{ html: string; pages: number; total: number }> {
  const url = `https://xplorepondy.com/wp-admin/admin-ajax.php?action=listeo_get_listings&page=${page}&per_page=${perPage}`;
  const empty = { html: "", pages: 1, total: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await cachedOriginText(url, 20 * 60 * 1000, 12000, {
        Accept: "application/json",
        "User-Agent": "XplorePondyApp/1.0",
      });
      if (!res.ok) continue;
      const data = JSON.parse(res.body) as {
        html?: string;
        max_num_pages?: number | string;
        total_found?: number | string;
      };
      return {
        html: data.html ?? "",
        pages: Math.max(1, Number(data.max_num_pages) || 1),
        total: Number(data.total_found) || 0,
      };
    } catch {
      /* retry */
    }
  }
  return empty;
}

function ingest(html: string, map: Map<string, ListeoGeo>) {
  for (const hit of parseListeoGeoHtml(html)) {
    const previous = map.get(hit.slug);
    if (!previous) {
      map.set(hit.slug, hit);
      continue;
    }

    // Keep coordinates found on any page occurrence. A later archive page can
    // contain a duplicate card without the geo attributes.
    const previousHasGeo = hasValidGeo(previous);
    const hitHasGeo = hasValidGeo(hit);
    map.set(hit.slug, {
      ...previous,
      name: previous.name && previous.name !== previous.slug ? previous.name : hit.name,
      lat: previousHasGeo ? previous.lat : hitHasGeo ? hit.lat : undefined,
      lng: previousHasGeo ? previous.lng : hitHasGeo ? hit.lng : undefined,
      rating: previous.rating ?? hit.rating,
      reviews: previous.reviews ?? hit.reviews,
      address: previous.address || hit.address,
      friendlyAddress: previous.friendlyAddress || hit.friendlyAddress,
      image: previous.image || hit.image,
      gallery: previous.gallery?.length ? previous.gallery : hit.gallery,
      kind: previous.kind || hit.kind,
      category: previous.category || hit.category,
      categoryTerms: previous.categoryTerms?.length ? previous.categoryTerms : hit.categoryTerms,
      id: previous.id ?? hit.id,
      featured: previous.featured || hit.featured,
    });
  }
}

export async function loadListeoGeo(): Promise<{ map: Map<string, ListeoGeo>; total: number }> {
  const map = new Map<string, ListeoGeo>();
  // REST supplies the complete catalog, while Listeo's geo feed supplies
  // the card-level data that is not reliably exposed through WP REST meta:
  // rating, review count, address, coordinates and the real listing image.
  // Load every geo page in parallel so the 564+ REST listings can be enriched
  // without making individual HTML requests for every listing.
  const first = await fetchListeoPage(1, 100);
  const total = first.total;
  const pages = Math.max(1, first.pages);
  ingest(first.html, map);
  const restPages = pages > 1
    ? await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) => fetchListeoPage(i + 2, 100)),
      )
    : [];
  for (const row of restPages) ingest(row.html, map);
  return { map, total: Math.max(total, map.size) };
}
