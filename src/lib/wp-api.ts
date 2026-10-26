import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertSameSiteRequest } from "@/lib/auth/isolation.server";
import { getSessionUser } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { guides as localGuides } from "@/data/guides";
import { listings as localListings } from "@/data/listings";
import type { Category, Guide, GuideBlock, GuideSection, Listing, ListingFaq, ListingMetaGroup, ListingMetaItem, ListingStop, ListingTaxGroup, ListingTaxTerm } from "@/lib/types";
import { hoursStatusFromLabel, isOpenAt, parseListeoOpeningHourMeta, parseOpenHoursHtml, parseOpenHoursMeta } from "@/lib/hours";
import { bookmarkIdsFromUserMeta } from "@/lib/jet-store";
import { WP_PARENT_ARCHIVES, archiveCategory, categoryFromKindName, type ListingCategoryTerm } from "@/lib/listing-categories";
import { contactFromListeoMeta, preferListeoAddress } from "@/lib/listeo";
import { cachedOriginText } from "@/lib/origin-cache";
import { loadListeoGeo, type ListeoGeo } from "@/lib/listeo-geo";
import { filterListingGroups, headingMatchesProfile, profileFromSlugs, profileKeys, type ListingFieldProfile } from "@/lib/listing-layouts";
import { extractOgImage, pickListingImage, uncropImage, uniqueImages } from "@/lib/media";
import { signWpIdentityToken, verifyWpIdentityToken } from "@/lib/wp-identity-token.server";

export const WP_ORIGIN = "https://xplorepondy.com";
export const WP_APP_PASSWORD_URL = `${WP_ORIGIN}/wp-admin/authorize-application.php?app_name=Xplore%20Pondy%20App`;

export type WpListingFacetOption = { value: string; slug: string; count: number; listingIds: number[] };
export type WpListingFacetField = { id: string; label: string; type: "checkbox" | "radio"; options: WpListingFacetOption[] };
export type WpListingFacets = { category: string; fields: WpListingFacetField[]; generated_at?: string };

/** Fetch the public facet registry server-side so app.xplorepondy.com does not depend on browser CORS. */
export const fetchWpListingFacets = createServerFn({ method: "GET" })
  .validator(z.object({ category: z.enum(["all", "places", "activities", "food", "rentals", "stay", "services"]) }))
  .handler(async ({ data }): Promise<WpListingFacets> => {
    const url = new URL("/wp-json/xplore/v1/listing-facets", WP_ORIGIN);
    url.searchParams.set("category", data.category);
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("WordPress listing facets are unavailable.");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("Invalid WordPress facet response.");
    const body = payload as Record<string, unknown>;
    const fields = Array.isArray(body.fields) ? body.fields.flatMap((entry): WpListingFacetField[] => {
      if (!entry || typeof entry !== "object") return [];
      const field = entry as Record<string, unknown>;
      if (typeof field.id !== "string" || typeof field.label !== "string" || (field.type !== "checkbox" && field.type !== "radio") || !Array.isArray(field.options)) return [];
      const options = field.options.flatMap((raw): WpListingFacetOption[] => {
        if (!raw || typeof raw !== "object") return [];
        const option = raw as Record<string, unknown>;
        if (typeof option.value !== "string" || typeof option.slug !== "string") return [];
        const count = Number(option.count);
        if (!Number.isFinite(count) || count < 1) return [];
        const listingIds = Array.isArray(option.listing_ids)
          ? [...new Set(option.listing_ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
          : [];
        return [{ value: option.value, slug: option.slug, count, listingIds }];
      });
      return options.length ? [{ id: field.id, label: field.label, type: field.type, options }] : [];
    }) : [];
    return { category: typeof body.category === "string" ? body.category : data.category, fields, generated_at: typeof body.generated_at === "string" ? body.generated_at : undefined };
  });

export type ListeoBookingSlot = {
  id: string;
  start: string;
  end: string;
  available: boolean;
  availableCount?: number;
};

export type ListeoBookingDate = {
  value: string;
  slots: ListeoBookingSlot[];
};

function extractListeoBookingPlusNonce(html: string): string | undefined {
  // Booking Plus localizes its AJAX nonce as part of the `lbpData` object.
  // Fetching the page with the authenticated WordPress cookie is important:
  // WordPress nonces are user/session scoped, so a nonce generated for an
  // anonymous visitor cannot reliably be reused for the logged-in account.
  const localizedMatch = html.match(
    /(?:var|let|const)\s+lbpData\s*=\s*(\{[\s\S]*?\});/i,
  );
  if (localizedMatch?.[1]) {
    try {
      const data = JSON.parse(localizedMatch[1]) as { nonce?: unknown };
      if (typeof data.nonce === "string" && data.nonce.trim()) {
        return data.nonce.trim();
      }
    } catch {
      // Fall through to the targeted nonce pattern below. WordPress
      // localization can contain values that make a direct JSON parse
      // unsuitable on some older Listeo templates.
    }
  }

  const scoped = html.match(
    /(?:lbpData|\bnonce)\b[\s\S]{0,20000}?['"]nonce['"]\s*:\s*['"]([^'"]+)['"]/i,
  );
  if (scoped?.[1]) return scoped[1].trim();

  const direct = html.match(/["']nonce["']\s*:\s*["']([^"']+)["']/i);
  return direct?.[1]?.trim() || undefined;
}

async function loadListeoBookingPlusNonce(
  listingUrlValue: string,
  cookie: string,
): Promise<string> {
  const listingUrl = new URL(listingUrlValue, WP_ORIGIN);
  if (listingUrl.origin !== new URL(WP_ORIGIN).origin) {
    throw new Error("Invalid Listeo listing origin");
  }

  const response = await fetch(listingUrl.toString(), {
    headers: {
      ...WP_HTML_HEADERS,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Listeo listing could not be loaded (HTTP ${response.status}).`);
  }

  const nonce = extractListeoBookingPlusNonce(await response.text());
  if (!nonce) {
    throw new Error(
      "Listeo Booking Plus did not expose its booking nonce on the listing page. Make sure Listeo Booking Plus is active and the Book Now widget is rendered for this listing.",
    );
  }
  return nonce;
}

function stripBookingHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function listeoAjax(action: string, fields: Record<string, string | number>) {
  const body = new URLSearchParams({
    action,
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(WP_ORIGIN + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": WP_HTML_HEADERS["User-Agent"],
        Referer: WP_ORIGIN + "/",
      },
      body,
      signal: AbortSignal.timeout(12000),
    });
    const text = await response.text();
    if (!response.ok) {
      if (attempt === 0 && (response.status === 403 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        continue;
      }
      return null;
    }
    try {
      const payload = JSON.parse(text) as { success?: boolean; data?: unknown };
      return payload.success ? payload.data : null;
    } catch {
      return text.trim() ? text : null;
    }
  }
  return null;
}

function extractListeoBookingNonce(html: string): string | undefined {
  const patterns = [
    /<input\b[^>]*(?:name|id)=["']listeo_booking_nonce["'][^>]*value=["']([^"']+)["'][^>]*>/i,
    /listeo_booking_nonce[\s:=\"']+([a-zA-Z0-9_-]{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return undefined;
}
function parseListeoSlotHtml(html: string): ListeoBookingSlot[] {
  const slots: ListeoBookingSlot[] = [];
  const pattern = /<div\b[^>]*class=["'][^"']*\btime-slot\b[^"']*["'][^>]*>[\s\S]*?<input\b[^>]*id=["']([^"']+)["'][^>]*>[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/div>/gi;
  for (const match of html.matchAll(pattern)) {
    const label = stripBookingHtml(match[2] ?? "");
    const parts = label.split(/\s+-\s+/);
    if (parts.length < 2) continue;
    const countText = stripBookingHtml(match[3] ?? "");
    const countMatch = countText.match(/(\d+)/);
    const availableCount = countMatch ? Number(countMatch[1]) : undefined;
    slots.push({
      id: match[1],
      start: parts[0].trim(),
      end: parts.slice(1).join(" - ").trim(),
      available: availableCount == null || availableCount > 0,
      availableCount,
    });
  }
  return slots;
}

function parseListeoAvailabilityRanges(data: unknown): ListeoBookingSlot[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const start = String(value.start ?? "").split(" ").slice(1).join(" ").trim();
    const end = String(value.end ?? "").split(" ").slice(1).join(" ").trim();
    if (!start || !end) return [];
    return [{ id: "range-" + index + "-" + start + "-" + end, start, end, available: true }];
  });
}

type ListeoBookingContext = {
  at: number;
  bookingNonce?: string;
  listeoBookingNonce?: string;
};

const bookingContextCache = new Map<string, ListeoBookingContext>();
const bookingContextInflight = new Map<string, Promise<ListeoBookingContext>>();
const BOOKING_CONTEXT_TTL = 8 * 60_000;

async function loadListeoBookingContext(listingUrlValue: string): Promise<ListeoBookingContext> {
  const listingUrl = new URL(listingUrlValue, WP_ORIGIN);
  if (listingUrl.origin !== new URL(WP_ORIGIN).origin) {
    throw new Error("Invalid Listeo listing origin");
  }
  const key = listingUrl.toString();
  const cached = bookingContextCache.get(key);
  if (cached && Date.now() - cached.at < BOOKING_CONTEXT_TTL && cached.bookingNonce) {
    return cached;
  }
  const inflight = bookingContextInflight.get(key);
  if (inflight) return inflight;

  const request = (async () => {
    const response = await fetch(key, {
      headers: WP_HTML_HEADERS,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      throw new Error(`Listeo listing could not be loaded (HTTP ${response.status}).`);
    }
    const html = await response.text();
    const next: ListeoBookingContext = {
      at: Date.now(),
      bookingNonce: extractListeoBookingPlusNonce(html),
      listeoBookingNonce: extractListeoBookingNonce(html),
    };
    bookingContextCache.set(key, next);
    return next;
  })();

  bookingContextInflight.set(key, request);
  try {
    return await request;
  } finally {
    bookingContextInflight.delete(key);
  }
}

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return out;
}

export const fetchListeoBookingAvailability = createServerFn({ method: "POST" })
  .validator(
    z.object({
      listingId: z.number().int().positive(),
      listingUrl: z.string().url(),
      listingType: z.enum(["rental", "service", "event"]).optional(),
      dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(14),
    }),
  )
  .handler(async ({ data }) => {
    // Slot AJAX is only for service listings with configured time slots.
    // Rentals use Listeo's generic check_avaliabity endpoint, which checks
    // booked date ranges through the rental booking calendar.
    void loadListeoBookingContext(data.listingUrl).catch(() => undefined);

    let failedRequests = 0;
    const dates = await mapPool(data.dates, 4, async (date) => {
      try {
        if (data.listingType === "rental" || data.listingType === "event") {
          const result = await listeoAjax("check_avaliabity", {
            listing_id: data.listingId,
            listing_type: data.listingType,
            date_start: date,
            date_end: date,
          });
          if (!result || typeof result !== "object") {
            failedRequests += 1;
            return { value: date, slots: [] } satisfies ListeoBookingDate;
          }

          const payload = result as Record<string, unknown>;
          const freePlaces = Number(payload.free_places ?? 0);
          if (!Number.isFinite(freePlaces) || freePlaces <= 0) {
            return { value: date, slots: [] } satisfies ListeoBookingDate;
          }

          // The BookingPanel expects a selectable slot. For rental/event
          // listings there is no service time-slot; represent the bookable
          // date as one full-day selection. Listeo's booking endpoint still
          // receives the actual selected date.
          return {
            value: date,
            slots: [{
              id: "full-day",
              start: "00:00",
              end: "23:59",
              available: true,
              availableCount: freePlaces,
            }],
          } satisfies ListeoBookingDate;
        }

        const slotHtml = await listeoAjax("update_slots", {
          listing_id: data.listingId,
          date_start: date,
          date_end: date,
        });
        const slots = typeof slotHtml === "string" ? parseListeoSlotHtml(slotHtml) : [];
        if (slotHtml == null) failedRequests += 1;
        return { value: date, slots } satisfies ListeoBookingDate;
      } catch {
        failedRequests += 1;
        return { value: date, slots: [] } satisfies ListeoBookingDate;
      }
    });

    if (failedRequests === data.dates.length) {
      throw new Error("Listeo live availability endpoint could not be reached.");
    }
    return { ok: true as const, dates };
  });

async function loadListeoBookingConfirmationData(listingUrlValue: string) {
  const listingUrl = new URL(listingUrlValue, WP_ORIGIN);
  if (listingUrl.origin !== new URL(WP_ORIGIN).origin) {
    throw new Error("Invalid Listeo listing origin");
  }
  const response = await fetch(listingUrl.toString(), {
    headers: WP_HTML_HEADERS,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Listeo listing could not be loaded");

  const html = await response.text();
  const formMatch = html.match(/<form\b[^>]*\bid=["']form-booking["'][^>]*>[\s\S]*?<\/form>/i);
  const formHtml = formMatch?.[0] ?? "";
  const actionMatch = formHtml.match(/\baction=["']([^"']+)["']/i);
  const actionUrl = actionMatch?.[1]
    ? new URL(decodeHtml(actionMatch[1]), listingUrl)
    : new URL("/booking-confirmation/", WP_ORIGIN);

  if (actionUrl.origin !== new URL(WP_ORIGIN).origin) {
    throw new Error("Invalid Listeo booking confirmation origin");
  }

  const hiddenFields: Record<string, string> = {};
  const hiddenSource = formHtml || html;
  for (const input of hiddenSource.matchAll(/<input\b[^>]*type=["']hidden["'][^>]*>/gi)) {
    const tag = input[0];
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    hiddenFields[name] = decodeHtml(tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "");
  }

  // Listeo does not always render the WooCommerce product as a hidden
  // <input>. Depending on the installed Listeo template/version it can be
  // emitted as a data attribute or as a JavaScript/config value instead.
  // Capture only values explicitly associated with "product_id".
  const productIds = new Set<number>();
  const productPatterns = [
    /(?:name|id)=["']product_id(?:\[\d+\])?["'][^>]*\bvalue=["'](\d+)["']/gi,
    /\bdata-product[_-]?id=["'](\d+)["']/gi,
    /\bproduct_id(?:\[[^\]]+\])?["']?\s*[:=]\s*["']?(\d+)["']?/gi,
    /["']product_id["']\s*[:=]\s*["'](\d+)["']/gi,
  ];
  for (const pattern of productPatterns) {
    for (const match of html.matchAll(pattern)) {
      const id = Number(match[1]);
      if (Number.isInteger(id) && id > 0) productIds.add(id);
    }
  }

  // Prefer product IDs found inside the booking form when there are multiple
  // page-level references.
  const formProductIds = new Set<number>();
  for (const pattern of productPatterns) {
    for (const match of formHtml.matchAll(pattern)) {
      const id = Number(match[1]);
      if (Number.isInteger(id) && id > 0) formProductIds.add(id);
    }
  }

  return {
    actionUrl: actionUrl.toString(),
    hiddenFields,
    productIds: formProductIds.size ? [...formProductIds] : [...productIds],
  };
}


export type ListeoBookingQuote = {
  total: number;
  lines: Array<{
    label: string;
    sublabel?: string;
    amount: number;
    amountFormatted: string;
    isDiscount?: boolean;
  }>;
};

export const fetchListeoBookingQuote = createServerFn({ method: "POST" })
  .validator(
    z.object({
      listingId: z.number().int().positive(),
      listingUrl: z.string().url(),
      nonce: z.string().min(1).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slotStart: z.string().min(1),
      slotEnd: z.string().min(1),
      adults: z.number().int().nonnegative(),
      children: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ data }) => {
    const context = await loadListeoBookingContext(data.listingUrl).catch(() => undefined);
    const nonce = context?.bookingNonce || data.nonce;
    if (!nonce) {
      throw new Error("Listeo Booking Plus did not expose its booking nonce on the listing page.");
    }
    const fields = new URLSearchParams();
    fields.set("action", "lbp_check_availability_and_price");
    fields.set("nonce", nonce);
    fields.set("listing_id", String(data.listingId));
    fields.set("resource_id", "0");
    fields.set("date_start", data.date);
    fields.set("date_end", data.date);
    fields.set("slot", `${data.slotStart} - ${data.slotEnd}`);
    fields.set("adults", String(data.adults));
    fields.set("children", String(data.children));
    fields.set("coupon", "");

    const response = await fetch(WP_ORIGIN + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": WP_HTML_HEADERS["User-Agent"],
        Referer: data.listingUrl,
      },
      body: fields,
      signal: AbortSignal.timeout(20000),
    });

    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: Record<string, unknown> }
      | null;

    if (!response.ok || !payload?.success || !payload.data) {
      const message =
        typeof payload?.data?.error === "string"
          ? payload.data.error
          : `Listeo could not calculate the booking price (HTTP ${response.status}).`;
      throw new Error(message);
    }

    if (payload.data.available === false) {
      throw new Error(
        typeof payload.data.error === "string"
          ? payload.data.error
          : "The selected time is no longer available.",
      );
    }

    const total = Number(payload.data.price_raw ?? 0);
    if (!Number.isFinite(total)) {
      throw new Error("Listeo returned an invalid booking price.");
    }

    const rawBreakdown =
      payload.data.breakdown &&
      typeof payload.data.breakdown === "object" &&
      Array.isArray((payload.data.breakdown as Record<string, unknown>).lines)
        ? (payload.data.breakdown as Record<string, unknown>).lines
        : [];

    const lines = rawBreakdown.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const amount = Number(row.amount ?? 0);
      const label = String(row.label ?? "").trim();
      if (!label || !Number.isFinite(amount)) return [];
      return [{
        label,
        sublabel: typeof row.sublabel === "string" ? row.sublabel : undefined,
        amount,
        amountFormatted: String(row.amount_formatted ?? ""),
        isDiscount: Boolean(row.is_discount),
      }];
    });

    return {
      ok: true as const,
      quote: { total, lines } satisfies ListeoBookingQuote,
    };
  });

export const fetchListeoBookingConfirmationUrl = createServerFn({ method: "POST" })
  .validator(z.object({ listingUrl: z.string().url() }))
  .handler(async ({ data }) => loadListeoBookingConfirmationData(data.listingUrl));

async function fetchWpBookingSessionCookie(email: string): Promise<{ cookie: string; username?: string } | undefined> {
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) return undefined;

  const response = await fetch(`${WP_ORIGIN}/wp-json/xplore/v1/pwa/session`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
    signal: AbortSignal.timeout(12000),
  });

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; logged_in_cookie?: string }
    | null;

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "The WordPress booking bridge rejected the PWA secret. WP_SOCIAL_SESSION_BRIDGE_SECRET and XPLORE_PWA_SESSION_SECRET must contain the same value.",
    );
  }
  if (response.status === 404) {
    throw new Error(
      "The WordPress booking session bridge is not installed. Install/activate the xplore-pwa-booking-bridge plugin on xplorepondy.com.",
    );
  }
  if (!response.ok || !body?.logged_in_cookie) {
    throw new Error("Could not establish the WordPress booking session for this account.");
  }

  return {
    cookie: body.logged_in_cookie,
    username: typeof (body as { username?: unknown }).username === "string" ? String((body as { username?: string }).username).trim() : undefined,
  };
}

export type WpPaymentOrder = {
  id: number;
  status: string;
  needsPayment: boolean;
  currencyCode: string;
  currencySymbol: string;
  currencyMinorUnit: number;
  total: string;
  subtotal: string;
  billingEmail: string;
  billingFirstName: string;
  billingLastName: string;
  billingPhone: string;
  items: Array<{
    id?: number;
    name: string;
    quantity: number;
    total: string;
    metadata: Array<{ key: string; value: string }>;
  }>;
  paymentUrl: string;
  orderKey: string;
};

function parseWooPaymentUrl(paymentUrlValue: string) {
  const paymentUrl = new URL(paymentUrlValue, WP_ORIGIN);
  if (paymentUrl.origin !== new URL(WP_ORIGIN).origin) {
    throw new Error("Invalid WooCommerce payment URL.");
  }
  const match = paymentUrl.pathname.match(/\/order-pay\/(\d+)\/?$/i);
  const orderId = Number(match?.[1] ?? 0);
  const key = paymentUrl.searchParams.get("key")?.trim() ?? "";
  if (!orderId || !key) {
    throw new Error("The WooCommerce payment URL is missing the order ID or payment key.");
  }
  return { paymentUrl, orderId, key };
}

function normalizeWooAddress(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => String(source[key] ?? "").trim();
  return {
    first_name: text("first_name"),
    last_name: text("last_name"),
    company: text("company"),    address_1: text("address_1"),
    address_2: text("address_2"),
    city: text("city"),
    state: text("state"),
    postcode: text("postcode"),
    // Listeo booking orders can leave WooCommerce address fields blank.
    // The PWA is currently serving Indian bookings, so never submit an empty
    // country to Store API checkout.
    country: text("country") || "IN",
    phone: text("phone"),
    email: text("email"),
  };
}

export const fetchWpPaymentOrder = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      paymentUrl: z.string().url(),
      email: z.string().email(),
    }),
  )
  .handler(async ({ data }) => {
    const { paymentUrl, orderId, key } = parseWooPaymentUrl(data.paymentUrl);
    // Store API order access is scoped to the current WooCommerce
    // customer session. The order key alone is not enough for a registered
    // customer when this server request has no browser WP cookie.
    const wpSession = await fetchWpBookingSessionCookie(data.email.trim().toLowerCase());
    const url = new URL(`${WP_ORIGIN}/wp-json/wc/store/v1/order/${orderId}`);
    url.searchParams.set("key", key);

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        ...(wpSession?.cookie ? { Cookie: wpSession.cookie } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) {
      throw new Error(
        typeof body?.message === "string"
          ? body.message
          : `WooCommerce could not load order #${orderId} (HTTP ${response.status}).`,
      );
    }

    const totals = body.totals && typeof body.totals === "object" ? body.totals as Record<string, unknown> : {};
    const billing = normalizeWooAddress(body.billing_address);
    const items = Array.isArray(body.items)
      ? body.items.map((item) => {
          const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
          const itemTotals = row.totals && typeof row.totals === "object" ? row.totals as Record<string, unknown> : {};
          const metadata = Array.isArray(row.item_data)
            ? row.item_data.map((entry) => {
                const meta = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                return {
                  key: String(meta.display_key ?? meta.key ?? ""),
                  value: stripBookingHtml(String(meta.display_value ?? meta.value ?? "")),
                };
              }).filter((entry) => entry.key)
            : [];
          return {
            id: typeof row.id === "number" ? row.id : undefined,
            name: decodeHtml(String(row.name ?? "Item")),
            quantity: Number(row.quantity ?? 1) || 1,
            total: String(itemTotals.line_total ?? "0"),
            metadata,
          };
        })
      : [];

    return {
      ok: true as const,
      paymentUrl: paymentUrl.toString(),
      order: {
        id: orderId,
        status: String(body.status ?? "pending"),
        needsPayment: body.needs_payment !== false,
        currencyCode: String(totals.currency_code ?? "INR"),
        currencySymbol: String(totals.currency_symbol ?? "₹"),
        currencyMinorUnit: Number(totals.currency_minor_unit ?? 2) || 2,
        total: String(totals.total_price ?? "0"),
        subtotal: String(totals.subtotal ?? "0"),
        billingEmail: billing.email || data.email.trim().toLowerCase(),
        billingFirstName: billing.first_name,
        billingLastName: billing.last_name,
        billingPhone: billing.phone,
        items,
        paymentUrl: paymentUrl.toString(),
        orderKey: key,
      } satisfies WpPaymentOrder,
    };
  });

function extractWooPayNonce(html: string): string | undefined {
  const match = html.match(
    /name=["']woocommerce-pay-nonce["'][^>]*value=["']([^"']+)["']/i,
  );
  return match?.[1]?.trim() || undefined;
}

export const processWpPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      paymentUrl: z.string().url(),
      email: z.string().email(),
      paymentMethod: z.enum(["cod"]),
    }),
  )
  .handler(async ({ data }) => {
    const { paymentUrl, orderId } = parseWooPaymentUrl(data.paymentUrl);
    const wpSession = await fetchWpBookingSessionCookie(data.email.trim().toLowerCase());

    // Use WooCommerce's native /order-pay form handler rather than the Store
    // API checkout-order endpoint. Listeo creates reservation orders without
    // a shipping address, while Store API checkout requires a complete
    // billing/shipping address even for an offline reservation payment.
    // Native WooCommerce pay-for-order already knows the order and customer
    // and does not require us to invent an address.
    const paymentPageResponse = await fetch(paymentUrl.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        ...(wpSession?.cookie ? { Cookie: wpSession.cookie } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!paymentPageResponse.ok) {
      throw new Error(
        `WooCommerce payment page could not be loaded for order #${orderId} (HTTP ${paymentPageResponse.status}).`,
      );
    }

    const paymentPageHtml = await paymentPageResponse.text();
    const nonce = extractWooPayNonce(paymentPageHtml);
    const paymentPageCookie = paymentPageResponse.headers.get("set-cookie")?.trim() ?? "";
    const paymentCookie = [wpSession?.cookie ?? "", paymentPageCookie]
      .filter(Boolean)
      .join("; ");
    if (!nonce) {
      throw new Error(
        "WooCommerce did not expose its native payment nonce. The order may no longer be payable.",
      );
    }

    const fields = new URLSearchParams();
    fields.set("payment_method", data.paymentMethod);
    fields.set("woocommerce_pay", "1");
    fields.set("woocommerce-pay-nonce", nonce);

    const response = await fetch(paymentUrl.toString(), {
      method: "POST",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": WP_HTML_HEADERS["User-Agent"],
        Referer: paymentUrl.toString(),
        ...(paymentCookie ? { Cookie: paymentCookie } : {}),
      },
      body: fields,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });

    const redirectLocation = response.headers.get("location")?.trim() ?? "";
    if (response.status >= 300 && response.status < 400 && redirectLocation) {
      const redirectUrl = new URL(redirectLocation, WP_ORIGIN);
      if (redirectUrl.origin !== new URL(WP_ORIGIN).origin) {
        throw new Error("WooCommerce returned an invalid payment redirect.");
      }

      return {
        ok: true as const,
        orderId,
        status: "processing",
        redirectUrl: redirectUrl.toString(),
        paymentStatus: "success",
      };
    }

    const responseHtml = await response.text();
    const notice = responseHtml.match(
      /class=["'][^"']*woocommerce-error[^"']*["'][^>]*>[\s\S]*?<li[^>]*>([\s\S]*?)<\/li>/i,
    );
    if (notice?.[1]) {
      throw new Error(stripBookingHtml(notice[1]));
    }

    throw new Error(
      `WooCommerce could not process payment for order #${orderId} (HTTP ${response.status}).`,
    );
  });

export const submitListeoBooking = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      listingUrl: z.string().url(),
      listingId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slotStart: z.string().min(1),
      slotEnd: z.string().min(1),
      slotCapacity: z.number().int().positive(),
      adults: z.number().int().min(0),
      children: z.number().int().min(0),
      infants: z.number().int().min(0),
      username: z.string(),
      password: z.string(),
      firstName: z.string().min(1),
      lastName: z.string(),
      email: z.string().email(),
      phone: z.string().min(1),
      message: z.string(),
    }),
  )
  .handler(async ({ data, context }) => {
    const accountUsers = await getSql().then((sql) => sql.query<{ email?: string }>('select "email" from "user" where "id" = $1 limit 1', [context.userId]));
    const accountEmail = String(accountUsers[0]?.email ?? "").trim().toLowerCase();
    if (!accountEmail) throw new Error("Your Xplore Pondy account does not have an email address available for booking.");
    const bookingEmail = accountEmail;

    // Booking Plus has its own authoritative AJAX booking endpoint. Do not
    // submit the legacy /booking-confirmation/ form and then search recent
    // WooCommerce orders: that loses the exact booking_id -> order_id
    // correlation that Listeo already creates in bookings_calendar.
    const wpSession = await fetchWpBookingSessionCookie(bookingEmail);
    const nonce = await loadListeoBookingPlusNonce(data.listingUrl, wpSession.cookie);

    const slot = `${data.slotStart} - ${data.slotEnd}`;
    const hhmmRe = /^\\d{2}:\\d{2}$/;
    const fields = new URLSearchParams();
    const append = (key: string, value: string | number) => {
      fields.set(key, String(value));
    };

    append("action", "lbp_submit_booking");
    append("nonce", nonce);
    append("listing_id", data.listingId);
    append("resource_id", 0);
    append("preferred_resource_id", 0);
    append("date_start", data.date);
    append("date_end", data.date);
    append("slot", slot);
    append("hour_start", hhmmRe.test(data.slotStart) ? data.slotStart : "");
    append("hour_end", hhmmRe.test(data.slotEnd) ? data.slotEnd : "");
    append("adults", data.adults);
    append("children", data.children);
    append("firstname", data.firstName);
    append("lastname", data.lastName);
    append("email", bookingEmail);
    append("phone", data.phone);
    append("message", data.message);
    append("privacy_policy", "on");

    const response = await fetch(WP_ORIGIN + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": WP_HTML_HEADERS["User-Agent"],
        Referer: data.listingUrl,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: wpSession.cookie,
      },
      body: fields,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });

    const rawBody = await response.text();
    let body: {
      success?: boolean;
      data?: {
        booking_id?: number | string;
        status?: string;
        message?: string;
        redirect_url?: string;
      };
    } | null = null;

    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      body = null;
    }

    if (!response.ok) {
      throw new Error(
        body?.data?.message ||
          `Listeo Booking Plus submission failed (HTTP ${response.status}).`,
      );
    }

    if (!body?.success) {
      throw new Error(
        body?.data?.message ||
          "Listeo Booking Plus rejected the booking request.",
      );
    }

    const bookingId = Number(body.data?.booking_id ?? 0);
    const paymentUrl = typeof body.data?.redirect_url === "string"
      ? body.data.redirect_url.trim()
      : "";

    if (!bookingId) {
      throw new Error(
        body.data?.message ||
          "Listeo Booking Plus accepted the request but did not return a booking ID.",
      );
    }

    const orderIdMatch = paymentUrl.match(/\/order-pay\/(\d+)\/?/i);
    const orderId = orderIdMatch ? Number(orderIdMatch[1]) : undefined;

    return {
      ok: true as const,
      bookingId,
      orderId,
      paymentUrl,
      bookingUrl: paymentUrl || undefined,
      confirmationUrl: paymentUrl || data.listingUrl,
    };  });

const WP_HTML_HEADERS = {
  Accept: "text/html",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export type WpUser = {
  id: number;
  name: string;
  slug: string;
  email: string;
  avatar: string;
  roles: string[];
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export type WpTrip = {
  id?: number;
  slug: string;
  title: string;
  date: string;
  url: string;
  data?: Omit<WpTripSaveInput, "email">;
};

type WpYoastHeadJson = {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: Record<string, unknown> | unknown[];
  og_title?: string;
  og_description?: string;
  og_url?: string;
  og_type?: string;
  og_image?: Array<{ url?: string; path?: string }> | { url?: string; path?: string } | string;
  twitter_title?: string;
  twitter_description?: string;
  twitter_image?: string;
  schema?: Record<string, unknown> | unknown[] | null;
};

type WpTerm = {
  id?: number;
  name: string;
  slug: string;
  parent?: number;
  taxonomy?: string;
  count?: number;
  meta?: { category_position?: number | string | null; cuisine_image?: unknown; listing_category_image?: unknown };
  /** Some term-meta integrations expose registered fields at the top level. */
  cuisine_image?: unknown;
  description?: string;
  yoast_head_json?: WpYoastHeadJson;
};
type WpMedia = {
  id?: number;
  source_url?: string;
  media_details?: { sizes?: Record<string, { source_url?: string }> };
};
type WpListingMeta = {
  cafe_type?: string[];
  dining_menu_images?: { id?: number; url?: string }[];
  accessibility?: Record<string, string>;
  _trip_single_multi_days?: string;
  _trip_group_size?: string;
  _trip_itinerary?: unknown;
  _trip_faqs?: unknown;
  _trip_pricing_table?: unknown;
  _phone?: string;
  _email?: string;
  _website?: string;
  _address?: string;
  _friendly_address?: string;
  _featured?: string | number | boolean;
  _gallery?: unknown;
  _max_guests?: string | number;
  _min_guests?: string | number;
  _normal_price?: string | number;
  _weekend_price?: string | number;
  _weekday_price?: string | number;
  _reservation_price?: string | number;
  _children_price?: string | number;
  _children_discount?: string | number;
  _event_tickets?: string | number;
  _expired_after?: string | number;
  _count_per_guest?: string | number;
  _booking_status?: string | number | boolean;
  _is_open_now?: string | number | boolean;
  is_open_now?: string | number | boolean;
  _opening_hours?: unknown;
  opening_hours?: unknown;
  _opening_hours_status?: string | number | boolean;
  opening_hours_status?: string | number | boolean;
  xp_rating?: string | number;
  google_rating?: string | number;
  "listeo-avg-rating"?: string | number;
  _combined_rating?: string | number;
  _combined_review_count?: string | number;
  _listing_views_count?: string | number;
  google_review_count?: string | number;
  "listing-package"?: string | number;
  _geolocation_lat?: string;
  _geolocation_long?: string;
  google_place_id?: string;
  googlePlaceId?: string;
  _google_place_id?: string;
  _googlePlaceId?: string;
};
type WpListing = {
  id: number;
  author?: number;
  slug: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  listing_category?: number[];
  region?: number[];
  listing_feature?: number[];
  "pub-type"?: number[];
  "cuisine-type"?: number[];
  "restaurant-types"?: number[];
  "resto-bar-type"?: number[];
  "water-sport"?: number[];
  "land-adventures"?: number[];
  "sport-type"?: number[];
  "activity-type"?: number[];
  "property-type"?: number[];
  "property-category"?: number[];
  "by-theme"?: number[];
  "explore-type"?: number[];
  featured_media?: number;
  class_list?: string[];
  meta?: WpListingMeta;
  xplore_meta?: Record<string, unknown>;
  xplore_archive_meta?: Record<string, unknown>;
  xplore_featured?: boolean;
  xplore_view_count?: number;
  yoast_head_json?: WpYoastHeadJson;
  _embedded?: {
    "wp:featuredmedia"?: WpMedia[];
    "wp:term"?: WpTerm[][];
  };
};
type WpGuide = {
  slug: string;
  date?: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  yoast_head_json?: WpYoastHeadJson;
  _embedded?: {
    "wp:featuredmedia"?: WpMedia[];
    "wp:term"?: { name?: string; slug?: string; taxonomy?: string }[][];
  };
};
type WpMe = {
  id: number;
  name?: string;
  slug?: string;
  email?: string;
  roles?: string[];
  avatar_urls?: Record<string, string>;
  meta?: Record<string, unknown>;
};
type WpUserTrip = {
  id?: number;
  slug: string;
  link?: string;
  date?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
};

const FALLBACK_IMAGE: Record<Category, string> = {
  places: "/images/french-quarter.jpg",
  activities: "/images/scuba.jpg",
  food: "/images/cafe.jpg",
  services: "/images/cafe.jpg",
  stay: "/images/hotel.jpg",
  rentals: "/images/beach.jpg",
};

const PARENT_TO_CATEGORY: Record<string, Category> = {
  "tourist-attractions": "places",
  beaches: "places",
  "heritage-sites": "places",
  "heritage-streets": "places",
  "historical-site": "places",
  "spiritual-places": "places",
  temples: "places",
  churches: "places",
  ashrams: "places",
  events: "activities",
  activities: "activities",
  "adventure-sports": "activities",
  "water-activities": "activities",
  "boat-rides": "activities",
  cycling: "activities",
  "classes-workshops": "activities",
  "bike-rental": "rentals",
  "car-rental": "rentals",
  rentals: "rentals",
  services: "services",
  "food-beverage": "food",
  cafes: "food",
  restaurants: "food",
  pubs: "food",
  "resto-bars": "food",
  "resto-pubs": "food",
  "resto-bar-type": "food",
  bakeries: "food",
  accommodation: "stay",
  hotels: "stay",
  homestay: "stay",
  "guest-house": "stay",
  hostels: "stay",
  "boutique-hotels": "stay",  resorts: "stay",
  resort: "stay",
};

const SKIP_KIND = new Set([
  "tourist-attractions",
  "food-beverage",
  "accommodation",
  "activities",
  "rentals",
  "services",
  "events",
]);

const TAX_LABELS: Record<string, string> = {
  listing_category: "Categories",
  listing_feature: "Features",
  region: "Region",
  "by-theme": "Theme",
  "activity-type": "Activity type",
  "cuisine-type": "Cuisine",
  "restaurant-types": "Restaurant type",
  "resto-bar-type": "Resto bar",
  "pub-type": "Pub type",
  "water-sport": "Water sports",
  "land-adventures": "Land adventures",
  "sport-type": "Sport",
  "explore-type": "Explore",
  "property-type": "Property type",
  "property-category": "Property",
  event_category: "Events",
  service_category: "Services",
  rental_category: "Rentals",
  trip_category: "Trip type",
  trip_theme: "Trip theme",
  trip_destination: "Destination",
  "trip-duration": "Trip duration",
  trip_highlight: "Highlights",
  trip_py_location: "Trip location",
  classifieds_category: "Classifieds",
  stories_category: "Stories",
};

const TAX_ORDER = Object.keys(TAX_LABELS);

function sanitizeListingHtml(value: string) {
  // WordPress applies its content filters before returning this HTML. Strip
  // executable markup and event handlers before passing it to the browser.
  return value
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
}
function normalizeFoodMetaDisplayValue(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return decodeHtml(String(value)).trim();
  if (Array.isArray(value)) return value.map(normalizeFoodMetaDisplayValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["label", "name", "title", "value", "text", "display"]) {
      const normalized = normalizeFoodMetaDisplayValue(record[key]);
      if (normalized) return normalized;
    }
  }
  return "";
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
      if (body[0] === "#") {
        const n =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : Number(body.slice(1));
        return Number.isFinite(n) ? String.fromCharCode(n) : match;
      }
      return named[body.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function mediaUrl(media?: WpMedia) {
  const sizes = media?.media_details?.sizes ?? {};
  return (
    sizes["listeo-listing-grid"]?.source_url ||
    sizes.medium_large?.source_url ||
    sizes.large?.source_url ||
    sizes.medium?.source_url ||
    media?.source_url ||
    ""
  );
}

/**
 * Guide cards should use a proportional WordPress image size, not Listeo's
 * tightly cropped listing-card thumbnail (typically around 520×397).
 * Prefer a sharp, uncropped 1024px/768px rendition for article hero images.
 */
function guideFeaturedImageUrl(media?: WpMedia) {
  const sizes = media?.media_details?.sizes ?? {};
  return (
    // Prefer WordPress medium_large (usually 768px wide with a natural ratio).
    sizes.medium_large?.source_url ||
    sizes.large?.source_url ||
    media?.source_url ||
    sizes.medium?.source_url ||
    sizes["listeo-listing-grid"]?.source_url ||
    ""
  );
}

function categoryFromTerms(
  terms: { slug?: string; name?: string; parent?: number }[],
): { category: Category; kind: string; tags: string[] } {
  const slugs = terms.map((t) => t.slug ?? "").filter(Boolean);

  // Listeo often exposes only the child listing_category term on REST
  // responses (for example "clinics" or "travel-agencies"), not the
  // "services" parent. Resolve every term through the same archive mapping
  // used by the Explore routes so child categories cannot fall back to
  // "places".
  let category: Category = "places";
  const rank: Category[] = ["stay", "services", "food", "rentals", "activities", "places"];
  for (const candidate of rank) {
    if (slugs.some((slug) => archiveCategory(slug) === candidate || PARENT_TO_CATEGORY[slug] === candidate)) {
      category = candidate;
      break;
    }
  }

  const kindTerm =
    terms.find((t) => t.slug && !SKIP_KIND.has(t.slug)) ?? terms[0];
  return {
    category,
    kind: kindTerm?.name ? decodeHtml(kindTerm.name) : "Listing",
    tags: terms.map((t) => decodeHtml(t.name ?? "")).filter(Boolean),
  };
}

function urlTail(url: string) {
  return url.split("/").filter(Boolean).pop() ?? "";
}

function findLocal(slug: string, link?: string): Listing | undefined {
  const linkTail = link ? urlTail(link) : "";
  return (
    localListings.find((l) => l.slug === slug) ||
    localListings.find((l) => urlTail(l.siteUrl) === slug) ||
    (linkTail ? localListings.find((l) => l.slug === linkTail || urlTail(l.siteUrl) === linkTail) : undefined)
  );
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function parseListeoBookingPricing(html: string): {
  regularPrice?: number;
  weekendPrice?: number;
  reservationFee?: number;
  childrenDiscount?: number;
  availableTickets?: number;
  instantBooking?: boolean;
} {
  const inputTags = [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);

  const readAttr = (tag: string, attr: string) => {
    const match = tag.match(new RegExp("\\b" + attr + "=[\"\']([^\"\']*)[\"\']", "i"));
    return match?.[1]?.trim();
  };

  const readNumberFromTags = (names: string[]) => {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    for (const tag of inputTags) {
      const name = readAttr(tag, "name")?.toLowerCase();
      const id = readAttr(tag, "id")?.toLowerCase();
      if (!((name && wanted.has(name)) || (id && wanted.has(id)))) continue;
      const raw = readAttr(tag, "value");
      if (raw == null) continue;
      const value = Number(raw.replace(/[^0-9.]+/g, ""));
      if (Number.isFinite(value)) return value;
    }
    return undefined;
  };

  const readLabelled = (labels: string[]) => {
    for (const label of labels) {
      const labelMatch = html.match(new RegExp(label, "i"));
      if (!labelMatch || labelMatch.index == null) continue;
      const tail = html.slice(labelMatch.index, labelMatch.index + 1400);
      const tags = [...tail.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
      for (const tag of tags) {
        const raw = readAttr(tag, "value");
        if (raw == null) continue;
        const value = Number(raw.replace(/[^0-9.]+/g, ""));
        if (Number.isFinite(value)) return value;
      }
    }
    return undefined;
  };

  const regularPrice =
    readNumberFromTags(["_normal_price", "normal_price", "regular_price"]) ??
    readLabelled(["Regular Price"]);
  const weekendPrice =
    readNumberFromTags(["_weekend_price", "_weekday_price", "weekend_price", "weekday_price"]) ??
    readLabelled(["Weekend Price"]);
  const reservationFee =
    readNumberFromTags(["_reservation_price", "reservation_price"]) ??
    readLabelled(["Reservation Fee"]);
  const childrenDiscount =
    readNumberFromTags(["_children_price", "children_price", "_children_discount", "children_discount"]) ??
    readLabelled(["Children Price"]);
  const availableTickets =
    readNumberFromTags(["_event_tickets", "event_tickets", "_available_tickets", "available_tickets"]) ??
    readLabelled(["Available Tickets"]);

  const instantBooking = inputTags.some((tag) => {
    const name = ((readAttr(tag, "name") ?? "") + " " + (readAttr(tag, "id") ?? "")).toLowerCase();
    return /instant[_-]?booking|booking[_-]?instant/.test(name) && (
      readAttr(tag, "checked") != null ||
      /^(1|yes|on|true)$/i.test(readAttr(tag, "value") ?? "")
    );
  });

  return {
    regularPrice: regularPrice != null && regularPrice >= 0 ? regularPrice : undefined,
    weekendPrice: weekendPrice != null && weekendPrice >= 0 ? weekendPrice : undefined,
    reservationFee: reservationFee != null && reservationFee >= 0 ? reservationFee : undefined,
    childrenDiscount: childrenDiscount != null && childrenDiscount >= 0 ? childrenDiscount : undefined,
    availableTickets: availableTickets != null && availableTickets > 0 ? availableTickets : undefined,
    instantBooking,
  };
}
function parseListeoGuestLimits(html: string): { min?: number; max?: number } {
  const findAttr = (tag: string, names: string[]) => {
    for (const name of names) {
      const quoted = tag.match(new RegExp("\\b" + name + "\s*=\s*[\"'](\\d+)[\"']", "i"));
      if (quoted?.[1]) return Number(quoted[1]);
      const unquoted = tag.match(new RegExp("\\b" + name + "\s*=\s*(\\d+)", "i"));
      if (unquoted?.[1]) return Number(unquoted[1]);
    }
    return undefined;
  };

  const adultInput = html.match(/<input\b[^>]*(?:name|id)=["']adults["'][^>]*>/i)?.[0] ?? "";
  const maxFromMeta = html.match(/(?:_max_guests|max_guests|maximum[_-]?guests)["'\s:=]+["']?(\d+)/i)?.[1];
  const minFromMeta = html.match(/(?:_min_guests|min_guests|minimum[_-]?guests)["'\s:=]+["']?(\d+)/i)?.[1];

  const max = findAttr(adultInput, ["max", "data-max", "data-maximum"]) ?? positiveInteger(maxFromMeta);
  const min = findAttr(adultInput, ["min", "data-min", "data-minimum"]) ?? positiveInteger(minFromMeta);
  return {
    min: min && min >= 1 ? min : undefined,
    max: max && max >= 1 ? max : undefined,
  };
}
function truthyMeta(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["true", "1", "yes", "on", "enabled"].includes(value.toLowerCase());
  return false;
}

function htmlHasActiveListeoBooking(html: string) {
  // Do not infer booking from generic Listeo nonce/form markup: those can be
  // present on listings that do not have booking enabled. The rendered page
  // exposes a much narrower booking signal when Listeo actually publishes a
  // bookable slot/CTA.
  return /Next free slot\s*:/i.test(html) && /\bBook Now\b/i.test(html);
}

function taxIds(raw: WpListing, key: string): number[] {
  const value = (raw as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number" && id > 0) : [];
}

function extractTaxonomies(
  raw: WpListing,
  maps?: Record<string, Map<number, WpTerm>>,
): ListingTaxGroup[] {
  const groups: ListingTaxGroup[] = [];
  const seen = new Set<string>();

  if (maps) {
    for (const key of Object.keys(TAX_LABELS)) {
      const map = maps[key];
      if (!map) continue;
      const terms: ListingTaxTerm[] = [];
      const used = new Set<string>();
      for (const id of taxIds(raw, key)) {
        const term = map.get(id);
        if (!term?.name && !term?.slug) continue;
        const slug = term.slug || String(id);
        if (used.has(slug)) continue;
        used.add(slug);
        terms.push({ name: decodeHtml(term.name || slug), slug });
      }
      if (!terms.length) continue;
      seen.add(key);
      groups.push({ key, label: TAX_LABELS[key] ?? key.replace(/[-_]/g, " "), terms });
    }
  }

  for (const group of raw._embedded?.["wp:term"] ?? []) {
    if (!group?.length) continue;
    const key = group[0]?.taxonomy ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const terms: ListingTaxTerm[] = [];
    const used = new Set<string>();
    for (const term of group) {
      const slug = term.slug || "";
      const name = decodeHtml(term.name ?? "");
      if (!name || used.has(slug || name)) continue;
      used.add(slug || name);
      terms.push({ name, slug: slug || name.toLowerCase().replace(/\s+/g, "-") });
    }
    if (!terms.length) continue;
    groups.push({
      key,
      label: TAX_LABELS[key] ?? key.replace(/[-_]/g, " "),
      terms,
    });
  }

  groups.sort((a, b) => {
    const ia = TAX_ORDER.indexOf(a.key);
    const ib = TAX_ORDER.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return groups;
}

function parseItinerary(raw: unknown): ListingStop[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const stops: ListingStop[] = [];
  const seen = new Set<string>();
  for (const item of Object.values(raw as Record<string, unknown>)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = decodeHtml(String(row.title ?? row.name ?? "")).trim();
    if (!title) continue;
    const time = decodeHtml(String(row.time ?? "")).trim();
    const day = decodeHtml(String(row.day ?? "")).trim();
    const key = `${time}|${day}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const description = decodeHtml(String(row.description ?? row.content ?? "")).trim();
    stops.push({
      time: time || undefined,
      day: day || undefined,
      title,
      description: description || undefined,
    });
  }
  return stops;
}

function parseFaqs(raw: unknown): ListingFaq[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
  const faqs: ListingFaq[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const question = decodeHtml(String(row.question ?? row.q ?? row.title ?? "")).trim();
    const answer = decodeHtml(String(row.answer ?? row.a ?? row.description ?? "")).trim();
    if (question && answer) faqs.push({ question, answer });
  }
  return faqs;
}

function extractGalleryMeta(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === "string") {
      const url = value.trim();
      if (/^https?:\/\//i.test(url) && /\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(url)) {
        if (!seen.has(url)) {
          seen.add(url);
          out.push(url);
        }
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    for (const key of ["url", "source_url", "src", "image", "value"]) {
      if (key in row) add(row[key]);
    }
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) add(entry);
  } else if (raw && typeof raw === "object") {
    for (const entry of Object.values(raw as Record<string, unknown>)) add(entry);
  } else {
    add(raw);
  }

  return out.slice(0, 24);
}

function extractMenuImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "url" in item) return String((item as { url?: string }).url ?? "");
      return "";
    })
    .filter((url) => /^https?:\/\//.test(url));
}

function extractJsonLd(html: string) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const out: {
    name?: string;
    phone?: string;
    website?: string;
    address?: string;
    rating?: number;
    reviews?: number;
    priceRange?: string;
    description?: string;
  } = {};
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1] ?? "") as Record<string, unknown>;
      const nodes = Array.isArray(data) ? data : data["@graph"] && Array.isArray(data["@graph"]) ? data["@graph"] : [data];
      for (const node of nodes as Record<string, unknown>[]) {
        const type = node["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (!types.some((t) => t === "LocalBusiness" || t === "Restaurant" || t === "Hotel" || t === "TouristAttraction" || t === "Place" || t === "Product")) {
          continue;
        }
        const phone = String(node.telephone ?? "").trim();
        if (phone) out.phone = phone;
        const nodeName = decodeHtml(String(node.name ?? "")).trim();
        if (nodeName) out.name = nodeName;
        const nodeUrl = String(node.url ?? "").trim();
        if (/^https?:\/\//i.test(nodeUrl) && !/xplorepondy\.com/i.test(nodeUrl)) out.website = nodeUrl;
        const nodeDesc = decodeHtml(String(node.description ?? "")).replace(/\[&hellip;\]|&hellip;|…/g, "").trim();
        if (nodeDesc.length > (out.description?.length ?? 0)) out.description = nodeDesc;
        const addr = node.address;
        if (addr && typeof addr === "object") {
          const a = addr as Record<string, unknown>;
          const street = decodeHtml(String(a.streetAddress ?? "")).trim();
          const locality = decodeHtml(String(a.addressLocality ?? "")).trim();
          const region = decodeHtml(String(a.addressRegion ?? "")).trim();
          const postal = decodeHtml(String(a.postalCode ?? "")).trim();
          const parts = [street];
          for (const part of [locality, region, postal]) {
            if (part && !parts.some((p) => p.toLowerCase().includes(part.toLowerCase()))) parts.push(part);
          }
          if (parts.length) out.address = parts.join(", ");
        } else if (typeof addr === "string" && addr.trim()) {
          out.address = decodeHtml(addr.trim());
        }
        const rating = node.aggregateRating;
        if (rating && typeof rating === "object") {
          const r = rating as Record<string, unknown>;
          const value = Number(r.ratingValue);
          const count = Number(r.reviewCount);
          if (value > 0) out.rating = value;
          if (count > 0) out.reviews = count;
        }
        const priceRange = String(node.priceRange ?? "").trim();
        if (priceRange && !/^not available$/i.test(priceRange)) out.priceRange = priceRange;
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return out;
}

function parseCheckItem(raw: string): ListingMetaItem | null {
  const text = decodeHtml(raw)
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || isMetaBooleanNoise(text)) return null;
  if (/^[✅✔✓]/.test(text)) return { label: text.replace(/^[✅✔✓]\s*/, "").trim(), included: true };
  if (/^[❌✖✗]/.test(text)) return { label: text.replace(/^[❌✖✗]\s*/, "").trim(), included: false };
  if (text.length < 2 || text.length > 180) return null;
  if (/^https?:\/\//i.test(text)) return null;
  return { label: text };
}

function extractCheckItems(html: string): ListingMetaItem[] {
  const cleaned = html.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const seen = new Set<string>();
  const items: ListingMetaItem[] = [];
  for (const row of cleaned.matchAll(/jet-check-list__item-content[^>]*>([\s\S]*?)<\/div>/gi)) {
    const item = parseCheckItem(row[1] ?? "");
    if (!item) continue;
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function clipContactSection(html: string) {
  const cut = html.search(/Claim this listing|Popular Cafes|Popular Restopubs|jet-listing-grid|Nothing found/i);
  return cut >= 0 ? html.slice(0, cut) : html;
}

function clipListingSection(html: string) {
  const cut = html.search(
    /CONTACT\s*\/\s*ADDRESS|Claim this listing|Popular Cafes|Popular Restopubs|jet-listing-grid|Invalid post IDs|Nothing found|Login \/ Register/i,
  );
  return cut >= 0 ? html.slice(0, cut) : html;
}

function isJunkListingText(text: string) {
  return /Invalid post IDs|Search Results|See all results|Claim this listing|Login \/ Register|Continue with Google|<div clas/i.test(
    text,
  );
}

function extractJetMetaGroups(html: string, profile: ListingFieldProfile | null = null): { groups: ListingMetaGroup[]; price?: string } {
  const groups: ListingMetaGroup[] = [];
  let price: string | undefined;
  const headingRe = /<h[2-4][^>]*class="[^"]*listing-field-heading[^"]*"[^>]*>([\s\S]*?)<\/h[2-4]>/gi;
  const matches = [...html.matchAll(headingRe)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const title = decodeHtml(match[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || /nearby|related|popular |contact\s*\/\s*address|sponsored|share this|review/i.test(title)) continue;
    // On the single-listing page we want the complete set of visible
    // Listeo/JetEngine sections. Profile matching is useful for archive
    // layout, but filtering here silently dropped valid listing content.
    const priceMatch = title.match(/^price for two\s*:?\s*(.+)$/i);
    if (priceMatch) {
      price = priceMatch[1].trim();
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const nextAt = i + 1 < matches.length ? (matches[i + 1].index ?? start) : start + 12000;
    const after = clipListingSection(html.slice(start, Math.min(nextAt, start + 12000)));
    const items = extractCheckItems(after);
    if (items.length) {
      groups.push({ title, items });
      continue;
    }
    const checks = [...after.matchAll(/[✅✔]\s*([^✅✔<\n]{2,80})/g)]
      .map((row) => parseCheckItem(`✅ ${row[1] ?? ""}`))      .filter((item): item is ListingMetaItem => !!item);
    if (checks.length) {
      groups.push({ title, items: checks });
      continue;
    }
    const text = htmlToRichText(after.replace(/<svg[\s\S]*?<\/svg>/gi, " "))
      .replace(/\*\*/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 1200);
    if (text.length > 8 && !isJunkListingText(text)) groups.push({ title, items: [], text });
  }
  const merged: ListingMetaGroup[] = [];
  for (const group of groups) {
    const existing = merged.find((g) => g.title.toLowerCase() === group.title.toLowerCase());
    if (!existing) {
      merged.push({ title: group.title, items: [...group.items], text: group.text });
      continue;
    }
    const seen = new Set(existing.items.map((i) => i.label.toLowerCase()));
    for (const item of group.items) {
      if (!seen.has(item.label.toLowerCase())) existing.items.push(item);
    }
    if (!existing.text && group.text) existing.text = group.text;
  }
  return { groups: merged, price };
}

function extractLabeledFacts(html: string): { fields: { label: string; value: string }[]; duration?: string } {
  const fields: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(
    /<div class="heading-(?:break|sameline)">([\s\S]*?)<\/div>([\s\S]*?)<\/div>/gi,
  )) {
    const label = decodeHtml(row[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[:\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const value = htmlToRichText(row[2] ?? "")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!label || value.length < 1 || value.length > 400) continue;
    if (/nearby|popular|share this|contact|get directions/i.test(label)) continue;
    if (isJunkListingText(value)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ label, value });
  }
  for (const row of html.matchAll(
    /<span class="field-values">([\s\S]*?)<\/span>\s*([\s\S]*?)<\/span>/gi,
  )) {
    const label = decodeHtml(row[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[:\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const value = decodeHtml(row[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!label || value.length < 1 || value.length > 1600) continue;
    if (/nearby|popular|share this|contact|get directions/i.test(label)) continue;
    if (isJunkListingText(value)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ label, value });
  }
  const duration = fields.find((f) => /^duration$/i.test(f.label))?.value;
  return { fields, duration };
}

function extractListingOverview(html: string, _name?: string): string {
  const inner =
    html.match(
      /id="overview"[^>]*>[\s\S]*?<div class="elementor-widget-container">([\s\S]*?)<\/div>\s*<\/div>/i,
    )?.[1] ||
    html.match(
      /elementor-widget-theme-post-content[\s\S]*?<div class="elementor-widget-container">([\s\S]*?)<\/div>/i,
    )?.[1] ||
    "";
  if (!inner) return "";
  const text = htmlToRichText(inner.replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " "))
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);
  return isJunkListingText(text) ? "" : text;
}

function extractListingGeo(html: string): { lat?: number; lng?: number } {
  const mapBlock = html.match(/listeo-listing-map[\s\S]{0,2500}/i)?.[0] ?? html;
  const pair =
    mapBlock.match(/data-latitude="([\d.-]+)"[\s\S]{0,200}?data-longitude="([\d.-]+)"/i) ||
    html.match(/data-latitude="([\d.-]+)"[\s\S]{0,200}?data-longitude="([\d.-]+)"/i) ||
    html.match(/destination=([\d.-]+),([\d.-]+)/i);
  if (!pair) return {};
  const lat = Number(pair[1]);
  const lng = Number(pair[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  return { lat, lng };
}

function extractListeoContact(html: string): { website?: string; phone?: string; address?: string; lat?: number; lng?: number } {
  // Listeo/Elementor markup can change slightly between listing templates.
  // Do not make the whole Contact / Address panel depend on one exact heading
  // or one Elementor class. Start at the contact section when we can locate it,
  // then use several independent fallbacks for website, phone and address.
  const start = html.search(/CONTACT[\s\S]{0,180}ADDRESS/i);
  const block = start >= 0 ? clipContactSection(html.slice(start, start + 16000)) : html;

  const externalUrls = [...block.matchAll(/(?:href|data-href)=["'](https?:\/\/[^"']+)["']/gi)]
    .map((m) => decodeHtml(m[1] ?? "").replace(/&#038;/g, "&").trim())
    .filter(
      (url) =>
        /^https?:\/\//i.test(url) &&
        !/xplorepondy\.com|google\.(com|co)|maps\.app\.goo|facebook\.com|instagram\.com|wa\.me/i.test(url),
    );
  const website = externalUrls[0];

  const tel = block.match(/(?:href=["']tel:|data-phone=["'])([^"']+)/i);
  const phone = tel
    ? decodeURIComponent(tel[1]).replace(/%20/g, " ").replace(/&amp;/gi, "&").trim()
    : undefined;

  const descriptions = [
    ...block.matchAll(/elementor-icon-box-description[^>]*>([\s\S]*?)<\/p>/gi),
    ...block.matchAll(/(?:Website|Phone(?:\s+number)?|Google\s+Maps\s+address|Address)[^<]{0,120}<[^>]+>([\s\S]*?)<\/[^>]+>/gi),
  ].map((row) =>
    decodeHtml(row[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).filter(Boolean);

  const listingAddr =
    decodeHtml(
      block.match(/(?:listing-address|address)["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ??
      block.match(/Google\s+Maps\s+address[\s\S]{0,1200}?(?:<p[^>]*>|<div[^>]*>)([\s\S]*?)<\/(?:p|div)>/i)?.[1] ??
      "",
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const address = preferListeoAddress(...descriptions, listingAddr);
  const geo = extractListingGeo(block);
  return {
    website,
    phone: phone || undefined,
    address,
    lat: geo.lat,
    lng: geo.lng,
  };
}

function extractGallery(html: string, featured?: string): string[] {
  const blocks = [
    html.match(/listeo-listing-grid-gallery[\s\S]{0,16000}/i)?.[0] ?? "",
    html.match(/listing-slider[\s\S]{0,16000}/i)?.[0] ?? "",
    html.match(/mfp-gallery[\s\S]{0,16000}/i)?.[0] ?? "",
    html.match(/wp-block-gallery[\s\S]{0,12000}/i)?.[0] ?? "",
    html.match(/elementor-widget-image-gallery[\s\S]{0,16000}/i)?.[0] ?? "",
  ];
  const urls = blocks.flatMap((block) =>
    [...block.matchAll(/(?:src|data-src|href)="(https:\/\/xplorepondy\.com\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map(
      (m) => m[1],
    ),
  );
  const featuredClean = featured ? uncropImage(featured) : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const clean = uncropImage(url);
    if (featuredClean && clean === featuredClean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 16) break;
  }
  return out;
}

function htmlHasListeoBookingWidget(html: string) {
  return (
    /lbpData\s*=\s*\{[\s\S]{0,5000}\bnonce\s*[:=]/i.test(html) ||
    /lbp_submit_booking/i.test(html) ||
    /<form\b[^>]*\bid=["']form-booking["']/i.test(html)
  );
}

function enrichListingFromHtml(listing: Listing, html: string): Listing {
  const extra = extractJsonLd(html);
  const htmlGooglePlaceId = extractGooglePlaceIdFromHtml(html);
  const contact = extractListeoContact(html);
  const facts = extractLabeledFacts(html);
  const geo = extractListingGeo(html);
  const og = extractOgImage(html);
  const gallery = uniqueImages(extractGallery(html, og || listing.image), listing.gallery);
  const hoursInfo = parseOpenHoursHtml(html);
  const guestLimits = parseListeoGuestLimits(html);
  const bookingPricing = parseListeoBookingPricing(html);
  const overview = extractListingOverview(html, listing.name);
  const categorySlugs = [
    ...new Set([
      ...(listing.categorySlugs ?? []),
      ...[...html.matchAll(/listing_category-([a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase()),
    ]),
  ];
  const profile = profileFromSlugs(categorySlugs);
  const jet = extractJetMetaGroups(html, profile);
  const groups = [...(listing.metaGroups ?? [])];
  for (const group of jet.groups) {
    const existing = groups.find((item) => item.title.toLowerCase() === group.title.toLowerCase());
    if (!existing) {
      groups.push(group);
      continue;
    }
    const seen = new Set(existing.items.map((item) => item.label.toLowerCase().replace(/[^a-z0-9]+/g, "")));
    for (const item of group.items) {
      const normalized = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (normalized && !seen.has(normalized)) {
        existing.items.push(item);
        seen.add(normalized);
      }
    }
    if (!existing.text && group.text) existing.text = group.text;
  }
  if (!profile && facts.fields.length && !groups.some((g) => /^features$/i.test(g.title))) {
    groups.unshift({
      title: "Features",
      items: facts.fields.map((f) => ({ label: `${f.label}: ${f.value}` })),
    });
  }
  if (profile) {
    for (const fact of facts.fields) {
      if (!headingMatchesProfile(profile, fact.label)) continue;
      if (groups.some((g) => g.title.toLowerCase() === fact.label.toLowerCase())) continue;
      groups.push({ title: fact.label, items: [], text: fact.value });
    }
  }
  const price = listing.price || jet.price || extra.priceRange;
  if (profile && profileKeys(profile).includes("price_for_two") && price && !groups.some((g) => /price for two/i.test(g.title))) {
    groups.push({ title: "Price for two", items: [], text: price });
  }
  const ordered = filterListingGroups(profile, groups)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !isMetaBooleanNoise(item.label)),
    }))
    .filter((group) => group.items.length > 0 || Boolean(group.text?.trim()));
  const cafeFromGroups = ordered.find((g) => /cafe type/i.test(g.title));
  const liveDesc =
    (overview && !isJunkListingText(overview) ? overview : "") ||
    (extra.description && !isJunkListingText(extra.description) ? extra.description : "");
  return {
    ...listing,
    name: extra.name || listing.name,
    phone: contact.phone || extra.phone || listing.phone,
    website: contact.website || extra.website || listing.website,
    address: preferListeoAddress(contact.address, listing.address, extra.address),
    googlePlaceId: listing.googlePlaceId || htmlGooglePlaceId,
    rating: extra.rating || listing.rating || 0,
    reviews: extra.reviews || listing.reviews || 0,
    // Preserve the friendly address when it came from REST. If REST did not
    // expose _friendly_address, the rendered Listeo contact block is still an
    // authoritative address source for the single-listing page.
    friendlyAddress: listing.friendlyAddress || contact.address || undefined,
    price,
    hours: hoursInfo.hours || listing.hours,
    openNow: hoursInfo.openNow ?? listing.openNow,
    weeklyHours: hoursInfo.weeklyHours.length ? hoursInfo.weeklyHours : listing.weeklyHours,
    location: listing.location === "Pondicherry" && extra.address ? extra.address : listing.location,
    lat: listing.lat ?? contact.lat ?? geo.lat,
    lng: listing.lng ?? contact.lng ?? geo.lng,
    bookingEnabled: listing.bookingEnabled ?? htmlHasActiveListeoBooking(html),
    bookingMinGuests: guestLimits.min ?? listing.bookingMinGuests,
    bookingMaxGuests: guestLimits.max ?? listing.bookingMaxGuests,
    bookingRegularPrice: bookingPricing.regularPrice ?? listing.bookingRegularPrice,
    bookingWeekendPrice: bookingPricing.weekendPrice ?? listing.bookingWeekendPrice,
    bookingReservationFee: bookingPricing.reservationFee ?? listing.bookingReservationFee,
    bookingChildrenDiscount: bookingPricing.childrenDiscount ?? listing.bookingChildrenDiscount,
    bookingAvailableTickets: bookingPricing.availableTickets ?? listing.bookingAvailableTickets,
    bookingInstant: bookingPricing.instantBooking || listing.bookingInstant,
    duration: facts.duration || listing.duration,
    description: liveDesc.length > (listing.description?.length ?? 0) ? liveDesc : liveDesc || listing.description,
    cafeTypes: listing.cafeTypes?.length ? listing.cafeTypes : cafeFromGroups?.items.map((i) => i.label),
    categorySlugs,
    // The single-listing page must not apply the archive field profile.
    // JetEngine/Listeo can contain listing-specific fields (including generic
    // Features/Tags) that are intentionally absent from the archive profile.
    // Keep the complete groups here; the detail UI orders them by category.
    metaGroups: groups.length ? groups : listing.metaGroups,
    gallery: gallery.length ? gallery : listing.gallery,
    image: pickListingImage(og, listing.image, gallery[0]) || listing.image,
  };
}

function extractGooglePlaceId(meta: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(meta)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalized.includes("google") && !normalized.includes("placeid")) continue;
    const candidate = String(value ?? "").trim();
    if (/^ChIJ[A-Za-z0-9_-]+$/.test(candidate)) return candidate;
  }
  return undefined;
}

function extractGooglePlaceIdFromHtml(html: string): string | undefined {
  const patterns = [
    /(?:place[_-]?id|placeId|query[_-]?place[_-]?id)["'=:\s]+["']?(ChIJ[A-Za-z0-9_-]{10,})/i,
    /(?:google\\.com\/maps[^"'\s]*?(?:place_id|query_place_id)=)(ChIJ[A-Za-z0-9_-]{10,})/i,
    /\b(ChIJ[A-Za-z0-9_-]{10,})\b/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function isMetaBooleanNoise(value: unknown): boolean {
  if (value == null || value === false || value === "") return true;
  if (typeof value !== "string") return false;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\[\]{}"'\\]/g, " ")
    .replace(/[,|;]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();

  if (!normalized) return true;
  const tokens = normalized.split(" ");
  return tokens.length > 0 && tokens.every((token) => token === "false" || token === "0" || token === "no" || token === "off");
}

function parseSerializedMetaArray(value: string): unknown[] | undefined {
  // JetEngine checkbox values can arrive as a serialized PHP array when the
  // REST schema exposes the raw stored value. Extract only scalar string
  // entries; never try to execute or evaluate serialized PHP.
  if (!/^a:\\d+:\\{/.test(value.trim())) return undefined;

  const entries: string[] = [];
  const pattern = /s:\\d+:"((?:[^"\\]|\\.)*)";/g;
  for (const match of value.matchAll(pattern)) {
    if (match[1] != null) entries.push(match[1]);
  }
  return entries.length ? entries : undefined;
}

function metaValueItems(value: unknown): ListingMetaItem[] {
  const items: ListingMetaItem[] = [];
  const add = (rawValue: unknown, included = true) => {
    if (isMetaBooleanNoise(rawValue)) return;
    const label = decodeHtml(String(rawValue))
      .replace(/[_-]+/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
    if (!label || isMetaBooleanNoise(label)) return;

    const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!normalized || items.some((item) => item.label.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized)) return;
    items.push({ label, included });
  };

  const parsedString =
    typeof value === "string"
      ? (() => {
          const trimmed = value.trim();
          if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
            try {
              return JSON.parse(trimmed) as unknown;
            } catch {
              // Continue as a normal scalar.
            }
          }
          return parseSerializedMetaArray(trimmed);
        })()
      : undefined;

  if (parsedString !== undefined) {
    return metaValueItems(parsedString);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry)) {
        for (const item of metaValueItems(entry)) add(item.label, item.included);
      } else if (entry && typeof entry === "object") {
        for (const [key, entryValue] of Object.entries(entry as Record<string, unknown>)) {
          if (entryValue === true || entryValue === 1 || entryValue === "1" || entryValue === "yes" || entryValue === "true") {
            add(keyLabelFromMeta(key));
          } else if (entryValue !== false && entryValue != null && typeof entryValue === "string" && !isMetaBooleanNoise(entryValue)) {
            add(entryValue);
          }
        }
      } else {
        add(entry);
      }
    }
    return items;
  }

  if (value && typeof value === "object") {
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (entryValue === true || entryValue === 1 || entryValue === "1" || entryValue === "yes" || entryValue === "true") {
        add(keyLabelFromMeta(key));
      } else if (entryValue !== false && entryValue != null && typeof entryValue === "string" && !isMetaBooleanNoise(entryValue)) {
        add(entryValue);
      }
    }
    return items;
  }

  // A scalar string is a text value, not a checkbox list. Commas are valid
  // punctuation in addresses, descriptions, prices, and other JetEngine text
  // fields, so never split an ordinary string into separate pills.
  add(value);
  return items;
}

const TEXT_META_KEYS = new Set([
  "listing_tagline",
  "_activity_duration",
  "_activity_age_limit",
  "activity_best_time",
  "activity_featured_video",
  "_activity_location",
  "_activity_price_range",
  "features_must_try",
  "best_time_to_visit",
  "beach_amenities_details",
  "beach_activity_details",
  "peak_hours",
  "_editor_note",
  "address",
  "_address",
  "friendly_address",
  "_friendly_address",
  "phone",
  "_phone",
  "website",
  "_website",
  "price",
  "price_range",
  "_price_range",
  "listing_price",
  "listing-package",
]);

function metaTextValue(value: unknown): string {
  if (value == null || value === false || value === "") return "";

  const htmlToText = (input: string) =>
    decodeHtml(input)
      .replace(/<br\s*\/?>(?=\s*|$)/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  if (typeof value === "string" || typeof value === "number") {
    return htmlToText(String(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => metaTextValue(entry))
      .filter(Boolean)
      .join(" ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => metaTextValue(entry))
      .filter(Boolean)
      .join(" ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  return "";
}

function keyLabelFromMeta(key: string) {
  return key
    .replace(/^_/, "")
    .replace(/_amp_/g, " & ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractAllMetaGroups(meta: Record<string, unknown>): ListingMetaGroup[] {
  const groups: ListingMetaGroup[] = [];

  for (const [key, value] of Object.entries(meta)) {
    // Internal/empty values are not useful to visitors. Keep meaningful
    // JetEngine/Listeo values, including fields that were created after the
    // PWA's original field profiles.
    if (
      value == null ||
      value === false ||
      value === "" ||
      key === "_edit_lock" ||
      key === "_edit_last"
    ) {
      continue;
    }

    const normalizedKey = key.toLowerCase();

    // These are handled separately by mapListing / the detail UI and should
    // not become duplicate metadata sections.
    if (
      normalizedKey === "_gallery" ||
      normalizedKey === "dining_menu_images" ||
      normalizedKey.includes("google_place_id") ||
      normalizedKey === "googleplaceid" ||
      normalizedKey === "_googleplaceid" ||
      normalizedKey === "_featured" ||
      normalizedKey === "_booking_status" ||
      normalizedKey === "listing-package" ||
      normalizedKey === "price_range_filter" ||
      normalizedKey === "_geolocation_lat" ||
      normalizedKey === "_geolocation_long" ||
      normalizedKey === "_store_on_off_switch" ||
      normalizedKey === "_manual_open_override" ||
      normalizedKey === "xplore_on_off_expire_time" ||
      normalizedKey === "xp_rating"
    ) {
      continue;
    }

    const title = keyLabelFromMeta(key);
    if (!title) continue;

    // Known WYSIWYG/text fields should remain readable paragraphs rather than
    // being split into checkbox-style pills.
    if (TEXT_META_KEYS.has(key)) {
      const text = metaTextValue(value);
      if (text) groups.push({ title, items: [], text });
      continue;
    }

    const items = metaValueItems(value);
    if (items.length) {
      groups.push({ title, items });
      continue;
    }

    // Scalar values that are not checkbox-like should still be visible.
    const text = metaTextValue(value);
    if (text) groups.push({ title, items: [], text });
  }

  return groups;
}

/**
 * Build metadata directly from the JetEngine field keys belonging to the
 * listing's category profile. This is intentionally key-driven rather than
 * heading-driven: JetEngine field labels can change without changing the
 * underlying meta key, and checkbox groups such as the Resto Pub fields are
 * therefore much more reliable when mapped from their exact keys.
 */
function extractProfileMetaGroups(
  meta: Record<string, unknown>,
  profile: ListingFieldProfile,
): ListingMetaGroup[] {
  const groups: ListingMetaGroup[] = [];

  for (const key of profileKeys(profile)) {
    const value = meta[key];
    if (isMetaBooleanNoise(value)) continue;

    const title = keyLabelFromMeta(key);
    if (!title) continue;

    if (TEXT_META_KEYS.has(key)) {
      const text = metaTextValue(value);
      if (text) groups.push({ title, items: [], text });
      continue;
    }

    const items = metaValueItems(value);
    if (items.length) {
      groups.push({ title, items });
      continue;
    }

    const text = metaTextValue(value);
    if (text) groups.push({ title, items: [], text });
  }

  return groups;
}


function mapYoastSeo(raw: { yoast_head_json?: WpYoastHeadJson }): Listing["seo"] {
  const seo = raw.yoast_head_json;
  if (!seo) return undefined;
  const image = Array.isArray(seo.og_image)
    ? seo.og_image[0]?.url || seo.og_image[0]?.path
    : typeof seo.og_image === "string"
      ? seo.og_image
      : seo.og_image?.url || seo.og_image?.path;
  return {
    title: typeof seo.title === "string" ? decodeHtml(seo.title) : undefined,
    description: typeof seo.description === "string" ? decodeHtml(seo.description) : undefined,
    canonical: typeof seo.canonical === "string" ? seo.canonical : undefined,
    robots: seo.robots && typeof seo.robots === "object" && !Array.isArray(seo.robots) ? seo.robots : undefined,
    ogTitle: typeof seo.og_title === "string" ? decodeHtml(seo.og_title) : undefined,
    ogDescription: typeof seo.og_description === "string" ? decodeHtml(seo.og_description) : undefined,
    ogUrl: typeof seo.og_url === "string" ? seo.og_url : undefined,
    ogType: typeof seo.og_type === "string" ? seo.og_type : undefined,
    ogImage: typeof image === "string" && /^https?:\/\//i.test(image) ? image : undefined,
    twitterTitle: typeof seo.twitter_title === "string" ? decodeHtml(seo.twitter_title) : undefined,
    twitterDescription: typeof seo.twitter_description === "string" ? decodeHtml(seo.twitter_description) : undefined,
    twitterImage: typeof seo.twitter_image === "string" ? seo.twitter_image : undefined,
    schema: seo.schema && typeof seo.schema === "object" ? seo.schema : null,
  };
}

function mapListing(
  raw: WpListing,
  extras?: {
    catMap?: Map<number, WpTerm>;
    regionMap?: Map<number, WpTerm>;
    mediaMap?: Map<number, string>;
    taxMaps?: Record<string, Map<number, WpTerm>>;
    archiveCard?: boolean;
  },
): Listing {
  let terms: { slug?: string; name?: string; parent?: number }[] = [];
  if (extras?.catMap && raw.listing_category) {
    terms = raw.listing_category.map((id) => extras.catMap!.get(id)).filter((t): t is WpTerm => !!t);
  } else {
    terms = (raw._embedded?.["wp:term"] ?? [])
      .flat()
      .filter((t) => (t as { taxonomy?: string }).taxonomy === "listing_category" || !("taxonomy" in t));
  }
  if (!terms.length) {
    const classSlugs = (raw.class_list ?? [])
      .filter((value) => value.startsWith("listing_category-"))
      .map((value) => value.slice("listing_category-".length))
      .filter(Boolean);
    terms = classSlugs.map((slug) => ({ slug, name: slug.replace(/-/g, " ") }));
  }
  const { category, kind, tags } = categoryFromTerms(terms);
  let region = "Pondicherry";
  if (extras?.regionMap && raw.region?.[0]) {
    region = extras.regionMap.get(raw.region[0])?.name ?? region;
  } else {
    const embeddedRegion = (raw._embedded?.["wp:term"] ?? [])
      .flat()
      .find((t) => (t as { taxonomy?: string }).taxonomy === "region");
    if (embeddedRegion?.name) region = decodeHtml(embeddedRegion.name);
  }
  const featuredImage =
    (raw.featured_media && extras?.mediaMap?.get(raw.featured_media)) ||
    mediaUrl(raw._embedded?.["wp:featuredmedia"]?.[0]) ||
    "";
  const image = featuredImage || FALLBACK_IMAGE[category];
  const name = decodeHtml(raw.title?.rendered ?? raw.slug);
  // WordPress post_content is the authoritative listing description.
  // Keep the full rendered content; do not truncate it to an excerpt length.
  const contentHtml = sanitizeListingHtml(raw.content?.rendered ?? "");
  const description = decodeHtml(
    raw.content?.rendered ||
      raw.yoast_head_json?.og_description ||
      raw.excerpt?.rendered ||
      "",
  );
  const local = findLocal(raw.slug, raw.link);
  const meta = {
    ...(raw.meta ?? {}),
    ...(raw.xplore_archive_meta ?? {}),
    ...(raw.xplore_meta ?? {}),
  };
  const googlePlaceId = extractGooglePlaceId(meta as Record<string, unknown>);
  const metaRecord = meta as Record<string, unknown>;
  const archiveCard = extras?.archiveCard === true;
  const archiveRating = Number(metaRecord._combined_rating);
  const archiveReviews = Number(metaRecord._combined_review_count);
  // The archive payload can expose the same WordPress status under
  // different keys depending on which REST bridge/meta projection supplied it.
  // Resolve all supported aliases before deciding that the status is unknown.
  const archiveOpenRaw =
    metaRecord._is_open_now ??
    metaRecord.is_open_now ??
    metaRecord.open_now ??
    metaRecord._open_now;
  const archiveOpen =
    archiveOpenRaw === undefined || archiveOpenRaw === null || archiveOpenRaw === ""
      ? undefined
      : truthyMeta(archiveOpenRaw);
  const archiveLat = Number(metaRecord._geolocation_lat);
  const archiveLng = Number(metaRecord._geolocation_long);
  const archiveFriendlyAddress = decodeHtml(String(metaRecord._friendly_address ?? "")).trim();

  // Google/Listeo rating metadata has existed under several keys over the
  // lifetime of the directory. xp_rating is the current Xplore Pondy value
  // used by newer listings, so it must be treated as a first-class REST field.
  const metaRating = Number(
    metaRecord._combined_rating ??
      metaRecord.xp_rating ??
      metaRecord.google_rating ??
      metaRecord["listeo-avg-rating"] ??
      metaRecord.rating ??
      metaRecord._rating ??
      metaRecord.average_rating ??
      metaRecord._average_rating ??
      metaRecord.rating_value ??
      metaRecord._rating_value,
  );
  const metaReviews = Number(
    metaRecord._combined_review_count ??
      metaRecord.google_review_count ??
      metaRecord.reviews ??
      metaRecord._reviews ??
      metaRecord.review_count ??
      metaRecord._review_count ??
      metaRecord.rating_count ??
      metaRecord._rating_count,
  );
  const metaOpenNowRaw =
    metaRecord._is_open_now ??
    metaRecord.is_open_now ??
    metaRecord.open_now ??
    metaRecord._open_now;
  const metaHoursRaw = parseOpenHoursMeta(
    metaRecord._opening_hours ?? metaRecord.opening_hours,
  );
  const perDayHours = parseListeoOpeningHourMeta(metaRecord);
  const metaHours = perDayHours.weeklyHours.length ? perDayHours : metaHoursRaw;
  const metaOpenNow =
    metaOpenNowRaw === undefined || metaOpenNowRaw === null || metaOpenNowRaw === ""
      ? undefined
      : truthyMeta(metaOpenNowRaw);
  const cafeTypes = metaValueItems(meta.cafe_type).map((item) => item.label).filter(Boolean);
  const accessibility = Object.entries(meta.accessibility ?? {})
    .filter(([, v]) => truthyMeta(v))
    .map(([k]) => decodeHtml(k));
  const itinerary = parseItinerary(meta._trip_itinerary);
  const faqs = parseFaqs(meta._trip_faqs);
  const groupSize = decodeHtml(String(meta._trip_group_size ?? "")).trim();
  const tripDaysRaw = decodeHtml(String(meta._trip_single_multi_days ?? "")).trim();
  const tripDays = itinerary.length || groupSize ? tripDaysRaw : "";
  const taxonomies = extractTaxonomies(raw, extras?.taxMaps);
  const classCategorySlugs = (raw.class_list ?? [])
    .filter((value) => value.startsWith("listing_category-"))
    .map((value) => value.slice("listing_category-".length))
    .filter(Boolean);
  if (classCategorySlugs.length) {
    const existing = taxonomies.find((group) => group.key === "listing_category");
    const seen = new Set(existing?.terms.map((term) => term.slug) ?? []);
    const classTerms = classCategorySlugs
      .filter((slug) => !seen.has(slug))
      .map((slug) => ({
        name: slug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        slug,
      }));
    if (classTerms.length) {
      if (existing) existing.terms.push(...classTerms);
      else taxonomies.unshift({ key: "listing_category", label: TAX_LABELS.listing_category, terms: classTerms });
    }
  }
  const profile = profileFromSlugs([
    ...classCategorySlugs,
    ...taxonomies.flatMap((group) => group.terms.map((term) => term.slug)),
    kind,
    category,
  ]);
  // Category profiles are the visitor-facing schema. JetEngine exposes a shared
  // meta object, but a listing must only render fields belonging to its profile.
  // Unknown/category-specific fields must never leak into another listing type.
  const rawMetaGroups = profile
    ? extractProfileMetaGroups(meta as Record<string, unknown>, profile)
    : extractAllMetaGroups(meta as Record<string, unknown>);

  const menuImages = extractMenuImages(meta.dining_menu_images);
  const gallery = extractGalleryMeta(metaRecord._gallery);
  const listeo = contactFromListeoMeta(meta as Record<string, unknown>);
  return {
    slug: raw.slug,
    seo: mapYoastSeo(raw),
    name,
    category,
    kind,
    rating: archiveCard
      ? Number.isFinite(archiveRating) && archiveRating > 0 ? archiveRating : 0
      : Number.isFinite(metaRating) && metaRating > 0 ? metaRating : (local?.rating ?? 0),
    reviews: archiveCard
      ? Number.isFinite(archiveReviews) && archiveReviews > 0 ? archiveReviews : 0
      : Number.isFinite(metaReviews) && metaReviews > 0 ? metaReviews : (local?.reviews ?? 0),
    location: local?.location ?? region,    area: local?.area ?? region,
    distance: "",
    hours: archiveCard ? "" : metaHours.hours || local?.hours || "",
    // Keep the lightweight archive's authoritative status when present, but
    // fall back to other supported status keys rather than hiding the badge.
    openNow: archiveCard
      ? archiveOpen ??
        metaOpenNow ??
        (metaHours.weeklyHours.length
          ? isOpenAt(metaHours.weeklyHours)
          : hoursStatusFromLabel(metaHours.hours))
      : metaOpenNow,
    weeklyHours: archiveCard ? undefined : (metaHours.weeklyHours.length ? metaHours.weeklyHours : undefined),
    description: description || local?.description || "",
    contentHtml: contentHtml || undefined,
    tags: tags.length ? tags : (local?.tags ?? []),
    bestFor: local?.bestFor ?? [],
    image: archiveCard ? featuredImage : (image === FALLBACK_IMAGE[category] && local?.image ? local.image : image),
    siteUrl: raw.link ?? `${WP_ORIGIN}/listing/${raw.slug}/`,
    wpId: raw.id,
    siteViewCount: Math.max(0, Number(metaRecord._listing_views_count ?? metaRecord.listing_views_count ?? 0) || 0),
    appViewCount: Math.max(0, Number(raw.xplore_view_count ?? 0) || 0),
    authorId: raw.author || undefined,
    featuredMediaId: raw.featured_media || undefined,
    lat: archiveCard
      ? Number.isFinite(archiveLat) ? archiveLat : undefined
      : listeo.lat ?? local?.lat,
    lng: archiveCard
      ? Number.isFinite(archiveLng) ? archiveLng : undefined
      : listeo.lng ?? local?.lng,
    price: local?.price,
    priceRangeFilter: normalizeFoodMetaDisplayValue(metaRecord.price_range_filter ?? metaRecord._price_range_filter) || undefined,
    priceForTwo: normalizeFoodMetaDisplayValue(metaRecord.price_for_two ?? metaRecord._price_for_two) || undefined,
    mustTry: local?.mustTry,
    duration: local?.duration || tripDays,
    entry: local?.entry,
    // The live WordPress catalog is authoritative for archive ranking.
    // Never inherit featured/package values from the curated local catalog:
    // those values can be stale and can move non-featured WordPress listings
    // into the Featured section or change the backend package order.
    featured:
      typeof raw.xplore_featured === "boolean"
        ? raw.xplore_featured
        : isFeaturedMeta(meta._featured) ?? false,
    listingPackage: toListingPackage(meta["listing-package"]),
    phone: listeo.phone || local?.phone,
    website: listeo.website || local?.website,
    address: listeo.address || local?.address,
    googlePlaceId: googlePlaceId || local?.googlePlaceId,
    friendlyAddress: archiveCard
      ? archiveFriendlyAddress || undefined
      : decodeHtml(String(meta._friendly_address ?? "")).trim() || local?.friendlyAddress,
    cafeTypes,
    accessibility,
    tripDays,
    groupSize,
    // Preserve the curated/local booking flag when the public REST response
    // does not expose _booking_status. When the field is present, its explicit
    // true/false value remains authoritative.
    bookingEnabled:
      meta._booking_status !== undefined && meta._booking_status !== null && meta._booking_status !== ""
        ? truthyMeta(meta._booking_status)
        : local?.bookingEnabled,
    bookingMinGuests: positiveInteger(meta._min_guests) ?? local?.bookingMinGuests,
    bookingMaxGuests: positiveInteger(meta._max_guests) ?? local?.bookingMaxGuests,
    bookingRegularPrice: positiveInteger(meta._normal_price) ?? local?.bookingRegularPrice,
    bookingWeekendPrice:
      positiveInteger(meta._weekend_price ?? meta._weekday_price) ?? local?.bookingWeekendPrice,
    bookingReservationFee: positiveInteger(meta._reservation_price) ?? local?.bookingReservationFee,
    bookingChildrenDiscount:
      positiveInteger(meta._children_price ?? meta._children_discount) ?? local?.bookingChildrenDiscount,
    bookingAvailableTickets: positiveInteger(meta._event_tickets) ?? local?.bookingAvailableTickets,
    taxonomies,
    metaGroups: rawMetaGroups.length ? rawMetaGroups : undefined,
    // Preserve exact listing_category slugs from both class_list and
    // resolved taxonomy terms. Some REST responses expose the term IDs in
    // listing_category but omit the corresponding class on class_list.
    categorySlugs: [
      ...new Set([
        ...(raw.class_list ?? [])
          .filter((c) => c.startsWith("listing_category-"))
          .map((c) => c.slice("listing_category-".length)),
        ...terms.map((term) => String(term.slug ?? "").trim()).filter(Boolean),
      ]),
    ],
    itinerary,
    faqs,
    menuImages,
    gallery: gallery.length ? gallery : local?.gallery,
  };
}

function mapUser(raw: WpMe): WpUser {
  const avatars = raw.avatar_urls ?? {};
  const avatar = avatars["96"] || avatars["48"] || Object.values(avatars)[0] || "";
  const meta = raw.meta ?? {};
  const value = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = meta[key];
      if (candidate == null) continue;
      const text = String(candidate).trim();
      if (text) return decodeHtml(text);
    }
    return "";
  };
  const fullName = raw.name || raw.slug || "WordPress user";
  const firstName = value("first_name", "first-name", "firstName");
  const lastName = value("last_name", "last-name", "lastName");
  const phone = value("phone", "_phone", "billing_phone", "mobile", "mobile_number", "contact_phone");
  const derivedFirst = firstName || fullName.split(/\s+/)[0] || "";
  const derivedLast = lastName || fullName.split(/\s+/).slice(1).join(" ");
  return {
    id: raw.id,
    name: fullName,
    slug: raw.slug || "",
    email: raw.email || "",
    avatar,
    roles: raw.roles ?? [],
    firstName: derivedFirst || undefined,
    lastName: derivedLast || undefined,
    phone: phone || undefined,
  };
}

function imageSrcFromTag(tag: string) {
  const srcset = tag.match(/\ssrcset="([^"]+)"/i)?.[1] ?? "";
  let best = "";
  let bestW = 0;
  for (const part of srcset.split(",")) {
    const piece = part.trim().match(/(\S+)\s+(\d+)w/);
    if (piece && Number(piece[2]) >= bestW) {
      bestW = Number(piece[2]);
      best = piece[1];
    }
  }
  const src =
    best ||
    tag.match(/\s(?:src|data-src|data-lazy-src|data-full-url)="([^"]+)"/i)?.[1] ||
    "";
  return uncropImage(src);
}

function imageBlocks(html: string): GuideBlock[] {
  const seen = new Set<string>();
  const blocks: GuideBlock[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = imageSrcFromTag(match[0]);
    if (!src || seen.has(src) || /svg|gravatar|emoji|spinner|logo|icon|avatar/i.test(src)) continue;
    if (!/^https?:\/\//i.test(src)) continue;
    seen.add(src);
    const alt = match[0].match(/\salt="([^"]*)"/i)?.[1] ?? "";
    blocks.push({ type: "img", src, alt: decodeHtml(alt) });
  }
  return blocks;
}

function mergeGuideBlocks(blocks: GuideBlock[]) {
  const seenImg = new Set<string>();
  const out: GuideBlock[] = [];
  for (const block of blocks) {
    if (block.type === "img") {
      if (seenImg.has(block.src)) continue;
      seenImg.add(block.src);
    }
    out.push(block);
  }
  return out;
}

function htmlToRichText(html: string) {
  return decodeHtml(
    html
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
        const cleanHref = decodeHtml(String(href ?? "")).trim();
        const cleanLabel = htmlToRichText(String(label ?? ""));
        return cleanHref && cleanLabel ? `[[${cleanLabel}|${cleanHref}]]` : cleanLabel;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<(strong|b)[^>]*>/gi, "**")
      .replace(/<\/(strong|b)>/gi, "**")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\*\*\s+\*\*/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cellText(html: string) {
  return htmlToRichText(html).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function listItems(html: string) {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => htmlToRichText(m[1] ?? ""))
    .filter((item) => item.length > 1);
}

function parseTable(html: string): GuideBlock | null {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1] ?? "")),
  );
  const filled = rows.filter((r) => r.some(Boolean));
  if (filled.length < 2) return null;
  const headers = filled[0];
  const body = filled.slice(1).filter((r) => r.some((c) => c && !headers.includes(c)));
  if (!body.length) return null;
  return { type: "table", headers, rows: body };
}

const SKIP_GUIDE_HEADING =
  /^(login|register|sign in|travel guide|recent guide|table of contents|view all guides|xplore pondy|discover puducherry|get the latest|need help|related|share|comments?)$/i;

const TIP_LABEL =
  /^(shopping tip|travel tip|surf tip|tip|best for|what to look for|suggested walking route|best things to shop for|popular purchases|who can learn\??|best time|what to bring|good to know)$/i;

const CALLOUT_LABEL = /^(xplore pondy verdict|verdict|editor.?s note|note)$/i;

function extractGuideArticleHtml(html: string) {
  let article = html;
  const start = html.search(/data-widget_type="theme-post-content\.default"/i);
  if (start >= 0) {
    const slice = html.slice(start);
    const inner = slice.match(/<div class="elementor-widget-container">([\s\S]*)/i);
    if (inner?.[1] && inner[1].length > 400) article = inner[1];
  } else {
    const entry = html.match(
      /<div[^>]+class="[^"]*(?:elementor-widget-theme-post-content|entry-content|post-content)[^"]*"[\s\S]{0,200}?>([\s\S]*)$/i,
    )?.[1];
    if (entry && entry.length > 400) article = entry;
  }
  const cut = article.search(/<h[1-4][^>]*>[\s\S]{0,80}Recent Guide Articles/i);
  return cut > 200 ? article.slice(0, cut) : article;
}

function extractBalancedDiv(html: string, start: number) {
  const open = html.slice(start).match(/^<div\b[^>]*>/i);
  if (!open) return null;
  const openEnd = start + open[0].length;
  let depth = 1;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = openEnd;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (/^<div\b/i.test(match[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return { start, end: match.index + match[0].length, html: html.slice(start, match.index + match[0].length) };
  }
  return null;
}

function extractGuideListingGridRegions(html: string) {
  const regions: Array<{ start: number; end: number; html: string }> = [];
  for (const hint of html.matchAll(/<div\b[^>]*class=["'][^"']*jet-listing-grid__items[^"']*["'][^>]*>/gi)) {
    const region = extractBalancedDiv(html, hint.index ?? 0);
    if (region) regions.push(region);
  }
  return regions;
}

function listingGridBlockFromHtml(region: string): GuideBlock | null {
  const ids = [...region.matchAll(/(?:data-post-id|data-listing-id)=["'](\d{1,8})["']/gi)]
    .map((m) => Number(m[1]))
    .filter((id) => id > 0);
  const slugs = [...region.matchAll(/href=["'](?:https?:\/\/xplorepondy\.com)?\/listing\/[^"'?#]+\/([^/"'?#]+)\/?["']/gi)]
    .map((m) => decodeHtml(m[1] ?? "").trim())
    .filter((slug) => slug.length > 2);
  if (!ids.length && !slugs.length) return null;
  return { type: "listing-grid", ids: [...new Set(ids)], slugs: [...new Set(slugs)] };
}

function parseGuideBlocks(html: string): GuideBlock[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const pulledTables: GuideBlock[] = [];
  const gridRegions = extractGuideListingGridRegions(cleaned);
  const listingGrids = gridRegions.map((region) => listingGridBlockFromHtml(region.html)).filter((block): block is GuideBlock => Boolean(block));
  const gridTokenMap = new Map<string, GuideBlock>();
  listingGrids.forEach((block, index) => gridTokenMap.set(`%%LISTINGGRID${index}%%`, block));

  // Replace the complete balanced JetEngine grid container, not just text up
  // to its first inner heading. This prevents the grid's own links/images from
  // leaking into the article parser.
  let withGrids = cleaned;
  const indexedGridRegions = gridRegions
    .map((region) => ({ region, block: listingGridBlockFromHtml(region.html) }))
    .filter((entry): entry is { region: (typeof gridRegions)[number]; block: GuideBlock } => Boolean(entry.block));

  for (let i = indexedGridRegions.length - 1; i >= 0; i -= 1) {
    const { region } = indexedGridRegions[i];
    const token = `%%LISTINGGRID${i}%%`;
    withGrids = withGrids.slice(0, region.start) + `<p>${token}</p>` + withGrids.slice(region.end);
  }

  const withTables = withGrids.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    const parsed = parseTable(tableHtml);
    if (!parsed) return " ";
    const token = `%%TABLE${pulledTables.length}%%`;
    pulledTables.push(parsed);
    return `<p>${token}</p>`;
  });

  // Preserve the document order of editorial images. Previously imageBlocks()
  // collected every image first, which made a WordPress image/text/image/text
  // layout render in the PWA as all images followed by all paragraphs.
  const pulledImages: Extract<GuideBlock, { type: "img" }>[] = [];
  const withImages = withTables
    .replace(/<img\b[^>]*>/gi, (imgTag) => {
      const src = imageSrcFromTag(imgTag);
      const alt = imgTag.match(/\salt="([^"]*)"/i)?.[1] ?? "";
      if (!/^https?:\/\//i.test(src) || /svg|gravatar|emoji|spinner|logo|icon|avatar/i.test(src)) return " ";
      const token = `%%IMAGE${pulledImages.length}%%`;
      pulledImages.push({ type: "img", src, alt: decodeHtml(alt) });
      return token;
    })
    // Elementor often wraps the image and paragraphs in layout divs. Those
    // wrappers are presentation-only for the PWA parser.
    .replace(/<\/?div\b[^>]*>/gi, " ");

  const tokens = withImages.split(/(?=<h[3-5]\b|<p\b|<ul\b|<ol\b|%%IMAGE\d+%%)/i);
  const blocks: GuideBlock[] = [];
  let pendingLabel: { kind: "tip" | "callout"; label: string } | null = null;

  const pushPending = (text: string) => {
    if (!pendingLabel || !text) return false;
    blocks.push({ type: pendingLabel.kind, label: pendingLabel.label, text });
    pendingLabel = null;
    return true;
  };

  for (const raw of tokens) {
    if (!raw.trim()) continue;

    // Standalone image tokens can occur outside a paragraph after Elementor
    // wrappers are flattened. Render them directly instead of dropping them.
    const standaloneImage = raw.match(/^%%IMAGE(\d+)%%/);
    if (standaloneImage) {
      const pulled = pulledImages[Number(standaloneImage[1])];
      if (pulled) blocks.push(pulled);
      pendingLabel = null;
      continue;
    }

    const heading = raw.match(/^<h([3-5])\b[^>]*>([\s\S]*?)<\/h\1>/i);
    if (heading) {
      const text = htmlToRichText(heading[2] ?? "").replace(/\*\*/g, "");
      if (text && !SKIP_GUIDE_HEADING.test(text)) blocks.push({ type: "h3", text });
      pendingLabel = null;
      continue;
    }
    const table = raw.match(/^<table\b[\s\S]*?<\/table>/i);
    if (table) {
      const parsed = parseTable(table[0]);
      if (parsed) blocks.push(parsed);
      pendingLabel = null;
      continue;
    }
    const list = raw.match(/^<(ul|ol)\b[\s\S]*?<\/\1>/i);
    if (list) {
      const items = listItems(list[0]);
      if (items.length) {
        if (pendingLabel) {
          blocks.push({ type: pendingLabel.kind, label: pendingLabel.label, text: items.join(" · ") });
          pendingLabel = null;
        } else {
          blocks.push({ type: list[1].toLowerCase() === "ol" ? "ol" : "ul", items });
        }
      }
      continue;
    }
    const para = raw.match(/^<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (para) {
      const inner = para[1] ?? "";
      const imageToken = inner.match(/%%IMAGE(\d+)%%/);
      const tableToken = inner.match(/%%TABLE(\d+)%%/);
      const listingToken = inner.match(/%%LISTINGGRID(\d+)%%/);

      // WordPress often places an aligned image inline inside the same
      // paragraph as the "Best for" text. Keep the image and the remaining
      // paragraph content in document order instead of losing the image to
      // invalid nested <p> markup.
      if (imageToken) {
        const parts = inner.split(/%%IMAGE(\d+)%%/g);
        for (let i = 0; i < parts.length; i += 1) {
          const part = parts[i] ?? "";
          if (i % 2 === 1) {
            const pulled = pulledImages[Number(part)];
            if (pulled) blocks.push(pulled);
            pendingLabel = null;
            continue;
          }
          const textPart = htmlToRichText(part);
          if (!textPart) continue;
          const plainPart = textPart.replace(/\*\*/g, "").trim();
          if (TIP_LABEL.test(plainPart)) {
            pendingLabel = { kind: "tip", label: plainPart.replace(/\s+/g, " ") };
            continue;
          }
          if (CALLOUT_LABEL.test(plainPart)) {
            pendingLabel = { kind: "callout", label: plainPart.replace(/\s+/g, " ") };
            continue;
          }
          const labeledPart = textPart.match(/^\*\*([^*]{2,40})\*\*\s*[:–—-]?\s*([\s\S]+)$/);
          if (labeledPart && TIP_LABEL.test(labeledPart[1].trim())) {
            blocks.push({ type: "tip", label: labeledPart[1].trim(), text: labeledPart[2].trim() });
            pendingLabel = null;
            continue;
          }
          if (labeledPart && CALLOUT_LABEL.test(labeledPart[1].trim())) {
            blocks.push({ type: "callout", label: labeledPart[1].trim(), text: labeledPart[2].trim() });
            pendingLabel = null;
            continue;
          }
          if (pushPending(textPart)) continue;
          blocks.push({ type: "p", text: textPart });
        }
        continue;
      }
      if (listingToken) {
        const pulled = gridTokenMap.get(`%%LISTINGGRID${listingToken[1]}%%`);
        if (pulled) blocks.push(pulled);
        pendingLabel = null;
        continue;
      }
      if (tableToken) {
        const pulled = pulledTables[Number(tableToken[1])];
        if (pulled) blocks.push(pulled);
        pendingLabel = null;
        continue;
      }
      const text = htmlToRichText(inner);
      if (!text) continue;
      const plain = text.replace(/\*\*/g, "").trim();
      if (TIP_LABEL.test(plain)) {
        pendingLabel = { kind: "tip", label: plain.replace(/\s+/g, " ") };
        continue;
      }
      if (CALLOUT_LABEL.test(plain)) {
        pendingLabel = { kind: "callout", label: plain.replace(/\s+/g, " ") };
        continue;
      }
      const labeled = text.match(/^\*\*([^*]{2,40})\*\*\s*[:–—-]?\s*([\s\S]+)$/);
      if (labeled && TIP_LABEL.test(labeled[1].trim())) {
        blocks.push({ type: "tip", label: labeled[1].trim(), text: labeled[2].trim() });
        pendingLabel = null;
        continue;
      }
      if (labeled && CALLOUT_LABEL.test(labeled[1].trim())) {
        blocks.push({ type: "callout", label: labeled[1].trim(), text: labeled[2].trim() });
        pendingLabel = null;
        continue;
      }
      if (pushPending(text)) continue;
      blocks.push({ type: "p", text });
    }
  }
  return mergeGuideBlocks(blocks).slice(0, 250);
}

function parseGuideSections(html: string): GuideSection[] {
  const article = extractGuideArticleHtml(html);
  const hits: { index: number; end: number; heading: string; headingHtml: string }[] = [];
  const headingRe = /<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(article))) {
    const heading = htmlToRichText(match[2] ?? "").replace(/\*\*/g, "");
    if (!heading || SKIP_GUIDE_HEADING.test(heading)) continue;
    hits.push({ index: match.index, end: match.index + match[0].length, heading, headingHtml: match[0] });
  }
  const aliasRe =
    /<ol[^>]*start="\d+"[^>]*>\s*<li[^>]*>\s*(?:<strong[^>]*>)?\s*([^<]{4,90})\s*(?:<\/strong>)?\s*<\/li>\s*<\/ol>/gi;
  while ((match = aliasRe.exec(article))) {
    const heading = htmlToRichText(match[1] ?? "").replace(/\*\*/g, "");
    if (!heading || SKIP_GUIDE_HEADING.test(heading)) continue;
    const nearby = hits.some((h) => Math.abs(h.index - match!.index) < 40);
    if (nearby) continue;
    hits.push({ index: match.index, end: match.index + match[0].length, heading, headingHtml: match[0] });
  }
  hits.sort((a, b) => a.index - b.index);

  const sections: GuideSection[] = [];
  const introHtml = hits.length ? article.slice(0, hits[0].index) : article;
  const introBlocks = parseGuideBlocks(introHtml);
  if (introBlocks.length) {
    sections.push({
      body: introBlocks
        .filter((b): b is Extract<GuideBlock, { type: "p" }> => b.type === "p")
        .map((b) => b.text)
        .join("\n\n"),
      blocks: introBlocks,
    });
  }
  for (let i = 0; i < hits.length; i++) {
    const chunk = article.slice(hits[i].end, hits[i + 1]?.index ?? article.length);
    const blocks = mergeGuideBlocks([...imageBlocks(hits[i].headingHtml), ...parseGuideBlocks(chunk)]);
    const body = blocks
      .map((b) => {
        if (b.type === "p" || b.type === "h3" || b.type === "tip" || b.type === "callout") return "text" in b ? b.text : "";
        if (b.type === "ul" || b.type === "ol") return b.items.join(" ");
        if (b.type === "table") return [...b.headers, ...b.rows.flat()].join(" ");
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (!hits[i].heading && !blocks.length) continue;
    sections.push({ heading: hits[i].heading, body: body.slice(0, 8000), blocks: blocks.length ? blocks : undefined });
  }
  if (sections.length === 0) {
    const body = decodeHtml(article).slice(0, 4000);
    if (body) sections.push({ body, blocks: parseGuideBlocks(article) });
  }
  // WordPress/JetEngine can render some guide headings as listing links.
  // A linked heading means "this place exists in the Xplore Pondy directory",
  // but it does NOT mean that the guide's editorial content should be discarded.
  // Preserve the section's Best-for text and description, while replacing the
  // linked heading/image with the native archive-style listing card.
  // A section heading may be a pure listing link or may contain editorial
  // text around the link (for example: "9:20 AM — [[Sri Aurobindo Ashram|...]]").
  // Treat an Xplore Pondy listing link anywhere in the heading as a listing-backed
  // section so new guide articles do not have to follow one exact heading format.
  const listingHeadingRe =
    /^(.*?)\[\[([^\]|]+)\|https?:\/\/((?:www\.)?xplorepondy\.com)\/listing\/[^/]+\/([^/?#]+)\/?\]\](.*)$/i;
  const normalized: GuideSection[] = [];

  for (const section of sections) {
    const headingText = section.heading?.trim() ?? "";
    const match = headingText.match(listingHeadingRe);
    if (!match) {
      normalized.push(section);
      continue;
    }

    const prefix = match[1]?.trim() ?? "";
    const label = decodeHtml(match[2] ?? "").trim();
    const slug = decodeHtml(match[4] ?? "").trim();
    const suffix = match[5]?.trim() ?? "";
    const title = [prefix, label, suffix].filter(Boolean).join(" ");
    const preservedBlocks = (section.blocks ?? []).filter((block) => block.type !== "img");
    const listingBlock: GuideBlock = {
      type: "listing-grid",
      ids: [],
      slugs: [slug],
    };

    const blocks: GuideBlock[] = [listingBlock, ...preservedBlocks];
    const body = preservedBlocks
      .map((block) => {
        if (block.type === "p" || block.type === "h3" || block.type === "tip" || block.type === "callout") {
          return "text" in block ? block.text : "";
        }
        if (block.type === "ul" || block.type === "ol") return block.items.join(" ");
        if (block.type === "table") return [...block.headers, ...block.rows.flat()].join(" ");
        return "";
      })
      .filter(Boolean)
      .join("\n");

    // Keep the editorial heading above the native listing card. This preserves
    // numbering/time labels and keeps the section in the table of contents.
    normalized.push({
      heading: title,
      body: body.slice(0, 8000),
      blocks,
    });
  }
  return normalized.slice(0, 40);
}

function guideSlugCandidates(slug: string, url?: string) {
  const fromUrl = url?.match(/\/guide\/([^/?#]+)/i)?.[1];
  const aliases = localGuides.flatMap((g) => {
    const siteSlug = g.siteUrl?.match(/\/guide\/([^/?#]+)/i)?.[1];
    if (g.slug === slug || siteSlug === slug || (siteSlug && slug.startsWith(g.slug)) || g.slug.startsWith(slug)) {
      return [g.slug, siteSlug];
    }
    return [];
  });
  return [...new Set([slug, fromUrl, ...aliases].filter((s): s is string => Boolean(s)))];
}

function mapGuide(raw: WpGuide): Guide {
  const local = localGuides.find((g) => g.slug === raw.slug);
  const terms = (raw._embedded?.["wp:term"] ?? []).flat();
  const categories = terms.filter((t) => t.taxonomy?.replace(/_/g, "-") === "guide-category");
  const topicTerm = categories[0] || terms.find((t) => t.taxonomy === "guide-type");
  const tags = terms
    .filter((t) => t.taxonomy && t.taxonomy.replace(/_/g, "-") !== "guide-category")
    .flatMap((t) => [t.name, t.slug])
    .filter((value): value is string => Boolean(value));
  const html = raw.content?.rendered ?? "";
  const sections = parseGuideSections(html);
  const words = sections
    .flatMap((s) => [s.heading ?? "", s.body])
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const date = raw.date
    ? new Date(raw.date).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : local?.date ?? "";
  return {
    slug: raw.slug,
    title: decodeHtml(raw.title?.rendered ?? raw.slug),
    excerpt: decodeHtml(raw.excerpt?.rendered || raw.yoast_head_json?.og_description || "").slice(0, 280),
    date,
    readTime: `${Math.max(1, Math.round(words / 200) || 6)} min`,
    image: guideFeaturedImageUrl(raw._embedded?.["wp:featuredmedia"]?.[0]) || local?.image || "/images/french-quarter.jpg",
    topic: topicTerm?.name ? decodeHtml(topicTerm.name) : local?.topic ?? "Guide",
    categories: categories.map((t) => decodeHtml(t.name ?? "")).filter(Boolean),
    tags: [...new Set(tags.map((tag) => decodeHtml(tag)))],
    siteUrl: raw.link ?? `${WP_ORIGIN}/guide/${raw.slug}/`,
    seo: mapYoastSeo(raw),
    sections: sections.length ? sections : (local?.sections ?? [{ body: "" }]),
  };
}

function guideFromHtml(slug: string, url: string, html: string, seed?: Guide | null): Guide {
  const local = localGuides.find((g) => g.slug === slug) ?? seed ?? null;
  const sections = parseGuideSections(html);
  const og = extractOgImage(html);
  const h1 = htmlToRichText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/\*\*/g, "");
  const words = sections
    .flatMap((s) => [s.heading ?? "", s.body])
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const firstP = sections[0]?.blocks?.find((b) => b.type === "p");
  return {
    slug,
    title: h1 || seed?.title || local?.title || slug,
    excerpt: (firstP && firstP.type === "p" ? firstP.text.replace(/\*\*/g, "") : local?.excerpt || "").slice(0, 280),
    date: seed?.date || local?.date || "",
    readTime: `${Math.max(1, Math.round(words / 200) || Number(String(local?.readTime ?? "6").replace(/\D/g, "")) || 6)} min`,
    image: pickListingImage(og, seed?.image, local?.image) || local?.image || "/images/french-quarter.jpg",
    topic: seed?.topic || local?.topic || "Guide",
    siteUrl: url,
    sections: sections.length ? sections : (seed?.sections ?? local?.sections ?? [{ body: "" }]),
  };
}

async function wpGet<T>(path: string, headers: HeadersInit = {}, timeout = 20000): Promise<{ headers: Headers; data: T; ok: boolean; status: number }> {
  const headerMap = new Headers(headers);
  const authed = headerMap.has("cookie") || headerMap.has("authorization") || headerMap.has("x-wp-nonce");
  if (!authed) {
    const hit = await cachedOriginText(`${WP_ORIGIN}${path}`, CATALOG_TTL, timeout, {
      Accept: "application/json",
      ...headers,
    }).catch(() => null);
    if (!hit) return { headers: new Headers(), data: [] as T, ok: false, status: 0 };
    let data = [] as T;
    try {
      data = JSON.parse(hit.body) as T;
    } catch {
      data = [] as T;
    }
    const wpHeaders = new Headers();
    if (hit.total) wpHeaders.set("X-WP-Total", hit.total);
    if (hit.pages) wpHeaders.set("X-WP-TotalPages", hit.pages);
    return { headers: wpHeaders, data, ok: hit.ok, status: hit.status };
  }
  const res = await fetch(`${WP_ORIGIN}${path}`, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  let data = null as T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = [] as T;
  }
  return { headers: res.headers, data, ok: res.ok, status: res.status };
}

const termsCache = new Map<string, { at: number; map: Map<number, WpTerm> }>();
const termsInFlight = new Map<string, Promise<Map<number, WpTerm>>>();

async function loadTerms(taxonomy: string) {
  const cached = termsCache.get(taxonomy);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.map;
  const inFlight = termsInFlight.get(taxonomy);
  if (inFlight) return inFlight;

  const request = (async () => {
    const map = new Map<number, WpTerm>();
    for (let page = 1; page <= 3; page++) {
      const { data, ok, headers } = await wpGet<WpTerm[]>(
        `/wp-json/wp/v2/${taxonomy}?per_page=100&page=${page}&_fields=id,name,slug,parent,count,meta,cuisine_image`,
      );
      if (!ok || !Array.isArray(data) || data.length === 0) break;
      for (const term of data) if (term.id) map.set(term.id, term);
      const pages = Number(headers.get("X-WP-TotalPages") ?? "1");
      if (page >= pages) break;
    }
    termsCache.set(taxonomy, { at: Date.now(), map });
    return map;
  })();

  termsInFlight.set(taxonomy, request);
  try {
    return await request;
  } finally {
    if (termsInFlight.get(taxonomy) === request) termsInFlight.delete(taxonomy);
  }
}

const mediaCache = new Map<number, string>();

async function loadMedia(ids: number[]) {
  const unique = [...new Set(ids.filter((id) => id > 0))];
  const map = new Map<number, string>();
  const missing = unique.filter((id) => !mediaCache.has(id));

  // Reuse media already resolved during this server process. When a large
  // catalog refresh is needed, fetch at most two media batches at once so
  // recovery never turns 567 listings into a burst of concurrent WordPress
  // requests.
  for (const id of unique) {
    const cached = mediaCache.get(id);
    if (cached) map.set(id, cached);
  }

  const chunks: number[][] = [];
  for (let i = 0; i < missing.length; i += 80) chunks.push(missing.slice(i, i + 80));

  for (let i = 0; i < chunks.length; i += 2) {
    const batch = chunks.slice(i, i + 2);
    const pages = await Promise.all(
      batch.map((chunk) =>
        wpGet<WpMedia[]>(
          `/wp-json/wp/v2/media?include=${chunk.join(",")}&per_page=80&_fields=id,source_url,media_details`,
        ),
      ),
    );
    for (const { data, ok } of pages) {
      if (!ok || !Array.isArray(data)) continue;
      for (const m of data) {
        if (!m.id) continue;
        const url = mediaUrl(m);
        if (!url) continue;
        mediaCache.set(m.id, url);
        map.set(m.id, url);
      }
    }
  }

  return map;
}

function isDescendantTerm(term: WpTerm, rootId: number, terms: Map<number, WpTerm>) {
  let parent = term.parent;
  const seen = new Set<number>();
  while (parent && !seen.has(parent)) {
    if (parent === rootId) return true;
    seen.add(parent);
    parent = terms.get(parent)?.parent ?? 0;
  }
  return false;
}


/**
 * Resolve one archive subtree without downloading the entire listing_category
 * taxonomy. An Explore category only needs one small hierarchical branch.
 */
const categoryTermIdsCache = new Map<string, { at: number; ids: number[] }>();

/** Resolve only the root term. REST can include all descendants in the post query. */
async function loadCategoryTermId(categorySlug: string): Promise<number | null> {
  const cached = categoryTermIdsCache.get(categorySlug);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.ids[0] ?? null;
  const rootRes = await wpGet<WpTerm[]>(
    "/wp-json/wp/v2/listing_category?slug=" + encodeURIComponent(categorySlug) + "&per_page=1&_fields=id",
  );
  const id = Number(rootRes.data?.[0]?.id ?? 0);
  if (!rootRes.ok || !id) return null;
  categoryTermIdsCache.set(categorySlug, { at: Date.now(), ids: [id] });
  return id;
}

async function loadCategoryTermIdDirect(categorySlug: string): Promise<number | null> {
  const cached = categoryTermIdsCache.get(categorySlug);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.ids[0] ?? null;
  const response = await fetch(
    WP_ORIGIN + "/wp-json/wp/v2/listing_category?slug=" +
      encodeURIComponent(categorySlug) + "&per_page=1&_fields=id",
    { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as unknown;
  const id = Array.isArray(data) ? Number((data[0] as WpTerm | undefined)?.id ?? 0) : 0;
  if (!id) return null;
  categoryTermIdsCache.set(categorySlug, { at: Date.now(), ids: [id] });
  return id;
}
let listingCategoryTreeCache: { at: number; terms: ListingCategoryTerm[] } | null = null;
const CATEGORY_TREE_TTL = 10 * 60_000;

function mapListingCategoryTerm(row: WpTerm): ListingCategoryTerm | null {
  const id = Number(row.id ?? 0);
  const slug = String(row.slug ?? "").trim();
  if (!id || !slug) return null;
  return {
    id,
    slug,
    name: decodeHtml(String(row.name ?? slug)),
    parent: Number(row.parent ?? 0) || 0,
    count: Number(row.count ?? 0) || 0,
    categoryPosition: (() => {
      const raw = row.meta?.category_position;
      if (raw === null || raw === undefined || raw === "") return null;
      const position = Number(raw);
      return Number.isFinite(position) && position > 0 ? position : null;
    })(),
    imageId: (() => {
      const raw = row.meta?.listing_category_image;
      const id = typeof raw === "object" && raw !== null && "id" in raw
        ? Number((raw as { id?: unknown }).id)
        : Number(raw);
      return Number.isInteger(id) && id > 0 ? id : undefined;
    })(),
  };
}

async function loadListingCategoryTreeDirect(): Promise<ListingCategoryTerm[]> {
  const terms: ListingCategoryTerm[] = [];
  for (let page = 1; page <= 6; page += 1) {
    const response = await fetch(
      `${WP_ORIGIN}/wp-json/wp/v2/listing_category?per_page=100&page=${page}&_fields=id,slug,name,parent,count,meta`,
      {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) break;
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const row of data as WpTerm[]) {
      const mapped = mapListingCategoryTerm(row);
      if (mapped) terms.push(mapped);
    }
    if (data.length < 100) break;
  }
  return terms;
}

async function loadListingCategoryTree(): Promise<ListingCategoryTerm[]> {
  const terms: ListingCategoryTerm[] = [];
  for (let page = 1; page <= 6; page += 1) {
    const response = await wpGet<WpTerm[]>(
      `/wp-json/wp/v2/listing_category?per_page=100&page=${page}&_fields=id,slug,name,parent,count,meta`,
      {},
      15000,
    );
    if (!response.ok || !Array.isArray(response.data) || response.data.length === 0) break;
    for (const row of response.data) {
      const mapped = mapListingCategoryTerm(row);
      if (mapped) terms.push(mapped);
    }
    if (response.data.length < 100) break;
  }
  return terms;
}

export async function fetchWpListingCategoriesFromOrigin(): Promise<ListingCategoryTerm[]> {
  if (listingCategoryTreeCache && Date.now() - listingCategoryTreeCache.at < CATEGORY_TREE_TTL) {
    return listingCategoryTreeCache.terms;
  }
  const terms = await loadListingCategoryTreeDirect();
  if (terms.length) listingCategoryTreeCache = { at: Date.now(), terms };
  return terms;
}

function cuisineImageValue(term: WpTerm): unknown {
  return term.meta?.cuisine_image ?? term.cuisine_image;
}

function cuisineImageId(value: unknown): number | undefined {
  if (Array.isArray(value)) return cuisineImageId(value[0]);
  if (typeof value === "number" || typeof value === "string") {
    const raw = String(value).trim();
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return cuisineImageId(record.id ?? record.ID ?? record.media_id ?? record.value);
  }
  return undefined;
}

function cuisineImageDirectUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) return cuisineImageDirectUrl(value[0]);
  if (typeof value === "string") {
    const candidate = value.trim();
    return /^https?:\/\//i.test(candidate) ? candidate : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "source_url", "src"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) return candidate.trim();
    }
  }
  return undefined;
}

export const fetchWpCuisineTypes = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const terms = await loadTerms("cuisine-type");
    const rows = [...terms.values()].filter(
      (term) => term.slug && term.name && Number(term.count ?? 0) > 0,
    );
    const imageIds = rows
      .map((term) => cuisineImageId(cuisineImageValue(term)))
      .filter((id): id is number => Number.isInteger(id) && (id ?? 0) > 0);
    const mediaMap = imageIds.length
      ? await loadMedia(imageIds).catch(() => new Map<number, string>())
      : new Map<number, string>();

    return {
      terms: rows
        .map((term) => {
          const value = cuisineImageValue(term);
          const imageId = cuisineImageId(value);
          const image = cuisineImageDirectUrl(value) ?? (imageId ? mediaMap.get(imageId) : undefined);
          return {
            id: Number(term.id),
            name: decodeHtml(term.name),
            slug: term.slug,
            count: Number(term.count ?? 0),
            image,
          };
        })
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  } catch {
    return { terms: [] as { id: number; name: string; slug: string; count: number; image?: string }[] };
  }
});

/**
 * Return live food listings with the human-readable cuisine taxonomy attached.
 * The compact archive mapper gets taxonomy IDs, but does not resolve those IDs
 * to term slugs; cuisine archives need that mapping to filter rows correctly.
 */
export const fetchWpCuisineListings = createServerFn({ method: "GET" }).handler(async () => {
  const wpCatalog = await loadAllListingPages({ categorySlug: "food-beverage", perPage: 100 });
  if (!wpCatalog.rows.length) return { listings: [] as Listing[], total: 0 };

  const taxonomyKeys = ["cuisine-type", "restaurant-types", "pub-type", "resto-bar-type"] as const;
  const taxonomyPairs = await Promise.all(taxonomyKeys.map(async (key) => [
    key,
    await loadTerms(key).catch(() => new Map<number, WpTerm>()),
  ] as const));
  const taxMaps = Object.fromEntries(taxonomyPairs) as Record<string, Map<number, WpTerm>>;

  const mediaMap = await loadMedia(
    wpCatalog.rows.map((row) => Number(row.featured_media ?? 0)).filter((id) => Number.isInteger(id) && id > 0),
  ).catch(() => new Map<number, string>());

  const listings = wpCatalog.rows
    .filter((row) => Boolean(row?.slug))
    .map((row) => {
      const listing = mapListing(row, { mediaMap, taxMaps, archiveCard: true });
      const diningGroups = taxonomyKeys.flatMap((key) => {
        const terms = taxIds(row, key).flatMap((id) => {
          const term = taxMaps[key]?.get(id);
          return term?.slug || term?.name
            ? [{ name: decodeHtml(term.name || term.slug), slug: term.slug || String(id) }]
            : [];
        });
        return terms.length
          ? [{ key, label: TAX_LABELS[key] ?? key.replace(/[-_]/g, " "), terms }]
          : [];
      });
      if (!diningGroups.length) return listing;
      return {
        ...listing,
        taxonomies: [
          ...(listing.taxonomies ?? []).filter((group) => !taxonomyKeys.includes(group.key as typeof taxonomyKeys[number])),
          ...diningGroups,
        ],
      };
    })
    .filter((listing): listing is Listing => Boolean(listing));

  return { listings, total: Math.max(wpCatalog.total, listings.length) };
});

export const fetchWpListingCategories = createServerFn({ method: "GET" }).handler(async () => {
  if (listingCategoryTreeCache && Date.now() - listingCategoryTreeCache.at < CATEGORY_TREE_TTL) {
    return { terms: listingCategoryTreeCache.terms };
  }
  try {
    const terms = await loadListingCategoryTree();
    if (terms.length) {
      const imageIds = [...new Set(terms.map((term) => term.imageId).filter((id): id is number => Number.isInteger(id) && (id ?? 0) > 0))];
      const media = imageIds.length ? await loadMedia(imageIds) : new Map<number, string>();
      const enrichedTerms = terms.map((term) => ({
        ...term,
        image: term.imageId ? media.get(term.imageId) : undefined,
      }));
      listingCategoryTreeCache = { at: Date.now(), terms: enrichedTerms };
      return { terms: enrichedTerms };
    }
    return { terms };
  } catch {
    return { terms: listingCategoryTreeCache?.terms ?? [] };
  }
});

const CATALOG_REST_FIELDS = [
  "id,slug,title,link,featured_media,listing_category,region,listing_feature,cuisine-type,restaurant-types,pub-type,resto-bar-type,class_list",
  // Some listings expose these card fields only through the standard REST
  // meta projection, while others expose them through xplore_archive_meta.
  // Include both sources so initial archive cards do not need a detail-page
  // visit before friendly addresses and Open Now status can render.
  "meta,xplore_archive_meta,xplore_meta,xplore_featured",
].join(",");

// Saved-place lookups also request the REST-exposed metadata that may contain
// Listeo coordinates; regular archive pages stay compact for performance.
const SAVED_LISTING_REST_FIELDS = [
  "id,slug,title,link,featured_media,listing_category,region,listing_feature,class_list",
  "meta,xplore_archive_meta,xplore_featured,xplore_meta",
].join(",");

const LISTING_REST_FIELDS = [
  "id,slug,title,link,content,excerpt,featured_media,listing_category,region,listing_feature,class_list",
  "meta,xplore_archive_meta,xplore_featured,yoast_head_json",
].join(",");

export const CATALOG_PAGE_SIZE = 50;

function listingRestPath(
  page: number,
  perPage: number,
  categoryQuery = "",
  offset?: number,
  fields = CATALOG_REST_FIELDS,
  search = "",
) {
  // Do not use `_embed` here. Combined with `_fields`, this WordPress stack
  // returns an empty `_embedded` object. Categories come from `class_list`;
  // images are resolved with a follow-up /media request.
  //
  // Never send both page>1 and offset: WordPress applies both skip mechanisms
  // and silently drops a whole page (the 467/567 failure).
  const per = Math.min(Math.max(perPage, 1), 100);
  const useOffset = offset != null;
  const p = useOffset ? 1 : Math.max(1, Math.floor(page));
  const offsetQuery = useOffset ? `&offset=${Math.max(0, Math.floor(offset))}` : "";
  // The default archive is ordered by the WordPress backend before
  // pagination: _featured=on first, then _featured=0, then
  // listing-package ascending, with WordPress source order for ties.
  // This custom parameter is opt-in so other REST consumers keep normal
  // WordPress ordering.
  const archiveOrder =
    fields === CATALOG_REST_FIELDS && !search.trim()
      ? "&xplore_archive_order=1"
      : "";
  const searchQuery = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : "";
  return `/wp-json/wp/v2/listing?per_page=${per}&page=${p}${offsetQuery}${categoryQuery}${archiveOrder}${searchQuery}&_fields=${fields}`;
}

function mapCatalogPage(
  rows: WpListing[],
  total: number,
  pages: number,
  page: number,
  mediaMap?: Map<number, string>,
) {
  const listings = rows
    .filter((row) => Boolean(row?.slug))
    .map((row) => mapListing(row, { ...(mediaMap ? { mediaMap } : {}), archiveCard: true }))
    .filter((row): row is Listing => Boolean(row))
    .sort((a, b) => {
      // Default archive order: Featured first, then lower listing-package
      // values. Keep the REST order for ties so WordPress remains the final
      // deterministic tie-breaker.
      const featuredOrder = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      if (featuredOrder !== 0) return featuredOrder;

      const aPackage = Number(a.listingPackage);
      const bPackage = Number(b.listingPackage);
      const aValue = Number.isFinite(aPackage) ? aPackage : Number.POSITIVE_INFINITY;
      const bValue = Number.isFinite(bPackage) ? bPackage : Number.POSITIVE_INFINITY;
      return aValue - bValue;
    });
  return {
    listings,
    total: Math.max(total, listings.length),
    pages,
    page,
  };
}

async function loadMediaMapFromOrigin(ids: number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, string>();
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    try {
      const response = await fetch(
        `${WP_ORIGIN}/wp-json/wp/v2/media?include=${chunk.join(",")}&per_page=80&_fields=id,source_url,media_details`,
        { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) continue;
      const data = (await response.json()) as WpMedia[];
      if (!Array.isArray(data)) continue;
      for (const media of data) {
        if (!media.id) continue;
        const url = mediaUrl(media);
        if (url) map.set(media.id, url);
      }
    } catch {
      // Keep category fallback images if media is blocked.
    }
  }
  return map;
}

export async function fetchWpMediaFromOrigin(ids: number[]) {
  return loadMediaMapFromOrigin(ids);
}

async function fetchWpCatalogSliceFromOrigin(offset: number, perPage: number, categoryQuery = "", search = "") {
  const per = Math.min(Math.max(perPage, 1), 100);
  const off = Math.max(0, Math.floor(offset));
  const response = await fetch(`${WP_ORIGIN}${listingRestPath(1, per, categoryQuery, off, CATALOG_REST_FIELDS, search)}`, {
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  if (response.status === 403) throw new Error("WP_CATALOG_403");
  if (response.status === 400) return { rows: [] as WpListing[], total: 0, pages: 0 };
  if (!response.ok) return null;

  let data: unknown = [];
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const rows = data as WpListing[];
  const total = Number(response.headers.get("X-WP-Total") ?? rows.length);
  const pages = Number(response.headers.get("X-WP-TotalPages") || Math.ceil(total / per) || 0);
  return { rows, total, pages };
}

/**
 * Browser-direct WordPress REST fetch. Hostinger CDN/WAF 403s the PWA
 * server IP, but allows the visitor's browser (CORS is open for the app).
 *
 * Catalog pages use compact fields (no post_content) and offset addressing.
 * A failed page is recovered as two smaller offset slices so a single 50/100
 * timeout cannot strand the directory at 467/567.
 */
export async function fetchWpCatalogPageFromOrigin(
  page = 1,
  perPage = CATALOG_PAGE_SIZE,
  categorySlug?: string,
  search = "",
) {
  const per = Math.min(Math.max(perPage, 1), 100);
  const p = Math.max(1, Math.floor(page));
  const offset = (p - 1) * per;
  const categoryQuery = categorySlug
    ? await resolveCategoryQueryDirect(categorySlug)
    : "";

  const recover = async () => {
    const half = Math.max(10, Math.ceil(per / 2));
    const chunks = await Promise.all([
      fetchWpCatalogSliceFromOrigin(offset, half, categoryQuery, search).catch(() => null),
      fetchWpCatalogSliceFromOrigin(offset + half, Math.max(1, per - half), categoryQuery, search).catch(() => null),
    ]);
    const rows = chunks.flatMap((chunk) => chunk?.rows ?? []);
    if (!rows.length) return null;
    const total = Math.max(...chunks.map((chunk) => chunk?.total ?? 0), rows.length);
    const pages = Math.max(1, Math.ceil(total / per));
    return mapCatalogPage(rows, total, pages, p);
  };

  try {
    const slice = await fetchWpCatalogSliceFromOrigin(offset, per, categoryQuery, search);
    if (!slice || !slice.rows.length) {
      const recovered = await recover();
      if (recovered) return recovered;
      return { listings: [] as Listing[], total: slice?.total ?? 0, pages: slice?.pages ?? 0, page: p };
    }
    const pages = Math.max(slice.pages, Math.ceil(slice.total / per) || 0);
    return mapCatalogPage(slice.rows, slice.total, pages, p);
  } catch (error) {
    const recovered = await recover();
    if (recovered) return recovered;
    throw error;
  }
}

async function resolveCategoryQuery(categorySlug?: string): Promise<string> {
  if (!categorySlug) return "";
  const id = await loadCategoryTermId(categorySlug);
  return id ? `&listing_category[terms]=${id}&listing_category[include_children]=true` : "&listing_category=0";
}

async function resolveCategoryQueryDirect(categorySlug?: string): Promise<string> {
  if (!categorySlug) return "";
  const id = await loadCategoryTermIdDirect(categorySlug);
  if (!id) throw new Error("WP_CATEGORY_LOOKUP_FAILED");
  return `&listing_category[terms]=${id}&listing_category[include_children]=true`;
}

async function loadListingPages(options: { category?: Category; categorySlug?: string; page?: number; perPage?: number; offset?: number; search?: string } = {}) {
  const perPage = Math.min(Math.max(options.perPage ?? CATALOG_PAGE_SIZE, 1), 100);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const offset = options.offset;
  const search = options.search?.trim() ?? "";
  const categorySlug =
    options.categorySlug ??
    (options.category ? WP_PARENT_ARCHIVES.find((row) => row.category === options.category)?.slug : undefined);
  let categoryQuery = "";
  if (categorySlug) {
    categoryQuery = await resolveCategoryQuery(categorySlug);
  }
  const response = await wpGet<WpListing[]>(
    listingRestPath(page, perPage, categoryQuery, offset, CATALOG_REST_FIELDS, search),
    {},
    25000,
  );
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("WP_CATALOG_403");
    }
    return { rows: [], total: 0, pages: 0 };
  }
  if (!Array.isArray(response.data)) return { rows: [], total: 0, pages: 0 };
  const total = Number(response.headers.get("X-WP-Total") ?? response.data.length);
  const pages = Number(response.headers.get("X-WP-TotalPages") ?? Math.ceil(total / perPage));
  return { rows: response.data, total, pages };
}

async function loadAllListingPages(options: { categorySlug?: string; perPage?: number } = {}): Promise<{ rows: WpListing[]; total: number; pages: number }> {
  const perPage = Math.min(Math.max(options.perPage ?? CATALOG_PAGE_SIZE, 1), 100);
  const first = await loadListingPages({ page: 1, perPage, categorySlug: options.categorySlug });
  if (!first.rows.length) return first;
  const rows = [...first.rows];
  const totalPages = Math.max(1, first.pages, Math.ceil(first.total / perPage));

  for (let start = 2; start <= totalPages; start += 2) {
    const pageNumbers = [start, start + 1].filter((page) => page <= totalPages);
    const results = await Promise.all(
      pageNumbers.map(async (page) => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const next =
            attempt === 3
              ? await loadListingPages({
                  page: 1,
                  perPage,
                  categorySlug: options.categorySlug,
                  offset: (page - 1) * perPage,
                })
              : await loadListingPages({ page, perPage, categorySlug: options.categorySlug });
          if (next.rows.length) return next;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 600));
        }
        return { rows: [] as WpListing[], total: first.total, pages: totalPages };
      }),
    );
    for (const next of results) rows.push(...next.rows);
  }

  const unique = new Map<number, WpListing>();
  for (const row of rows) if (row?.id) unique.set(row.id, row);
  const deduped = unique.size ? [...unique.values()] : rows;
  return { rows: deduped, total: Math.max(first.total, deduped.length), pages: totalPages };
}
function isFeaturedMeta(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true" ||
    value === "yes" ||
    value === "on"
  ) return true;
  if (value === false || value === 0 || value === "0" || value === "false" || value === "no") return false;
  return undefined;
}

function toListingPackage(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) {
    return toListingPackage(value[0]);
  }
  if (typeof value === "object") return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function mergeLocal(listings: Listing[]) {
  const seen = new Set(listings.map((l) => l.slug));
  for (const l of listings) seen.add(urlTail(l.siteUrl));
  const extras: Listing[] = [];
  for (const extra of localListings) {
    if (seen.has(extra.slug) || seen.has(urlTail(extra.siteUrl))) continue;
    extras.push(extra);
  }
  return [...listings, ...extras];
}

let catalogCache: { at: number; listings: Listing[]; total: number; v: number } | null = null;
let guidesCache: { at: number; guides: Guide[] } | null = null;
const guideCategoryCache = new Map<string, { at: number; guides: Guide[] }>();
const GUIDE_CATEGORY_CACHE_TTL = 5 * 60_000;
const listingPageCache = new Map<string, { at: number; listing: Listing }>();
const savedListingsByIdsCache = new Map<string, { at: number; result: { listings: Listing[] } }>();
const savedListingsByIdsInflight = new Map<string, Promise<{ listings: Listing[] }>>();
// Collapse concurrent detail requests for the same slug into one WordPress fetch.
const listingPageInflight = new Map<string, Promise<Listing | null>>();
const CATALOG_TTL = 60_000;
const CATALOG_STALE = 5 * 60_000;
const LISTING_PAGE_TTL = 5 * 60_000;
const HTML_TTL = 60_000;
const CATALOG_VERSION = 64;

async function loadCatalogFromWp(): Promise<{ listings: Listing[]; total: number }> {
  // The PWA catalog is the single directory source. Load every REST page
  // sequentially so the client can derive all primary/secondary categories
  // and filters locally without requesting category archives.
  const wpCatalog = await loadAllListingPages();

  if (wpCatalog.rows.length > 0) {
    // REST is the authoritative catalog source. Do not append the curated
    // local set here: the client must see the actual WordPress directory.
    // Featured media is embedded in the same REST request, avoiding another
    // fan-out of media requests while WordPress is under load.
    // Do not put the Listeo geo/AJAX feed on the critical path.
    // The embedded media object is not guaranteed to survive every
    // WordPress/_fields/cache combination. Resolve featured_media IDs in
    // small batches as a recovery path so the full catalog does not fall back
    // to one generic category image.
    const mediaMap = await loadMedia(
      wpCatalog.rows
        .map((row) => Number(row.featured_media ?? 0))
        .filter((id) => Number.isInteger(id) && id > 0),
    ).catch(() => new Map<number, string>());

    // The lightweight archive response includes cuisine taxonomy IDs, but
    // IDs alone are not useful to the client. Resolve the cuisine terms once
    // per catalog refresh and attach readable names/slugs to each listing.
    const taxonomyKeys = ["cuisine-type", "restaurant-types", "pub-type", "resto-bar-type"] as const;
    const taxonomyPairs = await Promise.all(taxonomyKeys.map(async (key) => [
      key,
      await loadTerms(key).catch(() => new Map<number, WpTerm>()),
    ] as const));
    const taxMaps = Object.fromEntries(taxonomyPairs) as Record<string, Map<number, WpTerm>>;
    const restListings = wpCatalog.rows
      .filter((row) => Boolean(row?.slug))
      .map((row) => {
        const listing = mapListing(row, { mediaMap, taxMaps, archiveCard: true });
        // Archive payloads can expose taxonomy IDs while card mapping omits
        // the richer taxonomy fields. Resolve dining taxonomies explicitly.
        const diningGroups = taxonomyKeys.flatMap((key) => {
          const terms = taxIds(row, key).flatMap((id) => {
            const term = taxMaps[key]?.get(id);
            return term?.slug || term?.name
              ? [{ name: decodeHtml(term.name || term.slug), slug: term.slug || String(id) }]
              : [];
          });
          return terms.length
            ? [{ key, label: TAX_LABELS[key] ?? key.replace(/[-_]/g, " "), terms }]
            : [];
        });
        if (!diningGroups.length) return listing;
        const taxonomies = [
          ...(listing.taxonomies ?? []).filter((group) => !taxonomyKeys.includes(group.key as typeof taxonomyKeys[number])),
          ...diningGroups,
        ];
        return { ...listing, taxonomies };
      })
      .filter((row): row is Listing => Boolean(row));

    // REST already carries the authoritative Listeo/CMB2 meta exposed by the
    // listing endpoint: phone, address/friendly address, coordinates, ratings,
    // booking settings and JetEngine meta. Do not fan out into the legacy
    // Listeo AJAX geo feed when REST is healthy. That feed requests every
    // catalog page and can create dozens of expensive admin-ajax.php calls,
    // which is especially harmful when WordPress is already under load.
    const listings = restListings;
    return {
      listings,
      total: Math.max(wpCatalog.total, listings.length),
    };
  }

  // Archive cards must never fall back to curated/Listeo geo data:
  // those sources do not guarantee the exact WordPress fields required by
  // the card contract (_combined_rating, _combined_review_count,
  // _is_open_now, _friendly_address, and geolocation coordinates).
  throw new Error("live-catalog-rest-empty");
}

// GUIDE-ONLY PATH: travel_guide has no JetEngine listing meta payload for its
// article body, so guide detail/list loading may use the rendered HTML source.
async function loadGuidesFromWp(): Promise<Guide[]> {
  const first = await wpGet<WpGuide[]>(
    "/wp-json/wp/v2/travel_guide?per_page=100&page=1&_embed=1",
    {},
    25000,
  );
  if (!first.ok || !Array.isArray(first.data) || first.data.length === 0) return localGuides;

  const pages = Math.max(1, Number(first.headers.get("X-WP-TotalPages") ?? "1") || 1);
  const rows = [...first.data];

  // Some WordPress/proxy configurations cap a collection below the requested
  // per_page value. Respect X-WP-TotalPages so all published guides are still
  // loaded instead of silently stopping after the first response.
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        wpGet<WpGuide[]>(
          `/wp-json/wp/v2/travel_guide?per_page=100&page=${index + 2}&_embed=1`,
          {},
          25000,
        ),
      ),
    );
    for (const response of rest) {
      if (response.ok && Array.isArray(response.data)) rows.push(...response.data);
    }
  }

  const mapped = rows.map(mapGuide);
  const unique = new Map<string, Guide>();
  for (const guide of mapped) {
    if (guide.slug && !unique.has(guide.slug)) unique.set(guide.slug, guide);
  }
  const seen = new Set(unique.keys());
  const extras = localGuides.filter((g) => !seen.has(g.slug));
  return [...unique.values(), ...extras];
}

let catalogRefresh: Promise<void> | null = null;

function refreshCatalog() {
  if (catalogRefresh) return catalogRefresh;
  catalogRefresh = loadCatalogFromWp()
    .then((fresh) => {
      if (fresh.listings.length >= 300) {
        catalogCache = { at: Date.now(), v: CATALOG_VERSION, ...fresh };
      }
    })
    .catch(() => undefined)
    .finally(() => {
      catalogRefresh = null;
    });
  return catalogRefresh;
}

export const fetchWpCatalogPage = createServerFn({ method: "GET" })
  .validator(z.object({
    page: z.number().int().min(1).default(1),
    perPage: z.number().int().min(1).max(100).default(50),
    categorySlug: z.string().trim().min(1).optional(),
    search: z.string().trim().max(120).optional(),
  }))
  .handler(async ({ data }) => {
    const result = await loadListingPages({
      page: data.page,
      perPage: data.perPage,
      categorySlug: data.categorySlug,
      search: data.search,
    });

    // Resolve cuisine-type IDs into the human-readable term names/slugs used
    // by global search and the live autocomplete. loadTerms caches for five
    // minutes and shares in-flight requests, so page batches don't fan out
    // repeated taxonomy requests.
    const [mediaMap, cuisineTypeMap] = await Promise.all([
      loadMedia(result.rows.map((row) => Number(row.featured_media ?? 0)))
        .catch(() => new Map<number, string>()),
      loadTerms("cuisine-type").catch(() => new Map<number, WpTerm>()),
    ]);
    const listings = result.rows
      .filter((row) => Boolean(row?.slug))
      .map((row) => mapListing(row, {
        mediaMap,
        taxMaps: { "cuisine-type": cuisineTypeMap },
      }))
      .filter((row): row is Listing => Boolean(row));

    return {
      listings,
      total: Math.max(result.total, listings.length),
      pages: result.pages,
      page: data.page,
    };
  });

function hasValidMapCoordinates(value: { lat?: number; lng?: number }): value is { lat: number; lng: number } {
  return typeof value.lat === "number"
    && Number.isFinite(value.lat)
    && value.lat >= -90
    && value.lat <= 90
    && typeof value.lng === "number"
    && Number.isFinite(value.lng)
    && value.lng >= -180
    && value.lng <= 180
    && !(value.lat === 0 && value.lng === 0);
}

export const fetchWpListingsByIds = createServerFn({ method: "GET" })
  .validator(
    z.object({
      ids: z.array(z.number().int().positive()).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const ids = [...new Set(data.ids)];
    if (!ids.length) return { listings: [] as Listing[] };

    const cacheKey = ids.slice().sort((a, b) => a - b).join(",");
    const cached = savedListingsByIdsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.result;
    const inflight = savedListingsByIdsInflight.get(cacheKey);
    if (inflight) return inflight;

    const request = (async (): Promise<{ listings: Listing[] }> => {

    // Request embedded featured media and terms with each targeted listing
    // batch so cards do not need an extra attachment REST lookup. Keep the
    // conservative chunk size because some WordPress/Listeo deployments cap
    // include-filter responses and silently omit IDs from larger requests.
    const idChunks: number[][] = [];
    for (let index = 0; index < ids.length; index += 8) {
      idChunks.push(ids.slice(index, index + 8));
    }
    const chunkResults = await Promise.all(
      idChunks.map((chunk) =>
        wpGet<WpListing[]>(
          `/wp-json/wp/v2/listing?include=${chunk.join(",")}&per_page=100&_embed=wp:featuredmedia,wp:term&_fields=${SAVED_LISTING_REST_FIELDS},_embedded&_${Date.now()}`,
          {},
          12000,
        ),
      ),
    );
    const responseRows = new Map<number, WpListing>();
    for (const response of chunkResults) {
      if (!response.ok || !Array.isArray(response.data)) continue;
      for (const row of response.data) {
        const id = Number(row?.id ?? 0);
        if (id > 0 && row?.slug) responseRows.set(id, row);
      }
    }

    // Do not fan out into one slow REST request per missing saved ID. The
    // ID-specific chunk requests above are the primary resolution path; an
    // individual retry for every missing row caused saved/bookmark pages to
    // wait tens of seconds. Return the rows that were resolved by the targeted
    // batch requests and allow a later refresh to retry transient omissions.
    if (!responseRows.size) {
      return { listings: [] as Listing[] };
    }
    // REST may return included posts in publication order rather than the
    // user's saved order; the /saved page applies saved ID order when rendering.
    const rows = [...responseRows.values()];

    // Some WordPress/Listeo REST configurations omit _embedded media when
    // _fields is constrained, even when _embed is requested. Resolve all
    // featured_media IDs in one batched media lookup (cached by loadMedia)
    // so Saved cards receive real image URLs without one request per listing.
    const mediaMap = await loadMedia(rows.map((row) => Number(row.featured_media ?? 0)))
      .catch(() => new Map<number, string>());
    const archiveListings = rows
      .filter((row) => Boolean(row?.slug))
      .map((row) => mapListing(row, { archiveCard: true, mediaMap }))
      .filter((row): row is Listing => Boolean(row));

    // Direct visits to /saved can happen before the full catalog has hydrated.
    // Reuse the same response to derive any additional map/address fields.
    const fullBySlug = new Map(
      rows
        .filter((row) => Boolean(row?.slug))
        .map((row) => [row.slug, mapListing(row, { mediaMap })] as const),
    );

    let listings = archiveListings.map((listing) => {
      if (hasValidMapCoordinates(listing)) return listing;
      const fuller = fullBySlug.get(listing.slug);
      if (!fuller || !hasValidMapCoordinates(fuller)) return listing;
      return {
        ...listing,
        lat: fuller.lat,
        lng: fuller.lng,
        address: listing.address || fuller.address,
        friendlyAddress: listing.friendlyAddress || fuller.friendlyAddress,
      };
    });

    // Keep saved/bookmark lookups narrowly scoped and fast. Do not load the
    // full Listeo geo feed here just because one saved listing lacks coordinates:
    // this endpoint is for resolving a small, explicit set of IDs, not for
    // bootstrapping the map/catalog. Coordinates already present in REST/local
    // listing metadata are retained; missing coordinates must not delay the cards.
    const result = { listings };
    // Retain recent saved-ID lookups for five minutes so revisiting /saved
    // does not repeatedly trigger the same WordPress REST fan-out.
    savedListingsByIdsCache.set(cacheKey, { at: Date.now(), result });
    if (savedListingsByIdsCache.size > 100) {
      const oldestKey = savedListingsByIdsCache.keys().next().value;
      if (oldestKey) savedListingsByIdsCache.delete(oldestKey);
    }
    return result;
    })();

    savedListingsByIdsInflight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (savedListingsByIdsInflight.get(cacheKey) === request) {
        savedListingsByIdsInflight.delete(cacheKey);
      }
    }
  });

export const fetchWpListingsBySlugs = createServerFn({ method: "GET" })
  .validator(
    z.object({
      slugs: z.array(z.string().min(1)).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const slugs = [...new Set(data.slugs.map((slug) => slug.trim()).filter(Boolean))];
    if (!slugs.length) return { listings: [] as Listing[] };

    const rows = await Promise.all(
      slugs.map(async (slug) => {
        const response = await wpGet<WpListing[]>(
          `/wp-json/wp/v2/listing?slug=${encodeURIComponent(slug)}&per_page=1&_fields=${CATALOG_REST_FIELDS}`,
          {},
          15000,
        );
        return response.ok && Array.isArray(response.data) ? response.data[0] : undefined;
      }),
    );
    const validRows = rows.filter((row): row is WpListing => Boolean(row?.slug));
    const mediaMap = await loadMedia(
      validRows.map((row) => Number(row.featured_media ?? 0)),
    ).catch(() => new Map<number, string>());

    return {
      listings: validRows
        .map((row) => mapListing(row, { mediaMap }))
        .filter((row): row is Listing => Boolean(row)),
    };
  });

export const fetchWpCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (catalogCache && catalogCache.v === CATALOG_VERSION && now - catalogCache.at < CATALOG_TTL) return { listings: catalogCache.listings, total: catalogCache.total };
  if (catalogCache && catalogCache.v === CATALOG_VERSION && now - catalogCache.at < CATALOG_STALE) {
    void refreshCatalog();
    return { listings: catalogCache.listings, total: catalogCache.total };
  }
  try {
    const fresh = await loadCatalogFromWp();
    if (fresh.listings.length) catalogCache = { at: now, v: CATALOG_VERSION, ...fresh };
    return fresh;
  } catch {
    return catalogCache && catalogCache.listings.length
      ? { listings: catalogCache.listings, total: catalogCache.total }
      : { listings: localListings, total: localListings.length };
  }
});


export type WpExperienceSlot = {
  time: string;
  remaining: number;
  price: number;
  currency: string;
};
export type WpExperience = {
  id: number;
  slug: string;
  link: string;
  title: string;
  description: string;
  excerpt: string;
  image: string;
  gallery: string[];
  price: number;
  currency: string;
  pricingModel: string;
  duration: string;
  provider: string;
  location: string;
  categories: string[];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  languages: string[];
  meetingPoint: string;
  cancellationHours: number;
  minParticipants: number;
  maxParticipants: number;
  bookingType: string;
  pickupIncluded: boolean;
  privateGroup: boolean;
  reservePayLater: boolean;
  importantInfo: string[];
  faqs: WpExperienceFaq[];
  itinerary: WpExperienceItineraryStop[];
  cancellationPolicy: string;
  refundPolicy: string;
  providerDetails: string;
};
export type WpExperienceFaq = { question: string; answer: string };
export type WpExperienceItineraryStop = {
  title: string;
  listingUrl?: string;
  description: string;
  address: string;
  duration: string;
  lat?: number;
  lng?: number;
};

type WpExperienceRest = {
  id: number;
  xplore_view_count?: number;
  meta?: Record<string, unknown>;
  slug: string;
  link?: string;
  date?: string;
  status?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  featured_media?: number;
  featured_image_url?: string;
  gallery_image_urls?: { id: number; url: string; alt?: string }[];
  _embedded?: { "wp:featuredmedia"?: WpMedia[]; "wp:term"?: WpTerm[][] };
  price?: string | number;
  currency?: string;
  pricing_model?: string;
  duration?: string | number;
  provider_name?: string;
  cancellation_hours?: string | number;
  languages?: unknown;
  highlights?: unknown;
  includes?: unknown;
  excludes?: unknown;
  important_info?: unknown;
  faqs?: unknown;
  meeting_point_name?: string;
  meeting_point_address?: string;
  meeting_point_lat?: string | number;
  meeting_point_lng?: string | number;
  itinerary_json?: unknown;
  cancellation_policy?: string;
  refund_policy?: string;
  provider_details?: string;
  gallery_ids?: unknown;
  meta?: Record<string, unknown>;
  experience_category?: number[];
  experience_location?: number[];
};

function experienceMeta(row: WpExperienceRest, key: string): unknown {
  const direct = (row as Record<string, unknown>)[key];
  if (direct !== undefined && direct !== null && direct !== "") return direct;
  const metaKey = key.replace(/^_xpe_/, "");
  return row.meta?.[key] ?? row.meta?.["_xpe_" + metaKey] ?? row.meta?.[metaKey];
}
function experienceString(value: unknown): string {
  if (Array.isArray(value)) return value.map(experienceString).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return experienceString(record.value ?? record.label ?? record.name ?? "");
  }
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function experienceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => experienceList(v));
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return [];
    try {
      const parsed: unknown = JSON.parse(normalized);
      if (parsed !== value) return experienceList(parsed);
    } catch { /* plain text value */ }
    return normalized.split(/[\n,;|]+/).map((v) => v.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(experienceList);
  if (typeof value === "number") return [String(value)];
  return [];
}
function experienceFaqList(value: unknown): WpExperienceFaq[] {
  let source = value;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try { source = JSON.parse(trimmed); } catch { source = trimmed.split(/\r?\n/); }
    } else {
      source = trimmed.split(/\r?\n/);
    }
  }
  const rows = Array.isArray(source) ? source : source && typeof source === "object" ? Object.values(source as Record<string, unknown>) : [];
  const faqs: WpExperienceFaq[] = [];
  let pendingQuestion = "";
  for (const row of rows) {
    if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      const question = experienceString(record.question ?? record.q ?? record.title ?? record.label);
      const answer = experienceString(record.answer ?? record.a ?? record.response ?? record.description);
      if (question) faqs.push({ question, answer });
      continue;
    }
    const line = experienceString(row);
    if (!line) continue;
    const pipe = line.indexOf("|");
    if (pipe >= 0) {
      if (pendingQuestion) {
        faqs.push({ question: pendingQuestion, answer: "" });
        pendingQuestion = "";
      }
      const question = line.slice(0, pipe).trim();
      const answer = line.slice(pipe + 1).trim();
      if (question) faqs.push({ question, answer });
    } else if (!pendingQuestion) {
      pendingQuestion = line;
    } else {
      faqs.push({ question: pendingQuestion, answer: line });
      pendingQuestion = "";
    }
  }
  if (pendingQuestion) faqs.push({ question: pendingQuestion, answer: "" });
  return faqs.filter((faq) => faq.question || faq.answer);
}

function mapWpExperience(row: WpExperienceRest): WpExperience {
  const get = (key: string) => experienceMeta(row, key);
  const media = row._embedded?.["wp:featuredmedia"]?.[0];
  const image = experienceString(row.featured_image_url) || mediaUrl(media) || row.gallery_image_urls?.find((item) => item.url)?.url || "";
  const terms = row._embedded?.["wp:term"]?.flatMap((group) => group.map((term) => term.name)) ?? [];
  const rawItinerary = get("itinerary_json");
  let itineraryValue: unknown = rawItinerary;
  if (typeof itineraryValue === "string") {
    try { itineraryValue = JSON.parse(itineraryValue); } catch { itineraryValue = []; }
  }
  const itinerary: WpExperienceItineraryStop[] = Array.isArray(itineraryValue)
    ? itineraryValue.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const stop = value as Record<string, unknown>;
        const title = experienceString(stop.title ?? stop.name);
        const description = experienceString(stop.description ?? stop.details);
        const address = experienceString(stop.address ?? stop.location);
        const duration = experienceString(stop.duration ?? stop.time);
        const lat = Number(stop.lat ?? stop.latitude);
        const lng = Number(stop.lng ?? stop.longitude);
        if (!title && !description && !address) return [];
        const rawListingUrl = experienceString(stop.listing_url ?? stop.listingUrl ?? stop.url ?? stop.permalink);
        let listingUrl = "";
        if (rawListingUrl) {
          try {
            const parsedUrl = new URL(rawListingUrl, "https://xplorepondy.com");
            const match = parsedUrl.pathname.match(/\/listing\/([^/]+)\/([^/]+)\/?$/);
            listingUrl = parsedUrl.origin === "https://xplorepondy.com" && match
              ? `https://app.xplorepondy.com/place/${match[2]}`
              : parsedUrl.origin === "https://app.xplorepondy.com" ? parsedUrl.toString() : "";
          } catch { listingUrl = ""; }
        }
        return [{ title, description, address, duration, ...(listingUrl ? { listingUrl } : {}), ...(Number.isFinite(lat) && lat !== 0 ? { lat } : {}), ...(Number.isFinite(lng) && lng !== 0 ? { lng } : {}) }];
      })
    : [];
  return {
    id: Number(row.id),
    slug: String(row.slug ?? ""),
    link: String(row.link ?? (row.slug ? `${WP_ORIGIN}/experiences/${row.slug}/` : WP_ORIGIN + "/experiences/")),
    title: decodeHtml(row.title?.rendered ?? row.slug ?? "Experience"),
    description: String(row.content?.rendered ?? ""),
    excerpt: decodeHtml(row.excerpt?.rendered ?? ""),
    image,
    gallery: Array.from(new Set([image, ...(Array.isArray(row.gallery_image_urls) ? row.gallery_image_urls.map((item) => experienceString(item?.url)).filter(Boolean) : [])].filter(Boolean))),
    price: Number(get("price") ?? 0) || 0,
    currency: experienceString(get("currency")) || "INR",
    pricingModel: experienceString(get("pricing_model")) || "per_person",
    duration: experienceString(get("duration")),
    provider: experienceString(get("provider_name")),
    location: experienceString(get("meeting_point_address") ?? get("meeting_point_name")),
    categories: terms,
    highlights: experienceList(get("highlights")),
    inclusions: experienceList(get("includes")),
    exclusions: experienceList(get("excludes")),
    languages: experienceList(get("languages")),
    meetingPoint: [experienceString(get("meeting_point_name")), experienceString(get("meeting_point_address"))].filter(Boolean).join(" · "),
    cancellationHours: Number(get("cancellation_hours") ?? 0) || 0,
    minParticipants: Number(get("min_participants") ?? 0) || 0,
    maxParticipants: Number(get("max_participants") ?? 0) || 0,
    bookingType: experienceString(get("booking_type")),
    pickupIncluded: ["yes", "true", "1"].includes(experienceString(get("pickup_included")).toLowerCase()),
    privateGroup: ["yes", "true", "1"].includes(experienceString(get("private_group")).toLowerCase()),
    reservePayLater: ["yes", "true", "1"].includes(experienceString(get("reserve_pay_later")).toLowerCase()),
    importantInfo: experienceList(get("important_info")),
    faqs: experienceFaqList(get("faqs")),
    itinerary,
    cancellationPolicy: experienceString(get("cancellation_policy")),
    refundPolicy: experienceString(get("refund_policy")),
    providerDetails: experienceString(get("provider_details")),
  };
}


async function mapWpExperienceWithImage(row: WpExperienceRest): Promise<WpExperience> {
  const experience = mapWpExperience(row);
  if (experience.image) return experience;

  // Some WordPress REST responses include featured_media but omit _embedded media.
  // Resolve the attachment server-side so the PWA doesn't silently show the gradient.
  const ids = [
    Number(row.featured_media ?? 0),
    ...experienceList(row.gallery_ids).map((value) => Number(value)),
  ].filter((id, index, values) => Number.isInteger(id) && id > 0 && values.indexOf(id) === index);

  for (const id of ids.slice(0, 4)) {
    const response = await wpGet<WpMedia>(
      `/wp-json/wp/v2/media/${id}?_fields=id,source_url,media_details,alt_text`,
      {},
      12000,
    ).catch(() => null);
    if (!response?.ok || !response.data) continue;
    const url = mediaUrl(response.data);
    if (url) {
      experience.image = url;
      break;
    }
  }
  return experience;
}

const EXPERIENCE_REST_FIELDS = "id,slug,link,title,content,excerpt,featured_media,featured_image_url,gallery_image_urls,price,currency,pricing_model,duration,provider_name,max_participants,min_participants,languages,booking_type,pickup_included,private_group,cancellation_hours,reserve_pay_later,highlights,includes,excludes,important_info,faqs,meeting_point_name,meeting_point_address,meeting_point_lat,meeting_point_lng,itinerary_json,cancellation_policy,refund_policy,provider_details,gallery_ids,xplore_view_count,meta,_embedded";
export const fetchWpExperiences = createServerFn({ method: "GET" })
  .validator(z.object({ page: z.number().int().min(1).max(100).default(1), perPage: z.number().int().min(1).max(48).default(24), search: z.string().trim().max(120).optional() }))
  .handler(async ({ data }) => {
    const path = `/wp-json/wp/v2/experiences?status=publish&page=${data.page}&per_page=${data.perPage}&_embed=1&_fields=${EXPERIENCE_REST_FIELDS}${data.search ? "&search=" + encodeURIComponent(data.search) : ""}`;
    const result = await wpGet<WpExperienceRest[]>(path, {}, 15000).catch(() => null);
    if (!result?.ok || !Array.isArray(result.data)) {
      return { experiences: [] as WpExperience[], total: 0, pages: 0, available: false };
    }
    return { experiences: (await Promise.all(result.data.map(mapWpExperienceWithImage))).filter((row) => row.id > 0 && row.slug), total: Number(result.headers.get("X-WP-Total") ?? result.data.length), pages: Number(result.headers.get("X-WP-TotalPages") ?? 1), available: true };
  });

export const fetchWpExperience = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().trim().min(1).max(180) }))
  .handler(async ({ data }) => {
    const result = await wpGet<WpExperienceRest[]>(`/wp-json/wp/v2/experiences?slug=${encodeURIComponent(data.slug)}&status=publish&per_page=1&_embed=1&_fields=${EXPERIENCE_REST_FIELDS}`, {}, 15000).catch(() => null);
    if (!result?.ok || !Array.isArray(result.data) || !result.data[0]) return null;
    return mapWpExperienceWithImage(result.data[0]);
  });

export const submitWpExperienceBookingRequest = createServerFn({ method: "POST" })
  .validator(z.object({
    experienceId: z.number().int().positive(),
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(40).optional().default(""),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    participants: z.number().int().min(1).max(20),
    notes: z.string().trim().max(1000).optional().default(""),
    website: z.string().max(200).optional().default(""),
  }))
  .handler(async ({ data }) => {
    const response = await fetch(`${WP_ORIGIN}/wp-json/xpe/v1/booking-requests`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        experience_id: data.experienceId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        date: data.date,
        time: data.time,
        participants: data.participants,
        notes: data.notes,
        website: data.website,
      }),
      signal: AbortSignal.timeout(15000),
    });
    let payload: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
    } catch {
      /* handled below as a generic upstream error */
    }
    if (!response.ok || payload.success !== true) {
      const message = typeof payload.message === "string"
        ? payload.message
        : "We couldn't submit your request right now. Please try again.";
      throw new Error(message);
    }
    return {
      success: true as const,
      requestId: Number(payload.request_id ?? 0),
      status: String(payload.status ?? "pending_review"),
      message: String(payload.message ?? "Your request was sent for review. This is not a confirmed reservation."),
    };
  });

export const fetchWpExperienceAvailability = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
  .handler(async ({ data }) => {
    const path = `/wp-json/xpe/v1/experiences/${data.id}/availability${data.date ? "?date=" + encodeURIComponent(data.date) : ""}`;
    const response = await wpGet<Record<string, unknown>>(path, {}, 15000).catch(() => null);
    if (!response?.ok || !response.data || typeof response.data !== "object") return { dates: [] as string[], slots: [] as WpExperienceSlot[], available: false };
    const raw = response.data;
    const slots = Array.isArray(raw.slots) ? raw.slots.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      return [{ time: String(row.time ?? ""), remaining: Number(row.remaining ?? 0), price: Number(row.price ?? 0), currency: String(row.currency ?? "INR") }].filter((slot) => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time) && slot.remaining > 0);
    }) : [];
    const dates = Array.isArray(raw.dates) ? raw.dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    return { dates, slots, available: true };
  });

export const fetchWpGuides = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (guidesCache && now - guidesCache.at < CATALOG_TTL) return { guides: guidesCache.guides };
  const guides = await loadGuidesFromWp();
  guidesCache = { at: now, guides };  return { guides };
});

/** Fetch a WordPress Guide Category archive directly (e.g. /guide-category/food-dining/). */
export const fetchWpGuidesByCategory = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().trim().min(1).max(100) }))
  .handler(async ({ data }): Promise<{ guides: Guide[] }> => {
    const slug = data.slug.toLocaleLowerCase();
    const now = Date.now();
    const cached = guideCategoryCache.get(slug);
    if (cached && now - cached.at < GUIDE_CATEGORY_CACHE_TTL) return { guides: cached.guides };

    const normalizeSlug = (value: string) =>
      value.toLocaleLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const taxonomyTerms = await loadTerms("guide-category").catch(() => new Map<number, WpTerm>());
    const categoryTerm = [...taxonomyTerms.values()].find(
      (term) => term.slug?.toLocaleLowerCase() === slug,
    );

    let guides: Guide[] = [];
    if (categoryTerm?.id) {
      const first = await wpGet<WpGuide[]>(
        `/wp-json/wp/v2/travel_guide?guide-category=${categoryTerm.id}&per_page=100&page=1&_embed=1`,
        {},
        25000,
      ).catch(() => null);

      if (first?.ok && Array.isArray(first.data)) {
        const rows = [...first.data];
        const pages = Math.max(1, Number(first.headers.get("X-WP-TotalPages") ?? "1") || 1);
        if (pages > 1) {
          const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, index) =>
              wpGet<WpGuide[]>(
                `/wp-json/wp/v2/travel_guide?guide-category=${categoryTerm.id}&per_page=100&page=${index + 2}&_embed=1`,
                {},
                25000,
              ).catch(() => null),
            ),
          );
          for (const response of rest) {
            if (response?.ok && Array.isArray(response.data)) rows.push(...response.data);
          }
        }

        const termName = decodeHtml(categoryTerm.name ?? "Food & Dining");
        const matchingRows = rows.filter((row) => {
          const embedded = (row._embedded?.["wp:term"] ?? []).flat();
          const rowCategories = embedded.filter(
            (term) => term.taxonomy?.replace(/_/g, "-") === "guide-category",
          );
          // The REST query above is already scoped by the selected term. If
          // terms are embedded, also guard against caches that return other
          // archive rows; if they are not embedded, trust the server-side query.
          return rowCategories.length === 0 || rowCategories.some(
            (term) => term.slug?.toLocaleLowerCase() === slug
              || normalizeSlug(term.name ?? "") === slug
              || normalizeSlug(term.name ?? "") === normalizeSlug(termName),
          );
        });
        guides = matchingRows.map((row) => {
          const mapped = mapGuide(row);
          return {
            ...mapped,
            topic: mapped.topic || termName,
            categories: [...new Set([...(mapped.categories ?? []), termName])],
          };
        });
      }
    }

    // Fallback to the complete guide catalogue for REST installations that
    // don't expose the category filter directly.
    if (!guides.length) {
      const allGuides = await loadGuidesFromWp().catch(() => [] as Guide[]);
      guides = allGuides.filter((guide) =>
        [...(guide.categories ?? []), guide.topic ?? ""].some(
          (value) => normalizeSlug(value) === slug,
        ),
      );
    }

    const unique = [...new Map(guides.filter((guide) => guide.slug).map((guide) => [guide.slug, guide])).values()];
    guideCategoryCache.set(slug, { at: Date.now(), guides: unique });
    return { guides: unique };
  });

async function loadGuidePageHtml(urls: string[], timeout = 10000) {
  const unique = [...new Set(urls.filter(Boolean))];
  let fallback: { url: string; html: string; score: number } | null = null;
  for (const url of unique) {
    try {
      const page = await cachedOriginText(url, HTML_TTL, timeout, WP_HTML_HEADERS);
      if (!page.ok) continue;
      const html = page.body;
      if (/<title>[^<]*Page not found/i.test(html)) continue;
      const score =
        (html.match(/field-values/gi)?.length ?? 0) * 8 +
        (html.match(/listing-field-heading/gi)?.length ?? 0) * 10 +
        (html.match(/jet-check-list__item-content/gi)?.length ?? 0) +
        (html.match(/heading-(?:break|sameline)/gi)?.length ?? 0) * 4;
      const hit = { url, html, score };
      if (score > 0) return hit;
      fallback ??= hit;
    } catch {
      /* try the next url */
    }
  }
  return fallback;
}

function extractWordPressPostId(html: string) {
  const patterns = [
    /<body\b[^>]*\bclass=["'][^"']*\bpostid-(\d+)\b/i,
    /\bdata-post-id=["'](\d+)["']/i,
    /\bdata-listing-id=["'](\d+)["']/i,
    /\bname=["']post_id["']\s+value=["'](\d+)["']/i,
    /\bname=["']listing_id["']\s+value=["'](\d+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const id = Number(match?.[1] ?? 0);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return undefined;
}

function listingAliases(slug: string, url?: string) {
  const tail = url ? url.split("/").filter(Boolean).pop() ?? "" : "";
  return [...new Set([slug, tail].filter((s) => s.length > 2))];
}

const LISTING_SEO_REST_FIELDS = "id,slug,link,yoast_head_json";

const GUIDE_SEO_REST_FIELDS = "id,slug,link,yoast_head_json";
const CATEGORY_SEO_REST_FIELDS = "id,name,slug,description,yoast_head_json";

export const fetchWpGuideSeo = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const path =
      `/wp-json/wp/v2/travel_guide?slug=${encodeURIComponent(data.slug)}&per_page=1&_fields=${GUIDE_SEO_REST_FIELDS}`;
    const response = await wpGet<WpGuide[]>(path, {}, 10000);
    const row = response.ok && Array.isArray(response.data) ? response.data[0] : undefined;
    return row ? mapYoastSeo(row) ?? null : null;
  });

export const fetchWpListingCategorySeo = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const path =
      `/wp-json/wp/v2/listing_category?slug=${encodeURIComponent(data.slug)}&per_page=1&_fields=${CATEGORY_SEO_REST_FIELDS}`;
    const response = await wpGet<WpTerm[]>(path, {}, 10000);
    const row = response.ok && Array.isArray(response.data) ? response.data[0] : undefined;
    return row ? mapYoastSeo(row) ?? null : null;
  });



export const fetchWpListingSeo = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const path =
      `/wp-json/wp/v2/listing?slug=${encodeURIComponent(data.slug)}&per_page=1&_fields=${LISTING_SEO_REST_FIELDS}`;
    const response = await wpGet<WpListing[]>(path, {}, 10000);
    const row = response.ok && Array.isArray(response.data) ? response.data[0] : undefined;
    return row ? mapYoastSeo(row) ?? null : null;
  });

export const fetchWpListingById = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.coerce.number().int().positive() }))
  .handler(async ({ data }) => {
    const rest = await wpGet<WpListing[]>(
      `/wp-json/wp/v2/listing?include=${data.id}&_embed=wp:term,wp:featuredmedia&_fields=id,slug,title,link,content,excerpt,featured_media,listing_category,region,listing_feature,class_list,meta,xplore_meta,_embedded`,
      {},
      15000,
    ).catch(() => null);

    if (!rest?.ok || !Array.isArray(rest.data) || !rest.data[0]) return null;

    const row = rest.data[0];
    const mediaMap = await loadMedia(
      row.featured_media ? [Number(row.featured_media)] : [],
    ).catch(() => new Map<number, string>());

    return mapListing(row, { mediaMap });
  });

export const fetchWpListing = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1), url: z.string().optional() }))
  .handler(async ({ data }) => {
    const cached = listingPageCache.get(data.slug);
    if (cached && Date.now() - cached.at < LISTING_PAGE_TTL) return cached.listing;

    const inflight = listingPageInflight.get(data.slug);
    if (inflight) return inflight;

    const request = (async (): Promise<Listing | null> => {
    const aliases = listingAliases(data.slug, data.url);
    const restHits = await Promise.all(
      aliases.map((s) =>
        wpGet<WpListing[]>(
          `/wp-json/wp/v2/listing?slug=${encodeURIComponent(s)}&_embed=wp:term,wp:featuredmedia&_fields=id,slug,title,link,content,excerpt,featured_media,listing_category,region,listing_feature,class_list,meta,xplore_meta,_embedded`,
          {},
          15000,
        ).catch(() => null),
      ),
    );

    const rest =
      restHits.find(
        (res) => res?.ok && Array.isArray(res.data) && res.data[0],
      ) ?? null;

    if (rest?.ok && Array.isArray(rest.data) && rest.data[0]) {
      const row = rest.data[0];
      const mediaMap = await loadMedia(
        row.featured_media ? [Number(row.featured_media)] : [],
      ).catch(() => new Map<number, string>());
      const result = mapListing(row, { mediaMap });

      // Read the admin-configured order from the allowlisted Xplore Listing API.
      // The endpoint emits enabled fields in the saved drag-and-drop order.
      try {
        const configured = await wpGet<{
          listing?: { fields?: Record<string, { label?: string; value?: unknown }> };
        }>(`/wp-json/xplore/v1/listings/${row.id}`, {}, 10000);
        const fields = configured.ok ? configured.data?.listing?.fields : undefined;
        if (fields && typeof fields === "object") {
          result.savedMetaOrder = Object.values(fields)
            .map((field) => typeof field?.label === "string" ? field.label.trim() : "")
            .filter(Boolean);
        }
      } catch {
        // Preserve category-specific fallback ordering if the plugin API is unavailable.
      }

      listingPageCache.set(data.slug, { at: Date.now(), listing: result });
      return result;
    }

    // Listing detail is REST/meta driven. JetEngine meta is the source of truth
    // for listing fields; do not render the WordPress listing HTML page here.
    // Guides intentionally use a separate HTML-enrichment path below because
    // travel_guide posts do not store their article body in JetEngine meta.
    const local = findLocal(data.slug, data.url);
    if (local) {
      listingPageCache.set(data.slug, { at: Date.now(), listing: local });
    }
    return local ?? null;
    })();

    listingPageInflight.set(data.slug, request);
    try {
      return await request;
    } finally {
      if (listingPageInflight.get(data.slug) === request) {
        listingPageInflight.delete(data.slug);
      }
    }
  });

function decodeWpTripPayload(content?: { rendered?: string }): Omit<WpTripSaveInput, "email"> | undefined {
  const encoded = content?.rendered?.match(/<!-- xplore-pwa-trip-data:([A-Za-z0-9+/=]+) -->/)?.[1];
  if (!encoded) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Omit<WpTripSaveInput, "email"> & { email?: unknown };
    const { email: _email, ...data } = parsed;
    return data;
  } catch {
    return undefined;
  }
}

export type WpTripSaveInput = {
  email: string;
  wpId?: number;
  title: string;
  code: string;
  fromPlace: string;
  fromLat?: number;
  fromLng?: number;
  locations: string[];
  budget: string;
  tripType: string;
  datesKnown: boolean;
  start: string;
  end: string;
  months: string[];
  days: number;
  interests: string[];
  notes: string;
  items: { slug: string; day: number; listingId?: number }[];
  itinerary?: Array<{
    day: number;
    title: string;
    intro: string;
    stops: Array<{ slug: string; time: string; durationMin: number; blurb: string }>;
  }>;
};

async function wpTripSyncCredentials() {
  const username = process.env.WP_TRIP_SYNC_USERNAME?.trim() ?? "";
  const appPassword = process.env.WP_TRIP_SYNC_APP_PASSWORD?.trim() ?? "";
  if (!username || !appPassword) return null;
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${appPassword.replace(/\s+/g, " ")}`, "utf8").toString("base64")}`,
  };
}


async function wpPwaSyncSecret() {
  const secret =
    process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim() ||
    process.env.WP_PWA_SYNC_SECRET?.trim() ||
    "";
  return secret || null;
}
export type WpTripStoreResult = {
  ok: boolean;
  configured: boolean;
  userId?: number;
  listingIds?: number[];
  error?: string;
};

async function wpTripStoreRequest(
  email: string,
  payload?: { operation: "add" | "remove" | "replace" | "state"; listingId?: number; listingIds?: number[] },
) {
  const secret = await wpPwaSyncSecret();
  const legacyHeaders = secret ? null : await wpTripSyncCredentials();
  if (!secret && !legacyHeaders) {
    return {
      ok: false as const,
      configured: false as const,
      error: "WordPress trip sync is not configured on the PWA server.",
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false as const, configured: true as const, error: "A signed-in email is required." };
  }

  const tripStoreUrl = secret
    ? `${WP_ORIGIN}/wp-json/xplore/v1/pwa/sync/trip-store`
    : `${WP_ORIGIN}/wp-json/xplore/v1/pwa/trip-store`;
  // GET must pass email as a query param — WordPress REST ignores GET bodies,
  // and without email the app cannot read listings saved on xplorepondy.com.
  const url = payload
    ? tripStoreUrl
    : `${tripStoreUrl}?email=${encodeURIComponent(normalizedEmail)}&_=${Date.now()}`;

  const res = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
      ...(secret ? { "X-Xplore-PWA-Secret": secret } : legacyHeaders!),
    },
    cache: "no-store",
    ...(payload
      ? {
          body: JSON.stringify({
            email: normalizedEmail,
            ...payload,
          }),
        }
      : undefined),
    signal: AbortSignal.timeout(15000),
  });

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; user_id?: number; listing_ids?: unknown; message?: string; code?: string }
    | null;

  const listingIds = Array.isArray(body?.listing_ids)
    ? body!.listing_ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)
    : [];

  if (!res.ok || body?.ok === false) {
    return {
      ok: false as const,
      configured: true as const,
      error: body?.message || body?.code || `WordPress returned HTTP ${res.status}.`,
    };
  }

  return {
    ok: true as const,
    configured: true as const,
    userId: typeof body?.user_id === "number" ? body.user_id : undefined,
    listingIds,
  };
}

export const ensureWpBookingSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) return { ok: false as const, configured: false as const };

    const sql = await getSql();
    const users = await sql.query<{ email?: string }>(
      'select "email" from "user" where "id" = $1 limit 1',
      [context.userId],
    );
    const email = String(users[0]?.email ?? "").trim().toLowerCase();
    if (!email) return { ok: false as const, configured: true as const };

    const response = await fetch(`${WP_ORIGIN}/wp-json/xplore/v1/pwa/session`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(12000),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; logged_in_cookie?: string }
      | null;
    if (!response.ok || !body?.logged_in_cookie) {
      return { ok: false as const, configured: true as const };
    }

    setResponseHeader(
      "Set-Cookie",
      `${body.logged_in_cookie}; Domain=.xplorepondy.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600`,
    );
    return { ok: true as const, configured: true as const };
  });

export type WpBookingProfile = {
  id?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

function splitWpDisplayName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

export const fetchWpBookingProfile = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const headers = await wpTripSyncCredentials();
    if (!headers) return null;

    const normalized = data.email.trim().toLowerCase();
    const res = await wpGet<
      Array<{
        id?: number;
        email?: string;
        name?: string;
        slug?: string;
        meta?: Record<string, unknown>;
      }>
    >(
      `/wp-json/wp/v2/users?search=${encodeURIComponent(normalized)}&per_page=100&_fields=id,email,name,slug,meta&context=edit`,
      headers,
      12000,
    );
    if (!res.ok || !Array.isArray(res.data)) return null;

    const user = res.data.find(
      (row) => String(row.email ?? "").trim().toLowerCase() === normalized,
    );
    if (!user) return null;

    const names = splitWpDisplayName(String(user.name ?? ""));
    const meta = user.meta ?? {};
    const phoneKeys = ["phone", "_phone", "phone_number", "_phone_number", "billing_phone"];
    const phone = phoneKeys
      .map((key) => meta[key])
      .find((value) => typeof value === "string" && value.trim()) as string | undefined;

    return {
      id: typeof user.id === "number" ? user.id : undefined,
      username: user.slug || undefined,
      firstName: names.firstName || undefined,
      lastName: names.lastName || undefined,
      email: user.email || normalized,
      phone: phone?.trim() || undefined,
    } satisfies WpBookingProfile;
  });

async function authenticatedWpTripStoreEmail(userId: number) {
  const sql = await getSql();
  const users = await sql.query<{ email?: string }>(
    'select "email" from "user" where "id" = $1 limit 1',
    [userId],
  );
  const email = String(users[0]?.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Your signed-in account does not have an email address.");
  return email;
}

export const fetchWpTripStore = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.string().email().optional() }))
  .handler(async ({ context, data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    setResponseHeader("Pragma", "no-cache");
    const sessionEmail = await authenticatedWpTripStoreEmail(context.userId);
    if (data.email && data.email.trim().toLowerCase() !== sessionEmail) {
      throw new Error("The requested trip store does not belong to the signed-in account.");
    }
    return wpTripStoreRequest(sessionEmail, { operation: "state" });
  });

export const updateWpTripStore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      email: z.string().email().optional(),
      operation: z.enum(["add", "remove", "replace"]),
      listingId: z.number().int().positive().optional(),
      listingIds: z.array(z.number().int().positive()).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const sessionEmail = await authenticatedWpTripStoreEmail(context.userId);
    if (data.email && data.email.trim().toLowerCase() !== sessionEmail) {
      throw new Error("The requested trip store does not belong to the signed-in account.");
    }
    return wpTripStoreRequest(sessionEmail, data);
  });

async function resolveWpUserByEmail(email: string, headers: HeadersInit) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const res = await wpGet<Array<{ id?: number; email?: string; name?: string }>>(
    `/wp-json/wp/v2/users?search=${encodeURIComponent(normalized)}&per_page=100&_fields=id,email,name&context=edit`,
    headers,
    12000,
  );
  if (!res.ok || !Array.isArray(res.data)) return null;
  return res.data.find((u) => String(u.email ?? "").trim().toLowerCase() === normalized) ?? null;
}

function tripMeta(data: WpTripSaveInput) {
  const selected = data.items.map((item) => ({ slug: item.slug, day: item.day }));
  return {
    trip_location: data.locations,
    trips_dates: data.datesKnown ? "dates_known" : "dates_unknown",
    trip_start: data.start,
    trip_end: data.end,
    when_are_you_going: data.months,
    trip_days: String(data.days),
    trip_type: data.tripType,
    trip_budget: data.budget,
    trip_interest: data.interests,
    trip_from_place: data.fromPlace,
    trip_from_lat: data.fromLat ?? "",
    trip_from_lng: data.fromLng ?? "",
    trip_notes: data.notes,
    _trip_code: data.code,
    _trip_duration: String(data.days),
    _trip_dates: data.datesKnown ? `${data.start} to ${data.end}` : data.months.join(", "),
    _trip_itinerary: JSON.stringify(data.itinerary ?? []),
    _xplore_pwa_selected_listings: JSON.stringify(selected),
    _xplore_pwa_trip_data: JSON.stringify(data),
  };
}

export const saveWpUserTrip = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      email: z.string().email().optional(),
      wpId: z.number().int().positive().optional(),
      title: z.string().min(1).max(200),
      code: z.string().min(1).max(100),
      fromPlace: z.string().max(300),
      fromLat: z.number().finite().optional(),
      fromLng: z.number().finite().optional(),
      locations: z.array(z.string()),
      budget: z.string(),
      tripType: z.string(),
      datesKnown: z.boolean(),
      start: z.string(),
      end: z.string(),
      months: z.array(z.string()),
      days: z.number().int().min(1).max(7),
      interests: z.array(z.string()),
      notes: z.string().max(5000),
      items: z.array(z.object({ slug: z.string(), day: z.number().int().min(1).max(7), listingId: z.number().int().positive().optional() })),
      itinerary: z
        .array(
          z.object({
            day: z.number(),
            title: z.string(),
            intro: z.string(),
            stops: z.array(
              z.object({
                slug: z.string(),
                time: z.string(),
                durationMin: z.number(),
                blurb: z.string(),
              }),
            ),
          }),
        )
        .optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const email = await authenticatedWpTripStoreEmail(context.userId);
    const headers = await wpTripSyncCredentials();
    if (!headers) {
      return {
        ok: false as const,
        error: "WordPress trip sync is not configured on the PWA server.",
      };
    }

    // The trusted trip-store bridge resolves the exact WordPress account by
    // email even when REST user search is restricted by WordPress permissions.
    // Prefer its no-side-effect GET endpoint, then fall back to the REST lookup.
    const tripStore = await wpTripStoreRequest(email);
    let wpUserId = tripStore.ok ? tripStore.userId : undefined;
    if (!wpUserId) {
      const wpUser = await resolveWpUserByEmail(email, headers);
      wpUserId = wpUser?.id;
    }
    if (!wpUserId) {
      return {
        ok: false as const,
        error: "Could not resolve the WordPress account for this signed-in user. Check WordPress REST user lookup and trip-store bridge configuration.",
      };
    }

    const meta = tripMeta(data);
    const content = [
      "<!-- xplore-pwa-trip -->",
      `<p><strong>Trip code:</strong> ${data.code}</p>`,
      `<p><strong>From:</strong> ${data.fromPlace || "Not specified"}</p>`,
      `<p><strong>Dates:</strong> ${data.datesKnown ? `${data.start} to ${data.end}` : data.months.join(", ") || "Flexible"}</p>`,
      `<p><strong>Days:</strong> ${data.days}</p>`,
      `<p><strong>Budget:</strong> ${data.budget || "Any"}</p>`,
      `<p><strong>Trip type:</strong> ${data.tripType || "Any"}</p>`,
      `<p><strong>Interests:</strong> ${data.interests.join(", ") || "Any"}</p>`,
      `<p><strong>Locations:</strong> ${data.locations.join(", ") || "Pondicherry"}</p>`,
      data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : "",
      `<!-- xplore-pwa-trip-data:${Buffer.from(JSON.stringify({ ...data, wpUserId: wpUserId }), "utf8").toString("base64")} -->`,    ].filter(Boolean).join("\n");

    const endpoint = data.wpId
      ? `${WP_ORIGIN}/wp-json/wp/v2/user_trip/${data.wpId}`
      : `${WP_ORIGIN}/wp-json/wp/v2/user_trip`;
    const res = await fetch(endpoint, {
      method: data.wpId ? "PUT" : "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        title: data.title,
        content,
        status: "publish",
        author: wpUserId,
        meta,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const body = (await res.json().catch(() => null)) as
      | { id?: number; slug?: string; link?: string; title?: { rendered?: string }; message?: string; code?: string }
      | null;

    if (!res.ok || !body?.id) {
      return {
        ok: false as const,
        error: body?.message || body?.code || `WordPress returned HTTP ${res.status}.`,
      };
    }

    // The WP REST controller may accept the post while silently ignoring
    // custom meta keys that are not registered with show_in_rest. Immediately
    // hydrate the canonical user_trip metadata through our authenticated
    // PWA sync endpoint so newly-created trips have the same state as older
    // trips when the planner is reopened.
    try {
      const syncSecret = await wpPwaSyncSecret();
      const syncHeaders = syncSecret
        ? {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Xplore-PWA-Secret": syncSecret,
          }
        : headers;

      const syncRes = await fetch(
        `${WP_ORIGIN}/wp-json/xplore/v1/pwa/trip/${body.id}/sync`,
        {
          method: "POST",
          headers: syncHeaders,
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: data.code,
            locations: data.locations,
            fromPlace: data.fromPlace,
            fromLat: data.fromLat,
            fromLng: data.fromLng,
            budget: data.budget,
            tripType: data.tripType,
            datesKnown: data.datesKnown,
            start: data.start,
            end: data.end,
            months: data.months,
            days: data.days,
            interests: data.interests,
            savedListingIds: [],
            // The WordPress trip bridge stores selected listings by numeric listing ID.
            // AI/manual save inputs are slug-based, so carry the resolved WP ID through
            // and omit unresolved rows rather than sending invalid records to the bridge.
            items: data.items
              .filter((item) => typeof item.listingId === "number" && item.listingId > 0)
              .map((item) => ({ listingId: item.listingId!, day: item.day })),
            itinerary: data.itinerary ?? [],
          }),
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!syncRes.ok) {
        console.warn("PWA trip canonical metadata sync returned HTTP", syncRes.status);
      }
    } catch (error) {
      console.warn("PWA trip canonical metadata sync failed", error);
    }

    return {
      ok: true as const,
      trip: {
        id: body.id,
        slug: body.slug ?? "",
        title: decodeHtml(body.title?.rendered ?? data.title),
        date: "",
        url: body.link ?? `${WP_ORIGIN}/user_trip/${body.slug ?? ""}/`,
      } satisfies WpTrip,
    };
  });

export type WpTripSyncInput = {
  email: string;
  wpId: number;
  code: string;
  locations: string[];
  fromPlace: string;
  fromLat?: number;
  fromLng?: number;
  budget: string;
  tripType: string;
  datesKnown: boolean;
  start: string;
  end: string;
  months: string[];
  days: number;
  interests: string[];
  savedListingIds: number[];
  items: { listingId: number; day: number }[];
  itinerary: unknown[];
};

export type WpTripRemoteState = {
  ok: boolean;
  tripId: number;
  code: string;
  interests: string[];
  savedListingIds: number[];
  items: { listingId: number; day: number; slug?: string }[];
  itinerary: unknown[];
  error?: string;
};

export const syncWpUserTrip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email(),
      wpId: z.number().int().positive(),
      code: z.string().min(1).max(100),
      locations: z.array(z.string()),
      fromPlace: z.string().max(300),
      fromLat: z.number().finite().optional(),
      fromLng: z.number().finite().optional(),
      budget: z.string(),
      tripType: z.string(),
      datesKnown: z.boolean(),
      start: z.string(),
      end: z.string(),
      months: z.array(z.string()),
      days: z.number().int().min(1).max(7),
      interests: z.array(z.string()),
      savedListingIds: z.array(z.number().int().positive()),
      items: z.array(
        z.object({
          listingId: z.number().int().positive(),
          day: z.number().int().min(1).max(7),
        }),
      ),
      itinerary: z.array(z.unknown()),
    }),
  )
  .handler(async ({ data }) => {
    const secret = await wpPwaSyncSecret();
    const legacyHeaders = secret ? null : await wpTripSyncCredentials();
    if (!secret && !legacyHeaders) {
      return {
        ok: false as const,
        configured: false as const,
        error: "WordPress trip sync is not configured on the PWA server.",
      };
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const res = await fetch(
      `${WP_ORIGIN}/wp-json/xplore/v1/pwa/trip/${data.wpId}/sync`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(secret ? { "X-Xplore-PWA-Secret": secret } : legacyHeaders!),
        },
        body: JSON.stringify({
          email: normalizedEmail,
          code: data.code,
          locations: data.locations,
          fromPlace: data.fromPlace,
          fromLat: data.fromLat,
          fromLng: data.fromLng,
          budget: data.budget,
          tripType: data.tripType,
          datesKnown: data.datesKnown,
          start: data.start,
          end: data.end,
          months: data.months,
          days: data.days,
          interests: data.interests,
          savedListingIds: data.savedListingIds,
          items: data.items,
          itinerary: data.itinerary,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; message?: string; code?: string }
      | null;

    if (!res.ok || body?.ok === false) {
      return {
        ok: false as const,
        configured: true as const,
        error: body?.message || body?.code || `WordPress returned HTTP ${res.status}.`,
      };
    }

    return {
      ok: true as const,
      configured: true as const,
    };
  });

export const fetchWpUserTripState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      email: z.string().email(),
      wpId: z.number().int().positive(),
    }),
  )
  .handler(async ({ context, data }) => {
    const sessionEmail = await authenticatedWpTripStoreEmail(context.userId);
    if (data.email.trim().toLowerCase() !== sessionEmail) {
      return {
        ok: false as const,
        error: "The requested trip does not belong to the signed-in account.",
      };
    }
    const secret = await wpPwaSyncSecret();
    const legacyHeaders = secret ? null : await wpTripSyncCredentials();
    if (!secret && !legacyHeaders) {
      return {
        ok: false as const,
        error: "WordPress trip sync is not configured on the PWA server.",
      };
    }

    const normalizedEmail = sessionEmail;

    const mapBridgeItems = (raw: unknown): Array<{ listingId: number; day: number; slug?: string }> => {
      if (!Array.isArray(raw)) return [];
      return raw.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const item = row as Record<string, unknown>;
        const listingId = Number(item.listingId ?? item.listing_id ?? 0);
        const day = Math.max(1, Math.min(7, Number(item.day ?? 1) || 1));
        const slug = typeof item.slug === "string" ? item.slug : undefined;
        if (!Number.isInteger(listingId) || listingId <= 0) return [];
        return [{ listingId, day, slug }];
      });
    };

    if (secret) {
      const bridgeRes = await fetch(
        `${WP_ORIGIN}/wp-json/xplore/v1/pwa/trip/${data.wpId}/sync?email=${encodeURIComponent(normalizedEmail)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Xplore-PWA-Secret": secret,
          },
          signal: AbortSignal.timeout(15000),
        },
      );
      const bridgeBody = (await bridgeRes.json().catch(() => null)) as
        | {
            ok?: boolean;
            trip_id?: number;
            title?: string;
            slug?: string;
            url?: string;
            code?: string;
            days?: number;
            datesKnown?: boolean;
            months?: string[];
            interests?: string[];
            items?: unknown;
            itinerary?: unknown;
            fromPlace?: string;
            fromLat?: number | null;
            fromLng?: number | null;
            locations?: string[];
            budget?: string;
            tripType?: string;
            start?: string;
            end?: string;
            notes?: string;
            message?: string;
          }
        | null;

      if (bridgeRes.ok && bridgeBody?.ok !== false && (bridgeBody?.trip_id || bridgeBody?.ok)) {
        const items = mapBridgeItems(bridgeBody.items);
        const itinerary = Array.isArray(bridgeBody.itinerary) ? bridgeBody.itinerary : [];

        // Newly-created PWA trips can reach this bridge before all custom
        // WordPress meta has been persisted. The post content, however, always
        // contains the xplore-pwa-trip-data payload written at creation time.
        // If the bridge reports the default 1 day with no dates, recover the
        // canonical form values from that payload instead of collapsing a
        // newly-created 2+ day trip to Day 1.
        let payloadData: Omit<WpTripSaveInput, "email"> | undefined;
        if (Number(bridgeBody.days ?? 1) <= 1 && !bridgeBody.start && !bridgeBody.end) {
          try {
            const restHeaders = await wpTripSyncCredentials();
            if (restHeaders) {
              const postRes = await wpGet<{ content?: { rendered?: string } }>(
                `/wp-json/wp/v2/user_trip/${data.wpId}?_fields=content`,
                restHeaders,
                10000,
              );
              if (postRes.ok) payloadData = decodeWpTripPayload(postRes.data?.content);
            }
          } catch {
            // Keep the bridge response if the recovery request is unavailable.
          }
        }

        const canonicalDays = payloadData?.days
          ? Math.max(1, Math.min(7, Number(payloadData.days) || 2))
          : Math.max(1, Math.min(7, Number(bridgeBody.days ?? 2) || 2));
        const canonicalDatesKnown = payloadData?.datesKnown ?? bridgeBody.datesKnown ?? true;
        const canonicalStart = payloadData?.start ?? String(bridgeBody.start ?? "");
        const canonicalEnd = payloadData?.end ?? String(bridgeBody.end ?? "");
        const canonicalMonths = payloadData?.months ?? (
          Array.isArray(bridgeBody.months) ? bridgeBody.months.map(String).filter(Boolean) : []
        );
        const canonicalLocations = payloadData?.locations ?? (
          Array.isArray(bridgeBody.locations) ? bridgeBody.locations.map(String) : []
        );
        const canonicalBudget = payloadData?.budget ?? String(bridgeBody.budget ?? "");
        const canonicalTripType = payloadData?.tripType ?? String(bridgeBody.tripType ?? "");
        const canonicalFromPlace = payloadData?.fromPlace ?? String(bridgeBody.fromPlace ?? "");
        const canonicalInterests = payloadData?.interests?.length
          ? payloadData.interests
          : (Array.isArray(bridgeBody.interests) ? bridgeBody.interests.map(String).filter(Boolean) : []);
        const canonicalNotes = payloadData?.notes ?? String(bridgeBody.notes ?? "");

        return {
          ok: true as const,
          tripId: Number(bridgeBody.trip_id ?? data.wpId),
          code: String(bridgeBody.code || data.wpId),
          interests: canonicalInterests,
          savedListingIds: items.map((item) => item.listingId),
          items,
          itinerary,
          title: String(bridgeBody.title ?? ""),
          slug: String(bridgeBody.slug ?? ""),
          url: String(bridgeBody.url ?? `${WP_ORIGIN}/user_trip/${bridgeBody.slug ?? ""}/`),
          data: {
            wpId: Number(bridgeBody.trip_id ?? data.wpId),
            title: String(bridgeBody.title ?? ""),
            code: String(bridgeBody.code || data.wpId),
            fromPlace: canonicalFromPlace,
            fromLat: payloadData?.fromLat ?? (typeof bridgeBody.fromLat === "number" && bridgeBody.fromLat ? bridgeBody.fromLat : undefined),
            fromLng: payloadData?.fromLng ?? (typeof bridgeBody.fromLng === "number" && bridgeBody.fromLng ? bridgeBody.fromLng : undefined),
            locations: canonicalLocations,
            budget: canonicalBudget,
            tripType: canonicalTripType,
            datesKnown: canonicalDatesKnown,
            start: canonicalStart,
            end: canonicalEnd,
            months: canonicalMonths,
            days: canonicalDays,
            interests: canonicalInterests,
            notes: canonicalNotes,
            items: items.map((item) => ({ slug: item.slug ?? "", day: item.day })),
            itinerary: itinerary as NonNullable<WpTripSaveInput["itinerary"]>,
          },
        };
      }
    }

    const restHeaders = await wpTripSyncCredentials();
    if (!restHeaders) {
      return {
        ok: false as const,
        error: "WordPress could not load this trip's selected listings.",
      };
    }

    // The trip-detail bridge may be unavailable while the account bridge
    // still resolves this same email successfully. Reuse that trusted user ID
    // before falling back to REST user search, which may be permission-limited.
    const tripStoreIdentity = await wpTripStoreRequest(normalizedEmail);
    let wpUserId = tripStoreIdentity.ok ? tripStoreIdentity.userId : undefined;
    if (!wpUserId) {
      const wpUser = await resolveWpUserByEmail(normalizedEmail, restHeaders);
      wpUserId = wpUser?.id;
    }
    if (!wpUserId) {
      return {
        ok: false as const,
        error: tripStoreIdentity.ok
          ? "The WordPress account bridge returned no user ID."
          : tripStoreIdentity.error || "No matching xplorepondy.com WordPress user was found for this signed-in email.",
      };
    }

    // The WordPress user_trip post is the canonical trip record. Read it
    // directly instead of depending on a second state endpoint/WPCode snippet.
    const res = await wpGet<{
      id?: number;
      author?: number;
      slug?: string;
      link?: string;
      title?: { rendered?: string };
      content?: { rendered?: string };
      meta?: Record<string, unknown>;
    }>(
      `/wp-json/wp/v2/user_trip/${data.wpId}?_fields=id,author,slug,link,title,content,meta&context=edit`,
      restHeaders,
      15000,
    );

    if (!res.ok || !res.data?.id) {
      return {
        ok: false as const,
        error: `WordPress could not load trip ${data.wpId} (HTTP ${res.status}).`,
      };
    }

    if (Number(res.data.author ?? 0) !== Number(wpUserId)) {
      return {
        ok: false as const,
        error: "This trip does not belong to the signed-in user.",
      };
    }

    const savedData = decodeWpTripPayload(res.data.content);
    const meta = res.data.meta ?? {};

    const asStrings = (value: unknown) =>
      Array.isArray(value)
        ? value.map(String).map((item) => item.trim()).filter(Boolean)
        : typeof value === "string"
          ? [value.trim()].filter(Boolean)
          : [];

    const asIds = (value: unknown): number[] => {
      if (Array.isArray(value)) {
        return value.flatMap((entry) => asIds(entry));
      }
      if (typeof value === "string") {
        try {
          return asIds(JSON.parse(value));
        } catch {
          return value.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
        }
      }
      const id = Number(value);
      return Number.isInteger(id) && id > 0 ? [id] : [];
    };

    const metaSelectedByDay =
      meta.trip_selected_by_day && typeof meta.trip_selected_by_day === "object"
        ? (meta.trip_selected_by_day as Record<string, unknown>)
        : {};

    const metaItems = Object.entries(metaSelectedByDay).flatMap(([dayKey, value]) => {
      const day = Math.max(1, Math.min(7, Number(dayKey) || 1));
      return asIds(value).map((listingId) => ({ listingId, day }));
    });

    const htmlItems: Array<{ listingId: number; day: number }> = [];
    const rendered = res.data.content?.rendered ?? "";
    const sectionPattern = /<section\b[^>]*data-day=["'](\d+)["'][^>]*>([\s\S]*?)<\/section>/gi;
    for (const section of rendered.matchAll(sectionPattern)) {
      const day = Math.max(1, Math.min(7, Number(section[1]) || 1));
      for (const match of section[2].matchAll(/data-listing-id=["'](\d+)["']/gi)) {
        htmlItems.push({ listingId: Number(match[1]), day });
      }
    }

    const selectedIds = asIds(meta.trip_selected_listings ?? meta._itinerary_listings);
    const legacyItems = selectedIds.map((listingId) => ({ listingId, day: 1 }));
    // Canonical source is trip_selected_by_day / trip_selected_listings on
    // the user_trip. The HTML comment payload is often empty or stale.
    const rawItems = metaItems.length
      ? metaItems
      : htmlItems.length
        ? htmlItems
        : legacyItems.length
          ? legacyItems
          : savedData?.items?.length
            ? savedData.items
                .map((item) => ({
                  slug: String(item.slug ?? ""),
                  day: Math.max(1, Math.min(7, Number(item.day ?? 1))),
                }))
                .filter((item) => item.slug)
            : [];

    // The post content payload can be older than the canonical trip metadata.
    // In particular, a trip may have been saved with itinerary: [] and then
    // generated/synced later. Prefer a non-empty saved payload, otherwise
    // fall back to the current _trip_itinerary meta value.
    const savedItinerary = Array.isArray(savedData?.itinerary) && savedData.itinerary.length
      ? savedData.itinerary
      : undefined;
    const rawItinerary = savedItinerary ?? meta._trip_itinerary;
    let itinerary: NonNullable<WpTripSaveInput["itinerary"]> = [];
    if (Array.isArray(rawItinerary)) {
      itinerary = rawItinerary as NonNullable<WpTripSaveInput["itinerary"]>;
    } else if (typeof rawItinerary === "string") {
      try {
        const parsed = JSON.parse(rawItinerary);
        if (Array.isArray(parsed)) itinerary = parsed as NonNullable<WpTripSaveInput["itinerary"]>;
      } catch {
        // Ignore malformed legacy itinerary metadata.
      }
    }

    // WordPress trip meta is the canonical source for the editable trip
    // fields. The embedded PWA payload can be older, so do not let it overwrite
    // current dates, duration, travelers, locations, budget, or interests.
    const tripData: Omit<WpTripSaveInput, "email"> = {
      ...(savedData ?? {}),
      wpId: Number(res.data.id),
      title: savedData?.title || decodeHtml(res.data.title?.rendered ?? ""),
      code: String(meta._trip_code ?? savedData?.code ?? res.data.id),
      fromPlace: String(meta.trip_from_place ?? savedData?.fromPlace ?? ""),
      fromLat: meta.trip_from_lat != null ? Number(meta.trip_from_lat) || undefined : savedData?.fromLat,
      fromLng: meta.trip_from_lng != null ? Number(meta.trip_from_lng) || undefined : savedData?.fromLng,
      locations: Object.prototype.hasOwnProperty.call(meta, "trip_location")
        ? asStrings(meta.trip_location)
        : (savedData?.locations ?? []),
      budget: String(meta.trip_budget ?? savedData?.budget ?? ""),
      tripType: String(meta.trip_type ?? savedData?.tripType ?? ""),
      datesKnown: Object.prototype.hasOwnProperty.call(meta, "trips_dates")
        ? String(meta.trips_dates) === "dates_known"
        : (savedData?.datesKnown ?? true),
      start: String(meta.trip_start ?? savedData?.start ?? ""),
      end: String(meta.trip_end ?? savedData?.end ?? ""),
      months: Object.prototype.hasOwnProperty.call(meta, "when_are_you_going")
        ? asStrings(meta.when_are_you_going)
        : (savedData?.months ?? []),
      days: Math.max(1, Math.min(7, Number(meta.trip_days ?? savedData?.days ?? 2) || 2)),
      interests: Object.prototype.hasOwnProperty.call(meta, "trip_interest")
        ? asStrings(meta.trip_interest)
        : (savedData?.interests ?? []),
      notes: String(meta.trip_notes ?? savedData?.notes ?? ""),
      items: savedData?.items ?? [],
      itinerary,
    };

    const items = rawItems;

    return {
      ok: true as const,
      tripId: Number(res.data.id),
      code: String(savedData?.code || meta._trip_code || res.data.id),
      interests: savedData?.interests?.length ? savedData.interests : asStrings(meta.trip_interest),
      savedListingIds: selectedIds,
      items,
      itinerary,
      title: decodeHtml(res.data.title?.rendered ?? savedData?.title ?? ""),
      slug: res.data.slug ?? "",
      url: res.data.link ?? `${WP_ORIGIN}/user_trip/${res.data.slug ?? ""}/`,
      data: tripData,
    };
  });

export const fetchWpUserTrips = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.string().email().optional() }))
  .handler(async ({ context }) => {
    const email = await authenticatedWpTripStoreEmail(context.userId);
    const headers = await wpTripSyncCredentials();
    if (!headers) {
      return {
        trips: [] as WpTrip[],
        configured: false as const,
        error: "WordPress trip sync is not configured on the PWA server.",
      };
    }

    // Resolve identity through the same server-to-server bridge that is
    // confirmed to work for saved places. WordPress can restrict /wp/v2/users
    // searches even when the bridge can resolve the account correctly.
    const tripStore = await wpTripStoreRequest(email);
    let wpUserId = tripStore.ok ? tripStore.userId : undefined;
    if (!wpUserId) {
      const wpUser = await resolveWpUserByEmail(email, headers);
      wpUserId = wpUser?.id;
    }
    if (!wpUserId) {
      return {
        trips: [] as WpTrip[],
        configured: true as const,
        error: tripStore.ok
          ? "The WordPress account bridge returned no user ID."
          : tripStore.error || "WordPress could not resolve the signed-in account.",
      };
    }

    // This response is user-specific. Do not route it through the shared
    // origin cache: after switching accounts in the same browser, a cached
    // response could expose the previous user's most recent trip.
    const tripsResponse = await fetch(
      `${WP_ORIGIN}/wp-json/wp/v2/user_trip?author=${wpUserId}&per_page=20&orderby=date&order=desc&_fields=id,slug,title,date,link,content&_xplore_user_cache_bust=${Date.now()}`,
      {
        headers: { Accept: "application/json", ...headers },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!tripsResponse.ok) {
      return {
        trips: [] as WpTrip[],
        configured: true as const,
        error: `WordPress trip listing failed (HTTP ${tripsResponse.status}).`,
      };
    }

    const tripsData = (await tripsResponse.json().catch(() => null)) as WpUserTrip[] | null;
    if (!Array.isArray(tripsData)) {
      return {
        trips: [] as WpTrip[],
        configured: true as const,
        error: "WordPress returned an unexpected response for saved trips.",
      };
    }

    return {
      configured: true as const,
      error: undefined as string | undefined,
      trips: tripsData.map((t) => {
        const savedData = decodeWpTripPayload(t.content);
        return {
          id: t.id,
          slug: t.slug,
          title: decodeHtml(t.title?.rendered ?? t.slug),
          date: t.date
            ? new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : "",
          url: t.link ?? `${WP_ORIGIN}/user_trip/${t.slug}/`,
          data: savedData,
        };
      }),
    };
  });


async function wpBookmarkStoreRequest(
  email: string,
  payload?: { operation: "add" | "remove" | "replace" | "state"; listingId?: number; bookmarkIds?: number[] },
) {
  const secret = await wpPwaSyncSecret();
  const legacyHeaders = secret ? null : await wpTripSyncCredentials();
  if (!secret && !legacyHeaders) {
    return {
      ok: false as const,
      bookmarkIds: [] as number[],
      configured: false as const,
      error: "WordPress bookmark sync is not configured on the PWA server.",
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false as const, bookmarkIds: [] as number[], configured: true as const, error: "A signed-in email is required." };
  }

  const bookmarkUrl = secret
    ? `${WP_ORIGIN}/wp-json/xplore/v1/pwa/sync/bookmarks`
    : `${WP_ORIGIN}/wp-json/xplore/v1/pwa/bookmarks/sync`;
  const url = payload
    ? (secret ? bookmarkUrl : `${WP_ORIGIN}/wp-json/xplore/v1/pwa/bookmarks/sync`)
    : secret
      ? `${bookmarkUrl}?email=${encodeURIComponent(normalizedEmail)}&_=${Date.now()}`
      : `${WP_ORIGIN}/wp-json/xplore/v1/pwa/bookmarks/state?email=${encodeURIComponent(normalizedEmail)}&_=${Date.now()}`;

  const res = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(!payload ? { "Cache-Control": "no-cache, no-store, max-age=0", Pragma: "no-cache" } : {}),
      ...(payload ? { "Content-Type": "application/json" } : {}),
      ...(secret ? { "X-Xplore-PWA-Secret": secret } : legacyHeaders!),
    },
    ...(!payload ? { cache: "no-store" as const } : {}),
    ...(payload
      ? {
          body: JSON.stringify({
            email: normalizedEmail,
            operation: payload.operation,
            listingId: payload.listingId,
            listing_id: payload.listingId,
            bookmark_ids: payload.bookmarkIds ? [...new Set(payload.bookmarkIds)] : undefined,
            bookmarkIds: payload.bookmarkIds ? [...new Set(payload.bookmarkIds)] : undefined,
          }),
        }
      : undefined),
    signal: AbortSignal.timeout(15000),
  });

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; bookmark_ids?: unknown; message?: string; code?: string }
    | null;
  const bookmarkIds = Array.isArray(body?.bookmark_ids)
    ? [...new Set(body.bookmark_ids.map(Number).filter((id) => Number.isFinite(id) && id > 0))]
    : [];

  if (!res.ok || body?.ok === false) {
    return {
      ok: false as const,
      bookmarkIds: [] as number[],
      configured: true as const,
      error: body?.message || body?.code || `WordPress returned HTTP ${res.status}.`,
    };
  }

  return { ok: true as const, bookmarkIds, configured: true as const };
}

export const fetchWpBookmarks = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    setResponseHeader("Pragma", "no-cache");
    return wpBookmarkStoreRequest(data.email, { operation: "state" });
  });

export const updateWpBookmarks = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email(),
      operation: z.enum(["add", "remove", "replace"]),
      listingId: z.number().int().positive().optional(),
      bookmarkIds: z.array(z.number().int().positive()).optional(),
    }),
  )
  .handler(async ({ data }) => wpBookmarkStoreRequest(data.email, data));

export const syncWpBookmarks = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email(),
      bookmarkIds: z.array(z.number().int().positive()),
    }),
  )
  .handler(async ({ data }) =>
    wpBookmarkStoreRequest(data.email, { operation: "replace", bookmarkIds: data.bookmarkIds }),
  );

export const fetchWpGuide = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1), url: z.string().optional() }))
  .handler(async ({ data }) => {
    const slugs = guideSlugCandidates(data.slug, data.url);
    const urls = [
      data.url,
      ...slugs.map((s) => `${WP_ORIGIN}/guide/${s}/`),
    ].filter((url, i, all): url is string => !!url && all.indexOf(url) === i);

    const [restHits, page] = await Promise.all([
      Promise.all(
        slugs.map((s) =>
          wpGet<WpGuide[]>(
            `/wp-json/wp/v2/travel_guide?slug=${encodeURIComponent(s)}&_embed=1`,
            {},
            15000,
          ).catch(() => null),
        ),
      ),
      loadGuidePageHtml(urls, 20000),
    ]);

    const restRow = restHits
      .map((res) => (res?.ok && Array.isArray(res.data) ? res.data[0] : undefined))
      .find(Boolean);

    let mapped: Guide | null = restRow ? mapGuide(restRow) : null;
    const local =
      localGuides.find((g) => slugs.includes(g.slug) || (g.siteUrl && slugs.some((s) => g.siteUrl?.includes(s)))) ??
      mapped ??
      null;
    if (page) {
      const fromHtml = guideFromHtml(mapped?.slug || data.slug, page.url, page.html, mapped ?? local);
      const htmlRich = fromHtml.sections.some((s) => (s.blocks?.length ?? 0) > 1);
      if (htmlRich && fromHtml.sections.length >= (mapped?.sections.length ?? 0)) {
        return {
          ...fromHtml,
          slug: mapped?.slug || fromHtml.slug,
          title: mapped?.title || fromHtml.title,
          date: mapped?.date || fromHtml.date,
          topic: mapped?.topic || fromHtml.topic,
          categories: mapped?.categories,
          tags: mapped?.tags,
          image: pickListingImage(mapped?.image, fromHtml.image, local?.image),
        };
      }
    }
    return mapped ?? local ?? null;
  });

async function fetchAllAuthorListings(authorId: number, headers: HeadersInit): Promise<WpListing[]> {
  const first = await wpGet<WpListing[]>(
    `/wp-json/wp/v2/listing?author=${authorId}&per_page=100&page=1&_embed=1&_fields=id,author,slug,link,title,content,excerpt,featured_media,listing_category,region,listing_feature,class_list,meta,xplore_archive_meta,xplore_meta,xplore_featured,xplore_view_count,_embedded`,
    headers,
    20000,
  );
  if (!first.ok || !Array.isArray(first.data)) return [];

  const listings = [...first.data];
  const declaredPages = Number(first.headers.get("X-WP-TotalPages") ?? 0);
  // WordPress caps per_page at 100. Respect its pagination headers, with a
  // defensive sequential fallback for responses where cached headers are absent.
  const maxPages = declaredPages > 0 ? Math.min(declaredPages, 100) : 100;
  for (let page = 2; page <= maxPages; page += 1) {
    const result = await wpGet<WpListing[]>(
      `/wp-json/wp/v2/listing?author=${authorId}&per_page=100&page=${page}&_embed=1&_fields=id,author,slug,link,title,content,excerpt,featured_media,listing_category,region,listing_feature,class_list,meta,xplore_archive_meta,xplore_meta,xplore_featured,xplore_view_count,_embedded`,
      headers,
      20000,
    );
    if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) break;
    listings.push(...result.data);
    if (declaredPages <= 0 && result.data.length < 100) break;
  }
  return listings;
}

async function loadAuthorContent(authorId: number, headers: HeadersInit) {
  const [myListings, trips, experiences, events] = await Promise.all([
    fetchAllAuthorListings(authorId, headers),
    wpGet<WpUserTrip[]>(
      `/wp-json/wp/v2/user_trip?author=${authorId}&per_page=20&orderby=date&order=desc`,
      headers,
      15000,
    ),
    wpGet<WpExperienceRest[]>(
      `/wp-json/wp/v2/experiences?author=${authorId}&per_page=48&page=1&_embed=1&_fields=${EXPERIENCE_REST_FIELDS}`,
      headers,
      15000,
    ),
    wpGet<Array<{ id: number; slug: string; title?: { rendered?: string }; status?: string; date?: string; link?: string; xplore_view_count?: number; meta?: Record<string, unknown> }>>(
      `/wp-json/wp/v2/xplore_event?author=${authorId}&per_page=30&orderby=date&order=desc&_fields=id,slug,title,status,date,link,xplore_view_count,meta`,
      headers,
      15000,
    ),
  ]);
  const mappedListings = myListings.map((row) => mapListing(row));
  const myExperiences = experiences.ok && Array.isArray(experiences.data)
    ? (await Promise.all(experiences.data.map(mapWpExperienceWithImage))).filter((row) => row.id > 0 && row.slug)
    : [];
  const myTrips: WpTrip[] =
    trips.ok && Array.isArray(trips.data)
      ? trips.data.map((t) => ({
          id: t.id,
          slug: t.slug,
          title: decodeHtml(t.title?.rendered ?? t.slug),
          date: t.date
            ? new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : "",
          url: t.link ?? `${WP_ORIGIN}/user_trip/${t.slug}/`,
        }))
      : [];
  const myEvents = events.ok && Array.isArray(events.data)
    ? events.data.map((event) => ({
        id: Number(event.id),
        slug: String(event.slug ?? ""),
        title: decodeHtml(event.title?.rendered ?? event.slug ?? "Untitled event"),
        status: String(event.status ?? "unknown"),
        date: event.date ? new Date(event.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "",
        url: String(event.link ?? ""),
        siteViewCount: Math.max(0, Number(event.meta?._listing_views_count ?? event.meta?.listing_views_count ?? 0) || 0),
        appViewCount: Math.max(0, Number(event.xplore_view_count ?? 0) || 0),
      }))
    : [];
  return { myListings: mappedListings, myTrips, myExperiences, myEvents };
}

export const fetchWpAuthorContent = createServerFn({ method: "GET" })
  .validator(z.object({ authorId: z.number().int().positive() }))
  .handler(async ({ data }) => loadAuthorContent(data.authorId, {}));

export const wpLogin = createServerFn({ method: "POST" })
  .validator(
    z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    const username = data.username.trim();
    const password = data.password;
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) {
      return { ok: false as const, error: "The WordPress login bridge is not configured. Please contact support." };
    }

    let response: Response;
    try {
      response = await fetch(`${WP_ORIGIN}/wp-json/xplore/v1/pwa/auth/login`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer " + secret,
          "X-Xplore-PWA-Secret": secret,
        },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      console.warn("[wpLogin] WordPress credential endpoint could not be reached", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return { ok: false as const, error: "The WordPress login service could not be reached. Please try again." };
    }

    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; user?: WpMe; logged_in_cookie?: string; code?: string; message?: string }
      | null;

    if (!response.ok || !payload?.ok || !payload.user) {
      if (response.status === 401 || payload?.code === "invalid_credentials") {
        return { ok: false as const, error: "That username or password was not accepted. Use the same login as xplorepondy.com." };
      }
      if (response.status === 404) {
        return { ok: false as const, error: "The WordPress login bridge needs updating on xplorepondy.com before password login can work." };
      }
      if (response.status === 403) {
        return { ok: false as const, error: "The WordPress login bridge is rejecting the PWA connection. Check that both sites use the same bridge secret." };
      }
      console.warn("[wpLogin] WordPress credential endpoint returned an error", {
        status: response.status,
        code: payload?.code ?? "unknown",
      });
      return { ok: false as const, error: "WordPress could not create a login session. Please try again." };
    }

    // The WordPress bridge returns the cookie generated by wp_signon().
    // Forward it as an HttpOnly parent-domain cookie so the PWA and the
    // main Listeo site share the same authenticated browser session.
    const cookieMatch = String(payload.logged_in_cookie ?? "").match(/^(wordpress_logged_in_[^=;]+=([^;]+))$/);
    if (!cookieMatch?.[1]) {
      console.warn("[wpLogin] WordPress accepted credentials but returned no logged-in cookie");
      return { ok: false as const, error: "WordPress accepted the login but could not create a session. Please try again." };
    }

    setResponseHeader(
      "Set-Cookie",
      `${cookieMatch[1]}; Domain=.xplorepondy.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600`,
    );

    const me = payload.user;
    const user = mapUser(me);
    const identityToken = await signWpIdentityToken(user.email, user.id);
    let authorContent: Awaited<ReturnType<typeof loadAuthorContent>>;
    try {
      authorContent = await loadAuthorContent(user.id, { Cookie: cookieMatch[1] });
    } catch (error) {
      // Login should not fail just because the user's optional content summary
      // could not load. The session cookie and verified identity are already
      // issued by WordPress at this point.
      console.warn("[wpLogin] Signed in but author content could not be loaded", {
        errorName: error instanceof Error ? error.name : "unknown",
      });
      authorContent = { myListings: [], myTrips: [], myExperiences: [], myEvents: [] };
    }
    const { myListings, myTrips } = authorContent;
    const bookmarkIds = bookmarkIdsFromUserMeta(me.meta);

    return {
      ok: true as const,
      user,
      myListings,
      myTrips,
      bookmarkIds,
      method: "wordpress" as const,
      identityToken: identityToken ?? "",
    };
  });

export type TableReservationConfig = {
  enabled: boolean;
  advanceDays: number;
  minGuests: number;
  maxGuests: number;
  cutoffMinutes: number;
  autoConfirm: boolean;
  timezone: string;
};

export type TableReservationSlot = {
  id: number;
  startTime: string;
  endTime: string;
  capacity: number;
  remaining: number;
};

export type TableReservation = {
  id: number;
  bookingId?: number;
  uuid: string;
  listingId: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  guests: number;
  status: string;
  source: string;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
  checkedIn?: boolean;
  checkedInAt?: string;
};

export type TableReservationOwnerListing = {
  id: number;
  title: string;
  slug: string;
};

export type TableReservationOwnerDashboard = {
  listings: TableReservationOwnerListing[];
  reservations: TableReservation[];
};

async function pwaBridgeRequest(path: string, init?: RequestInit) {
  const url = new URL("/wp-json/xplore/v1" + path, WP_ORIGIN);
  const response = await fetch(url.toString(), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "PWA profile request failed (HTTP " + response.status + ").";
    throw new Error(message);
  }
  return payload;
}

async function tableReservationRequest(path: string, init?: RequestInit) {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";
  const requestPath = isGet
    ? path + (path.includes("?") ? "&" : "?") + "_xp_ts=" + Date.now()
    : path;
  const url = new URL("/wp-json/xplore/v1/table-reservations" + requestPath, WP_ORIGIN);
  const response = await fetch(url.toString(), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "Reservation request failed (HTTP " + response.status + ").";
    throw new Error(message);
  }
  return payload;
}

export const fetchTableReservationConfig = createServerFn({ method: "GET" })
  .validator(z.object({ listingId: z.coerce.number().int().positive() }))
  .handler(async ({ data }) => {
    const payload = await tableReservationRequest("/config?listing_id=" + data.listingId);
    return {
      enabled: Boolean(payload?.enabled),
      advanceDays: Number(payload?.advance_days ?? 15),
      minGuests: Number(payload?.min_guests ?? 1),
      maxGuests: Number(payload?.max_guests ?? 12),
      cutoffMinutes: Number(payload?.cutoff_minutes ?? 30),
      autoConfirm: Boolean(payload?.auto_confirm),
      timezone: String(payload?.timezone ?? "Asia/Kolkata"),
    } satisfies TableReservationConfig;
  });


export type TableReservationNotification = {
  id: number;
  notification_type: string;
  title: string;
  body: string;
  url: string;
  reservation_id: number | null;
  reservation_date?: string | null;
  reservation_start_time?: string | null;
  reservation_end_time?: string | null;
  read_at: string | null;
  created_at: string;
};

function tableReservationBridgeHeaders() {
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
  return {
    "Content-Type": "application/json",
    "X-Xplore-PWA-Secret": secret,
    Authorization: "Bearer " + secret,
  };
}

export const fetchTableReservationPushKey = createServerFn({ method: "GET" })
  .handler(async () => {
    setResponseHeader("Cache-Control", "no-store");
    const payload = await tableReservationRequest("/notifications/public-key");
    return { enabled: Boolean(payload?.enabled), publicKey: String(payload?.public_key ?? "") };
  });

/**
 * Authorize a notification inbox against a verified identity.
 *
 * Google/federated PWA sessions are checked against Better Auth first. A
 * WordPress-only login has no Better Auth session, so its HttpOnly
 * wordpress_logged_in_<hash> cookie is verified by the WordPress plugin over
 * the private server-to-server bridge. Never trust the browser's persisted
 * Zustand user/email by itself.
 */
async function assertNotificationCallerEmail(email: string, identityToken?: string) {
  assertSameSiteRequest();
  const normalizedEmail = email.trim().toLowerCase();
  const appUser = await getSessionUser();

  if (appUser) {
    const verifiedEmail = String(appUser.email ?? "").trim().toLowerCase();
    if (verifiedEmail && verifiedEmail === normalizedEmail) return;
    // A different verified app identity cannot use this inbox.
  }
  // WordPress credential login is verified server-side in wpLogin. This
  // short-lived signed token carries that verified identity to later requests,
  // avoiding dependence on a WordPress cookie that may not validate across the
  // PWA-to-WordPress server bridge. The signature is never browser-generated.
  if (await verifyWpIdentityToken(identityToken, normalizedEmail)) return;

  const cookieHeader = getRequest()?.headers.get("cookie") ?? "";
  const wpCookieMatch = cookieHeader.match(/(?:^|;\s*)(wordpress_logged_in_[^=;\s]+)=([^;]+)/);
  const wpLoggedInCookie = wpCookieMatch?.[2];
  if (!wpLoggedInCookie) {
    throw new Error("Your WordPress login could not be verified. Please sign in again.");
  }

  const identity = await tableReservationRequest("/notifications/identity", {
    method: "POST",
    headers: {
      ...tableReservationBridgeHeaders(),
      "X-Xplore-WordPress-Cookie": wpLoggedInCookie,
    },
    body: JSON.stringify({ email: normalizedEmail }),
  });
  if (!identity?.ok) {
    throw new Error("Your signed-in WordPress account does not match this notification inbox.");
  }
}


export const subscribeTableReservationFcm = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(), identityToken: z.string().max(4096).optional(),
    token: z.string().trim().min(80).max(4096),
    endpoint: z.string().url(),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    await assertNotificationCallerEmail(data.email, data.identityToken);
    const payload = await tableReservationRequest("/notifications/fcm-subscribe", {
      method: "POST",
      headers: tableReservationBridgeHeaders(),
      body: JSON.stringify({ email: data.email.trim().toLowerCase(), token: data.token, endpoint: data.endpoint }),
    });
    return { ok: Boolean(payload?.ok) };
  });

export const unsubscribeTableReservationFcm = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(), identityToken: z.string().max(4096).optional(),
    token: z.string().trim().min(80).max(4096),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    await assertNotificationCallerEmail(data.email, data.identityToken);
    const payload = await tableReservationRequest("/notifications/fcm-unsubscribe", {
      method: "POST",
      headers: tableReservationBridgeHeaders(),
      body: JSON.stringify({ email: data.email.trim().toLowerCase(), token: data.token }),
    });
    return { ok: Boolean(payload?.ok) };
  });

export const subscribeTableReservationPush = createServerFn({ method: "POST" })
  
  .validator(z.object({
    email: z.string().trim().email(), identityToken: z.string().max(4096).optional(),
    subscription: z.object({
      endpoint: z.string().url(),
      expirationTime: z.number().nullable().optional(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
    }),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    await assertNotificationCallerEmail(data.email, data.identityToken);
    const payload = await tableReservationRequest("/notifications/subscribe", {
      method: "POST",
      headers: tableReservationBridgeHeaders(),
      body: JSON.stringify({ email: data.email.trim().toLowerCase(), ...data.subscription }),
    });
    return { ok: Boolean(payload?.ok) };
  });

export const unsubscribeTableReservationPush = createServerFn({ method: "POST" })
  
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), endpoint: z.string().url() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    await assertNotificationCallerEmail(data.email, data.identityToken);
    const payload = await tableReservationRequest("/notifications/unsubscribe", {
      method: "POST",
      headers: tableReservationBridgeHeaders(),
      body: JSON.stringify({ email: data.email.trim().toLowerCase(), endpoint: data.endpoint }),
    });
    return { ok: Boolean(payload?.ok) };
  });

export type ExperienceBookingRequest = {
  id: number;
  experience_id: number;
  experience_title: string;
  experience_url: string;
  experience_slug: string;
  name: string;
  email?: string;
  phone?: string;
  date: string;
  time: string;
  participants: number;
  status: "pending_review" | "accepted" | "confirmed" | "rejected" | "completed" | string;
  submitted_at: string;
  updated_at: string;
  latest_update: string;
  notes?: string;
  checked_in?: boolean;
  checked_in_at?: string;
};

export const fetchWpOwnerExperienceBookingRequests = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    const email = data.email.trim().toLowerCase();
    await assertNotificationCallerEmail(email, data.identityToken);
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const response = await fetch(
      `${WP_ORIGIN}/wp-json/xpe/v1/booking-requests/owner?email=${encodeURIComponent(email)}`,
      { headers: { Accept: "application/json", "X-Xplore-PWA-Secret": secret, Authorization: "Bearer " + secret }, cache: "no-store", signal: AbortSignal.timeout(15000) },
    );
    const payload = await response.json().catch(() => null) as { items?: unknown; message?: string } | null;
    if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not load experience bookings for your experiences.");
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    return rows.flatMap((row): ExperienceBookingRequest[] => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      const status = String(value.status ?? "pending_review");
      if (!["pending_review", "accepted", "confirmed", "rejected", "completed"].includes(status)) return [];
      return [{
        id: Number(value.id), experience_id: Number(value.experience_id),
        experience_title: String(value.experience_title ?? "Experience"),
        experience_url: String(value.experience_url ?? ""), experience_slug: String(value.experience_slug ?? ""), name: String(value.name ?? ""),
        email: String(value.email ?? ""), phone: String(value.phone ?? ""),
        date: String(value.date ?? ""), time: String(value.time ?? ""),
        participants: Number(value.participants ?? 1), status,
        submitted_at: String(value.submitted_at ?? ""), updated_at: String(value.updated_at ?? ""),
        latest_update: String(value.latest_update ?? ""), notes: String(value.notes ?? ""), checked_in: Boolean(value.checked_in), checked_in_at: String(value.checked_in_at ?? ""),
      }];
    });
  });

export const updateWpOwnerExperienceBookingRequestStatus = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(),
    identityToken: z.string().max(4096).optional(),
    bookingId: z.number().int().positive(),
    status: z.enum(["pending_review", "accepted", "confirmed", "rejected", "completed"]),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    const email = data.email.trim().toLowerCase();
    await assertNotificationCallerEmail(email, data.identityToken);
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const response = await fetch(`${WP_ORIGIN}/wp-json/xpe/v1/booking-requests/owner-status`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Xplore-PWA-Secret": secret,
        Authorization: "Bearer " + secret,
      },
      body: JSON.stringify({ email, booking_id: data.bookingId, status: data.status }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; message?: string; status?: string } | null;
    if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not update the experience request status.");
    const savedStatus = String(payload?.status ?? "");
    if (!payload?.success || savedStatus !== data.status) {
      throw new Error("WordPress did not confirm the requested status was saved. Refresh the page and try again.");
    }
    return { success: true, status: savedStatus as typeof data.status };
  });

export const fetchWpExperienceBookingRequests = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    const email = data.email.trim().toLowerCase();
    await assertNotificationCallerEmail(email, data.identityToken);
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const response = await fetch(
      `${WP_ORIGIN}/wp-json/xpe/v1/booking-requests/mine?email=${encodeURIComponent(email)}`,
      {
        headers: { Accept: "application/json", "X-Xplore-PWA-Secret": secret, Authorization: "Bearer " + secret },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    const payload = await response.json().catch(() => null) as { items?: unknown; message?: string } | null;
    if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not load experience booking requests.");
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    return rows.flatMap((row): ExperienceBookingRequest[] => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      const status = String(value.status ?? "pending_review");
      if (!["pending_review", "accepted", "confirmed", "rejected", "completed"].includes(status)) return [];
      return [{
        id: Number(value.id),
        experience_id: Number(value.experience_id),
        experience_title: String(value.experience_title ?? "Experience"),
        experience_url: String(value.experience_url ?? ""),
        name: String(value.name ?? ""),
        date: String(value.date ?? ""),
        time: String(value.time ?? ""),
        participants: Number(value.participants ?? 1),
        status: status as ExperienceBookingRequest["status"],
        submitted_at: String(value.submitted_at ?? ""),
        updated_at: String(value.updated_at ?? ""),
        latest_update: String(value.latest_update ?? ""),
      }];
    });
  });

export const fetchTableReservationNotifications = createServerFn({ method: "GET" })
  
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    await assertNotificationCallerEmail(data.email, data.identityToken);
    const payload = await tableReservationRequest("/notifications/mine?email=" + encodeURIComponent(data.email.trim().toLowerCase()), {
      headers: tableReservationBridgeHeaders(),
    });
    const items = Array.isArray(payload?.items) ? payload.items as TableReservationNotification[] : [];
    return { items, unread: Number(payload?.unread ?? 0) };
  });

export const markTableReservationNotificationsRead = createServerFn({ method: "POST" })
  
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), ids: z.array(z.coerce.number().int().positive()).max(100) }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    await assertNotificationCallerEmail(data.email, data.identityToken);
    const payload = await tableReservationRequest("/notifications/read", {
      method: "POST",
      headers: tableReservationBridgeHeaders(),
      body: JSON.stringify({ email: data.email.trim().toLowerCase(), ids: data.ids }),
    });
    return { ok: Boolean(payload?.ok) };
  });

export const saveWpUserProfile = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().max(60).default(""),
    phone: z.string().trim().max(30).default(""),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await pwaBridgeRequest("/pwa/profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xplore-PWA-Secret": secret,
        Authorization: "Bearer " + secret,
      },
      body: JSON.stringify({
        email: data.email.trim().toLowerCase(),
        first_name: data.firstName.trim(),
        last_name: data.lastName.trim(),
        phone: data.phone.trim(),
      }),
    });
    return {
      id: Number(payload?.user?.id ?? 0),
      name: String(payload?.user?.name ?? [data.firstName, data.lastName].filter(Boolean).join(" ")),
      email: String(payload?.user?.email ?? data.email),
      firstName: String(payload?.user?.first_name ?? data.firstName),
      lastName: String(payload?.user?.last_name ?? data.lastName),
      phone: String(payload?.user?.phone ?? data.phone),
      slug: "",
      avatar: "",
      roles: [],
    } satisfies WpUser;
  });

export type TableReservationOwnerDay = {
  day: number;
  name: string;
  active: boolean;
  open: string;
  close: string;
  interval: number;
  capacity: number;
};

export type TableReservationOwnerSettings = {
  listingId: number;
  listingTitle: string;
  listingSlug: string;
  enabled: boolean;
  durationMinutes: number;
  advanceDays: number;
  minGuests: number;
  maxGuests: number;
  cutoffMinutes: number;
  autoConfirm: boolean;
  timezone: string;
  days: TableReservationOwnerDay[];
};

export const fetchListingIdentity = createServerFn({ method: "GET" })
  .validator(z.object({ listingId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const response = await fetch(
      WP_ORIGIN + "/wp-json/wp/v2/listing/" + encodeURIComponent(String(data.listingId)) + "?_fields=id,slug,title",
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error("Listing could not be loaded.");
    const payload = (await response.json()) as {
      id?: number;
      slug?: string;
      title?: { rendered?: string };
    };
    return {
      id: Number(payload.id ?? data.listingId),
      title: String(payload.title?.rendered ?? "").trim(),
      slug: String(payload.slug ?? "").trim(),
    };
  });

export const fetchListingIdentityBySlug = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().trim().min(1) }))
  .handler(async ({ data }) => {
    const response = await fetch(
      WP_ORIGIN + "/wp-json/wp/v2/listing?slug=" + encodeURIComponent(data.slug) + "&per_page=1&_fields=id,slug,title",
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error("Listing could not be loaded.");
    const payload = (await response.json()) as Array<{
      id?: number;
      slug?: string;
      title?: { rendered?: string };
    }>;
    const listing = payload[0];
    if (!listing) throw new Error("Listing could not be loaded.");
    return {
      id: Number(listing.id ?? 0),
      title: String(listing.title?.rendered ?? "").trim(),
      slug: String(listing.slug ?? data.slug).trim(),
    };
  });

export const fetchTableReservationOwnerSettings = createServerFn({ method: "GET" })
  .validator(z.object({
    email: z.string().trim().email(),
    userId: z.number().int().positive().optional(),
    listingId: z.number().int().positive(),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const query = "/owner/settings?listing_id=" + encodeURIComponent(String(data.listingId))
      + "&user_id=" + encodeURIComponent(String(data.userId ?? 0))
      + "&email=" + encodeURIComponent(data.email.trim().toLowerCase());
    const payload = await tableReservationRequest(query, {
      headers: {
        "X-Xplore-PWA-Secret": secret,
        Authorization: "Bearer " + secret,
      },
    });
    return {
      listingId: Number(payload?.listing_id ?? data.listingId),
      listingTitle: String(payload?.listing_title ?? `Listing #${data.listingId}`),
      listingSlug: String(payload?.listing_slug ?? ""),
      enabled: Boolean(payload?.enabled),
      durationMinutes: Number(payload?.duration_minutes ?? 90),
      advanceDays: Number(payload?.advance_days ?? 30),
      minGuests: Number(payload?.min_guests ?? 1),
      maxGuests: Number(payload?.max_guests ?? 12),
      cutoffMinutes: Number(payload?.cutoff_minutes ?? 30),
      autoConfirm: Boolean(payload?.auto_confirm),
      timezone: String(payload?.timezone ?? "Asia/Kolkata"),
      days: Array.isArray(payload?.days) ? payload.days.map((day) => ({
        day: Number(day?.day ?? 0),
        name: String(day?.name ?? ""),
        active: Boolean(day?.active),
        open: String(day?.open ?? "11:00"),
        close: String(day?.close ?? "22:00"),
        interval: Number(day?.interval ?? 30),
        capacity: Number(day?.capacity ?? 20),
      })) : [],
    } satisfies TableReservationOwnerSettings;
  });

export const saveTableReservationOwnerSettings = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(),
    userId: z.number().int().positive().optional(),
    listingId: z.number().int().positive(),
    enabled: z.boolean(),
    durationMinutes: z.number().int().min(15).max(480),
    advanceDays: z.number().int().min(0).max(30),
    minGuests: z.number().int().min(1).max(100),
    maxGuests: z.number().int().min(1).max(100),
    cutoffMinutes: z.number().int().min(0).max(1440),
    autoConfirm: z.boolean(),
    timezone: z.string().min(1),
    days: z.array(z.object({
      day: z.number().int().min(0).max(6),
      name: z.string(),
      active: z.boolean(),
      open: z.string(),
      close: z.string(),
      interval: z.number().int().min(5).max(240),
      capacity: z.number().int().min(1).max(1000),
    })).length(7),
  }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest("/owner/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xplore-PWA-Secret": secret,
        Authorization: "Bearer " + secret,
      },
      body: JSON.stringify({
        listing_id: data.listingId,
        user_id: data.userId,
        email: data.email.trim().toLowerCase(),
        enabled: data.enabled,
        duration_minutes: data.durationMinutes,
        advance_days: data.advanceDays,
        min_guests: data.minGuests,
        max_guests: data.maxGuests,
        cutoff_minutes: data.cutoffMinutes,
        auto_confirm: data.autoConfirm,
        timezone: data.timezone,
        days: data.days,
      }),
    });
    return {
      listingId: Number(payload?.listing_id ?? data.listingId),
      listingTitle: String(payload?.listing_title ?? `Listing #${data.listingId}`),
      listingSlug: String(payload?.listing_slug ?? ""),
      enabled: Boolean(payload?.enabled),
      durationMinutes: Number(payload?.duration_minutes ?? data.durationMinutes),
      advanceDays: Number(payload?.advance_days ?? data.advanceDays),
      minGuests: Number(payload?.min_guests ?? data.minGuests),
      maxGuests: Number(payload?.max_guests ?? data.maxGuests),
      cutoffMinutes: Number(payload?.cutoff_minutes ?? data.cutoffMinutes),
      autoConfirm: Boolean(payload?.auto_confirm ?? data.autoConfirm),
      timezone: String(payload?.timezone ?? data.timezone),
      days: Array.isArray(payload?.days)
        ? payload.days.map((day) => ({
            day: Number(day?.day ?? 0),
            name: String(day?.name ?? ""),
            active: Boolean(day?.active),
            open: String(day?.open ?? "11:00"),
            close: String(day?.close ?? "22:00"),
            interval: Number(day?.interval ?? 30),
            capacity: Number(day?.capacity ?? 20),
          }))
        : data.days,
    } satisfies TableReservationOwnerSettings;
  });

export const fetchTableReservationOwnerDashboard = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), userId: z.number().int().positive().optional() }))
  .handler(async ({ data }) => {
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest(
      "/owner?user_id=" + encodeURIComponent(String(data.userId ?? 0)) + "&email=" + encodeURIComponent(data.email.trim().toLowerCase()),
      {
        headers: {
          "X-Xplore-PWA-Secret": secret,
          Authorization: "Bearer " + secret,
        },
      },
    );
    return {
      listings: Array.isArray(payload?.listings)
        ? payload.listings.map((listing) => ({
            id: Number(listing?.id ?? 0),
            title: String(listing?.title ?? ""),
            slug: String(listing?.slug ?? ""),
          }))
        : [],
      reservations: Array.isArray(payload?.reservations)
        ? payload.reservations.map((reservation) => ({
            id: Number(reservation?.id ?? 0),
            bookingId: Number(reservation?.booking_id ?? 0) || undefined,
            uuid: String(reservation?.uuid ?? ""),
            listingId: Number(reservation?.listing_id ?? 0),
            guestName: String(reservation?.guest_name ?? ""),
            guestEmail: String(reservation?.guest_email ?? ""),
            guestPhone: String(reservation?.guest_phone ?? ""),
            reservationDate: String(reservation?.date ?? ""),
            startTime: String(reservation?.start_time ?? ""),
            endTime: String(reservation?.end_time ?? ""),
            guests: Number(reservation?.guests ?? 0),
            status: String(reservation?.status ?? ""),
            source: String(reservation?.source ?? ""),
            notes: String(reservation?.notes ?? ""),
            createdAt: reservation?.created_at ? String(reservation.created_at) : undefined,
            updatedAt: reservation?.updated_at ? String(reservation.updated_at) : undefined,
            checkedIn: Boolean(reservation?.checked_in),
            checkedInAt: reservation?.checked_in_at ? String(reservation.checked_in_at) : undefined,
          }))
        : [],
    } satisfies TableReservationOwnerDashboard;
  });

export const updateTableReservationOwnerStatus = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(),
    userId: z.number().int().positive().optional(),
    reservationId: z.number().int().positive(),
    status: z.enum(["pending", "confirmed", "cancelled", "completed", "no-show"]),
  }))
  .handler(async ({ data }) => {
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest("/owner/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xplore-PWA-Secret": secret,
        Authorization: "Bearer " + secret,
      },
      body: JSON.stringify({
        email: data.email.trim().toLowerCase(),
        ...(data.userId ? { user_id: data.userId } : {}),
        reservation_id: data.reservationId,
        status: data.status,
      }),
    });
    return {
      id: Number(payload?.id ?? data.reservationId),
      status: String(payload?.status ?? data.status),
    };
  });

export const fetchTableReservationMine = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest(
      "/mine?email=" + encodeURIComponent(data.email.trim().toLowerCase()),
      {
        headers: {
          "X-Xplore-PWA-Secret": secret,
          Authorization: "Bearer " + secret,
        },
      },
    );
    const rows = Array.isArray(payload) ? payload : [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      return [{
        id: Number(value.id), bookingId: Number(value.booking_id ?? 0) || undefined, uuid: String(value.uuid ?? ""), listingId: Number(value.listing_id),
        guestName: String(value.guest_name ?? ""), guestEmail: String(value.guest_email ?? ""),
        guestPhone: String(value.guest_phone ?? ""), reservationDate: String(value.date ?? ""),
        startTime: String(value.start_time ?? ""), endTime: String(value.end_time ?? ""),
        guests: Number(value.guests ?? 0), status: String(value.status ?? ""),
        source: String(value.source ?? ""), notes: String(value.notes ?? ""),
        createdAt: value.created_at ? String(value.created_at) : undefined,
        updatedAt: value.updated_at ? String(value.updated_at) : undefined,
        checkedIn: Boolean(value.checked_in),
        checkedInAt: value.checked_in_at ? String(value.checked_in_at) : undefined,
      } satisfies TableReservation];
    });
  });

export type TableReservationTicket = {
  type: "table"; booking_id: number; reference: string; token: string; title: string; slug: string;
  date: string; start_time: string; end_time: string; attendee: string; quantity: number;
  checked_in: boolean; checked_in_at: string;
};
export type TableReservationTicketCheckInResult = {
  success: boolean; type: "table"; booking_id: number; reference: string; title: string;
  attendee: string; quantity: number; checked_in_at: string;
};
async function verifyTableReservationIdentity(email: string, identityToken?: string) {
  const session = await getSessionUser();
  const sessionEmail = String(session?.email ?? "").trim().toLowerCase();
  const normalized = email.trim().toLowerCase();
  if (sessionEmail && sessionEmail === normalized) return;
  if (!await verifyWpIdentityToken(identityToken, normalized)) throw new Error("Please sign in again to view or scan reservation tickets.");
}
export const fetchMyTableReservationTicket = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), reservationId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await verifyTableReservationIdentity(data.email, data.identityToken);
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest(`/mine/${data.reservationId}/ticket?email=${encodeURIComponent(data.email.trim().toLowerCase())}`, {
      headers: { "X-Xplore-PWA-Secret": secret, Authorization: "Bearer " + secret },
    });
    return {
      type: "table", booking_id: Number(payload?.booking_id ?? data.reservationId), reference: String(payload?.reference ?? ""),
      token: String(payload?.token ?? ""), title: String(payload?.title ?? "Table reservation"), slug: String(payload?.slug ?? ""),
      date: String(payload?.date ?? ""), start_time: String(payload?.start_time ?? ""), end_time: String(payload?.end_time ?? ""),
      attendee: String(payload?.attendee ?? ""), quantity: Number(payload?.quantity ?? 0),
      checked_in: Boolean(payload?.checked_in), checked_in_at: String(payload?.checked_in_at ?? ""),
    } satisfies TableReservationTicket;
  });
export const checkInOwnerTableReservationTicket = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), token: z.string().min(10).max(240) }))
  .handler(async ({ data }) => {
    await verifyTableReservationIdentity(data.email, data.identityToken);
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest("/owner/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Xplore-PWA-Secret": secret, Authorization: "Bearer " + secret },
      body: JSON.stringify({ email: data.email.trim().toLowerCase(), token: data.token }),
    });
    return {
      success: Boolean(payload?.success), type: "table", booking_id: Number(payload?.booking_id ?? 0),
      reference: String(payload?.reference ?? ""), title: String(payload?.title ?? "Table reservation"),
      attendee: String(payload?.attendee ?? ""), quantity: Number(payload?.quantity ?? 0),
      checked_in_at: String(payload?.checked_in_at ?? ""),
    } satisfies TableReservationTicketCheckInResult;
  });

export const cancelTableReservation = createServerFn({ method: "POST" })
  .validator(z.object({ uuid: z.string().trim().min(1), email: z.string().trim().email() }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) throw new Error("The PWA WordPress bridge is not configured.");
    const payload = await tableReservationRequest("/mine/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Xplore-PWA-Secret": secret,
        Authorization: "Bearer " + secret,
      },
      body: JSON.stringify({ uuid: data.uuid, email: data.email.trim().toLowerCase() }),
    });
    return {
      uuid: String(payload?.uuid ?? data.uuid),
      status: String(payload?.status ?? "cancelled"),
    };
  });

export const fetchTableReservationAvailability = createServerFn({ method: "GET" })
  .validator(
    z.object({
      listingId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      guests: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const payload = await tableReservationRequest(
      "/availability?listing_id=" + data.listingId + "&date=" + encodeURIComponent(data.date) + "&guests=" + data.guests,
    );
    const slots = Array.isArray(payload?.slots)
      ? payload.slots.flatMap((row) => {
          if (!row || typeof row !== "object") return [];
          const value = row as Record<string, unknown>;
          return [{
            id: Number(value.id),
            startTime: String(value.start_time ?? ""),
            endTime: String(value.end_time ?? ""),
            capacity: Number(value.capacity ?? 0),
            remaining: Number(value.remaining ?? 0),
          }];
        })
      : [];
    return { slots };
  });

export const createTableReservation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      listingId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      guests: z.number().int().positive(),
      guestName: z.string().trim().min(1),
      guestEmail: z.string().trim().email(),
      guestPhone: z.string().trim().min(5),
      firebasePhoneIdToken: z.string().min(0).max(5000).optional().default(""),
      mobilePushConsent: z.boolean().optional().default(false),
      notes: z.string().optional().default(""),
    }),
  )
  .handler(async ({ data }) => {
    const payload = await tableReservationRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listing_id: data.listingId,
        date: data.date,
        start_time: data.startTime,
        end_time: data.endTime,
        guests: data.guests,
        guest_name: data.guestName,
        guest_email: data.guestEmail,
        guest_phone: data.guestPhone,
        firebase_phone_id_token: data.firebasePhoneIdToken ?? "",
        mobile_push_consent: data.mobilePushConsent,
        notes: data.notes ?? "",
        source: "pwa",
      }),
    });
    return {
      id: Number(payload?.id ?? 0),
      uuid: String(payload?.uuid ?? ""),
      listingId: Number(payload?.listing_id ?? data.listingId),
      guestName: String(payload?.guest_name ?? data.guestName),
      guestEmail: String(payload?.guest_email ?? data.guestEmail),
      guestPhone: String(payload?.guest_phone ?? data.guestPhone),
      reservationDate: String(payload?.reservation_date ?? data.date),
      startTime: String(payload?.start_time ?? data.startTime),
      endTime: String(payload?.end_time ?? data.endTime),
      guests: Number(payload?.guests ?? data.guests),
      status: String(payload?.status ?? ""),
      source: String(payload?.source ?? "pwa"),
      notes: String(payload?.notes ?? data.notes ?? ""),
    } satisfies TableReservation;
  });


