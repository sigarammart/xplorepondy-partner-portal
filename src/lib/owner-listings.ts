import { createServerFn } from "@tanstack/react-start";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/verify.server";
import { verifyWpIdentityToken } from "@/lib/wp-identity-token.server";


const WP_ORIGIN = (process.env.XPLORE_WORDPRESS_URL || "https://xplorepondy.com").replace(/\/$/, "");
const OWNER_LISTINGS_BASE = "/wp-json/xplore/v1/owner";

/**
 * WordPress currently has a reachable IPv4 address but its IPv6 endpoint resets
 * connections from the partner runtime. Use Node HTTPS with an explicit IPv4
 * family for server-to-server WordPress calls. This avoids changing global DNS
 * behavior and preserves the WordPress hostname for TLS/SNI.
 */
async function wordpressRequest(
  path: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: string,
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const url = new URL(`${WP_ORIGIN}${path}`);

  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        family: 4,
        servername: url.hostname,
        headers,
        timeout: 30_000,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
        incoming.on("end", () => {
          resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
        incoming.on("error", reject);
      },
    );

    request.on("timeout", () => request.destroy(new Error("WordPress request timed out.")));
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => response.body,
    json: async () => JSON.parse(response.body),
  };
}
const ownerIdentitySchema = z.object({
  email: z.string().trim().email().optional(),
  identityToken: z.string().max(4096).optional(),
});
type OwnerIdentity = z.infer<typeof ownerIdentitySchema>;

const submissionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().max(12000).optional().default(""),
  fields: z.record(z.string(), z.unknown()).optional().default({}),
  taxonomies: z.record(z.string(), z.array(z.number().int().positive())).optional().default({}),
});

type OwnerSubmission = z.infer<typeof submissionSchema>;
const createSubmissionSchema = submissionSchema.extend(ownerIdentitySchema.shape);
const editSubmissionSchema = submissionSchema.extend({
  listingId: z.number().int().positive(),
}).extend(ownerIdentitySchema.shape);
const imageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(12_000_000),
}).extend(ownerIdentitySchema.shape);

async function ownerRequest(path: string, method: "GET" | "POST", body?: unknown, identity: OwnerIdentity = {}) {
  // Better Auth is the primary identity for federated/app sessions.
  const user = await getSessionUser();
  let callerEmail = user?.email?.trim().toLowerCase() ?? "";

  // WordPress password sessions live in the separate PWA session store, not
  // the Better Auth cookie. Accept that identity only with the HMAC token the
  // server minted after wp_signon; never trust a caller-supplied email alone.
  if (
    !callerEmail &&
    identity.email &&
    identity.identityToken &&
    await verifyWpIdentityToken(identity.identityToken, identity.email)
  ) {
    callerEmail = identity.email.trim().toLowerCase();
  }

  if (!callerEmail) {
    throw new Error("Please sign in again before managing a listing. WordPress sessions must be verified by the app.");
  }

  // This credential is server-only. Never move this request into browser code.
  // The partner portal may use the dedicated app bridge secret. Prefer the
  // shared WP social-session bridge secret when present, with the dedicated
  // partner/app bridge secret as a backwards-compatible fallback.
  // Keep the owner-listings bridge aligned with the WordPress plugin's
  // accepted secret names. WP_SOCIAL_SESSION_BRIDGE_SECRET is preferred,
  // while XPLORE_PWA_SESSION_SECRET and the legacy XPGP_APP_BRIDGE_SECRET
  // remain valid fallbacks during the migration.
  const secret =
    process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim() ||
    process.env.XPLORE_PWA_SESSION_SECRET?.trim() ||
    process.env.XPGP_APP_BRIDGE_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Owner listing integration is not configured on the server. Set WP_SOCIAL_SESSION_BRIDGE_SECRET (or XPLORE_PWA_SESSION_SECRET) in the Partner Portal environment.",
    );
  }

  const response = await wordpressRequest(
    path,
    method,
    {
      Accept: "application/json",
      // Use the same server-to-server credential format as the existing
      // WordPress booking/session bridge. Keep the legacy X-* headers too for
      // compatibility with existing Xplore Pondy REST endpoints.
      Authorization: `Bearer ${secret}`,
      "X-Xplore-PWA-Secret": secret,
      "X-Xplore-PWA-User-Email": callerEmail,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body === undefined ? undefined : JSON.stringify(body),
  );

  const text = await response.text();
  let result: unknown;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("WordPress returned an unreadable response for owner listings.");
  }

  if (!response.ok) {
    const message =
      result && typeof result === "object" && "message" in result && typeof result.message === "string"
        ? result.message
        : `Owner listing request failed (${response.status}).`;
    throw new Error(message);
  }

  return result;
}

export const fetchOwnerListings = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema)
  .handler(async ({ data }) => {
    const owned = await ownerRequest(`${OWNER_LISTINGS_BASE}/listings`, "GET", undefined, data);

    // Listing Moderators are not owners. Merge their explicitly assigned
    // status-publishing listings into the common listing source used by the
    // status manager and other partner features. Keep a graceful fallback
    // until the WordPress moderator endpoint is deployed.
    try {
      const moderated = await ownerRequest(`${OWNER_LISTINGS_BASE}/moderators/listings`, "GET", undefined, data) as {
        items?: Array<{ id?: number; title?: string; modified?: string; slug?: string; url?: string }>;
      };
      const ownedItems = Array.isArray((owned as { items?: unknown[] })?.items)
        ? (owned as { items: Array<{ id?: number; title?: string; modified?: string; slug?: string; url?: string }> }).items
        : [];
      const moderatorItems = Array.isArray(moderated?.items) ? moderated.items : [];
      const byId = new Map<number, Record<string, unknown>>();
      for (const item of [...ownedItems, ...moderatorItems]) {
        const id = Number(item.id ?? 0);
        const title = String(item.title ?? "").trim();
        if (Number.isSafeInteger(id) && id > 0 && title) byId.set(id, { ...item, id, title });
      }
      return { ...(owned as Record<string, unknown>), items: [...byId.values()] };
    } catch {
      return owned;
    }
  });

export const fetchOwnerListingFormSchema = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema)
  .handler(async ({ data }) => ownerRequest(`${OWNER_LISTINGS_BASE}/listing-form-schema`, "GET", undefined, data));

export const createOwnerListingSubmission = createServerFn({ method: "POST" })
  .inputValidator((input: OwnerSubmission & OwnerIdentity) => createSubmissionSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, ...submission } = data;
    return ownerRequest(`${OWNER_LISTINGS_BASE}/listings`, "POST", submission, { email, identityToken });
  });

export const submitOwnerListingEdit = createServerFn({ method: "POST" })
  .inputValidator((input: OwnerSubmission & { listingId: number } & OwnerIdentity) => editSubmissionSchema.parse(input))
  .handler(async ({ data }) => {
    const { listingId, email, identityToken, ...submission } = data;
    return ownerRequest(`${OWNER_LISTINGS_BASE}/listings/${listingId}/edit-submission`, "POST", submission, { email, identityToken });
  });

export const uploadOwnerListingImage = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof imageUploadSchema>) => imageUploadSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, ...upload } = data;
    return ownerRequest("/wp-json/xplore/v1/owner/media", "POST", upload, { email, identityToken });
  });


const adminListingsSchema = ownerIdentitySchema.extend({
  page: z.number().int().positive().optional().default(1),
  perPage: z.number().int().positive().max(100).optional().default(100),
});

async function attachCanonicalAppViewCounts<T extends { id?: number; app_view_count?: number }>(
  payload: { items?: T[]; [key: string]: unknown },
) {
  const items = payload.items;
  if (!items?.length) return payload;

  const ids = [...new Set(items.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return payload;

  try {
    // The public WordPress REST field reads the canonical _xplore_view_count
    // post meta used by the app tracking endpoint. The admin listing endpoint
    // can return an older/inconsistent app_view_count value, so use this source
    // to keep admin and owner dashboards in sync.
    const response = await wordpressRequest(
      `/wp-json/wp/v2/listing?include=${ids.join(",")}&per_page=${Math.min(ids.length, 100)}&_fields=id,xplore_view_count`,
      "GET",
      { Accept: "application/json" },
    );
    if (!response.ok) return payload;
    const rows = await response.json() as Array<{ id: number; xplore_view_count?: number }>;
    const counts = new Map(rows.map((row) => [Number(row.id), Math.max(0, Number(row.xplore_view_count ?? 0) || 0)]));
    return {
      ...payload,
      items: items.map((item) => {
        const id = Number(item.id);
        return counts.has(id) ? { ...item, app_view_count: counts.get(id)! } : item;
      }),
    };
  } catch {
    // Preserve the admin endpoint result if the public REST field is unavailable.
    return payload;
  }
}

const partnerAdSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(180),
  image_url: z.string().trim().url().max(2000),
  ad_type: z.string().trim().max(80).optional().or(z.literal("")),
  target_url: z.string().trim().url().max(2000).optional().or(z.literal("")),
  link_type: z.string().trim().max(80).optional().or(z.literal("")),
  custom_url: z.string().trim().url().max(2000).optional().or(z.literal("")),
  position: z.enum(["homepage_top", "explore_top", "listing_loop_between", "sidebar_top", "sidebar_bottom", "sidebar_map_top", "homepage_sub"]),
  positions: z.array(z.enum(["homepage_top", "explore_top", "listing_loop_between", "sidebar_top", "sidebar_bottom", "sidebar_map_top", "homepage_sub"])).min(1).optional(),
  listing_id: z.number().int().positive().optional(),
  listing_ids: z.array(z.number().int().positive()).optional(),
  start_date: z.string().trim().max(80).optional().or(z.literal("")),
  end_date: z.string().trim().max(80).optional().or(z.literal("")),
  status: z.enum(["publish", "draft", "pending"]).optional(),
  sponsored_ad: z.boolean().optional().default(false),
  sponsored_ad_expiry: z.string().trim().max(80).optional().or(z.literal("")),
  max_views: z.number().int().min(0).optional().default(0),
  max_clicks: z.number().int().min(0).optional().default(0),
}).extend(ownerIdentitySchema.shape);

export type PartnerAd = {
  id: number;
  title: string;
  status: string;
  post_status: string;
  image_url: string;
  target_url: string;
  ad_type: string;
  link_type: string;
  custom_url: string;
  position: string;
  positions: string[];
  user_id: number;
  listing_id: number;
  listing_ids: number[];
  listing_titles?: Array<{ id: number; title: string }>;
  start_date: string;
  end_date: string;
  sponsored_ad: boolean;
  sponsored_ad_expiry: string;
  max_views: number;
  max_clicks: number;
  views: number;
  clicks: number;
  ctr: number;
  created_at: string;
};

export const fetchPartnerAdListings = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema.extend({
    search: z.string().trim().max(120).optional().default(""),
    page: z.number().int().positive().optional().default(1),
    perPage: z.number().int().positive().max(100).optional().default(30),
  }))
  .handler(async ({ data }) => {
    const { email, identityToken, search, page, perPage } = data;
    const params = new URLSearchParams({
      search,
      page: String(page),
      per_page: String(perPage),
    });
    return ownerRequest(
      `/wp-json/xplore/v1/partner/ad-listings?${params.toString()}`,
      "GET",
      undefined,
      { email, identityToken },
    );
  });

export const fetchPartnerAds = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema.extend({
    page: z.number().int().positive().optional().default(1),
    perPage: z.number().int().positive().max(100).optional().default(20),
  }))
  .handler(async ({ data }) => {
    const { email, identityToken, page, perPage } = data;
    return ownerRequest(
      `/wp-json/xplore/v1/partner/ads?page=${page}&per_page=${perPage}`,
      "GET",
      undefined,
      { email, identityToken },
    );
  });

export const createPartnerAd = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof partnerAdSchema>) => partnerAdSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, ...ad } = data;
    return ownerRequest("/wp-json/xplore/v1/partner/ads", "POST", ad, { email, identityToken });
  });

const partnerAdImageUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(12_000_000),
}).extend(ownerIdentitySchema.shape);

export const uploadPartnerAdImage = createServerFn({ method: "POST" })
  .inputValidator(partnerAdImageUploadSchema)
  .handler(async ({ data }) => {
    const { email, identityToken, ...upload } = data;
    return ownerRequest("/wp-json/xplore/v1/partner/ads/media", "POST", upload, { email, identityToken });
  });

export const updatePartnerAd = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof partnerAdSchema> & { id: number }) => partnerAdSchema.extend({ id: z.number().int().positive() }).parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, id, ...ad } = data;
    return ownerRequest(`/wp-json/xplore/v1/partner/ads/${id}`, "POST", ad, { email, identityToken });
  });


export const fetchAdminListingDetail = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema.extend({ listingId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const { listingId, email, identityToken } = data;
    // Fetch the individual public listing record server-side so the edit form
    // gets its content, registered meta fields, and taxonomy terms—not only
    // the summary fields returned by the paginated administrator directory.
    return ownerRequest(
      `/wp-json/wp/v2/listing/${listingId}?_embed=1`,
      "GET",
      undefined,
      { email, identityToken },
    );
  });

export const searchAdminListings = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema.extend({
    search: z.string().trim().min(1).max(120),
  }))
  .handler(async ({ data }) => {
    const { search, email, identityToken } = data;
    const query = encodeURIComponent(search.trim());
    // Search the WordPress listing index server-side instead of filtering the
    // single 10-row admin page currently loaded in the browser. This keeps the
    // normal dashboard lightweight while allowing administrators to find any
    // listing in the catalogue.
    const payload = await ownerRequest(
      `/wp-json/wp/v2/listing?search=${query}&per_page=10&_embed=1`,
      "GET",
      undefined,
      { email, identityToken },
    ) as Array<Record<string, unknown>>;

    return {
      items: payload.map((item) => ({
        id: Number(item.id),
        title: typeof item.title === "object" && item.title && "rendered" in item.title
          ? String((item.title as { rendered?: unknown }).rendered ?? `Listing #${item.id}`)
          : String(item.title ?? `Listing #${item.id}`),
        status: String(item.status ?? "publish"),
        url: typeof item.link === "string" ? item.link : undefined,
        featured_image: undefined,
      })),
      total: payload.length,
    };
  });

export const fetchAdminListings = createServerFn({ method: "GET" })
  .validator(adminListingsSchema)
  .handler(async ({ data }) => {
    const { email, identityToken, page, perPage } = data;
    const payload = await ownerRequest(
      `/wp-json/xplore/v1/admin/listings?page=${page}&per_page=${perPage}`,
      "GET",
      undefined,
      { email, identityToken },
    ) as { items?: Array<{ id?: number; app_view_count?: number }>; [key: string]: unknown };
    const withViews = await attachCanonicalAppViewCounts(payload);
    const items = (withViews as { items?: Array<Record<string, unknown>> }).items ?? [];
    if (!items.length) return withViews;

    // The reservation plugin stores its authoritative enabled flag in its own
    // table (xp_table_settings), not listing post meta. Ask the plugin for these
    // flags through a narrow admin-only endpoint. Do not infer enabled state
    // from historical bookings or opening-hour metadata.
    const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
    if (!secret) return { ...withViews, items: items.map((item) => ({ ...item, table_reservation_enabled: false })) };
    try {
      const validIds = items.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
      const enabled = new Map<number, boolean>();
      // Endpoint limits each call to 100 IDs. Admin listings are paginated by
      // 100 already, so this is typically one request per page.
      for (let offset = 0; offset < validIds.length; offset += 100) {
        const batch = validIds.slice(offset, offset + 100);
        const response = await wordpressRequest(
          `/wp-json/xplore/v1/table-reservations/admin/enabled-listings?ids=${batch.join(",")}`,
          "GET",
          {
            Accept: "application/json",
            "X-Xplore-PWA-Secret": secret,
            Authorization: `Bearer ${secret}`,
          },
        );
        if (!response.ok) throw new Error(`Reservation settings lookup failed (HTTP ${response.status}).`);
        const result = await response.json() as { items?: Array<{ listing_id: number; enabled: boolean }> };
        for (const item of result.items ?? []) enabled.set(Number(item.listing_id), Boolean(item.enabled));
      }
      return {
        ...withViews,
        items: items.map((item) => ({
          ...item,
          table_reservation_enabled: enabled.get(Number(item.id)) ?? false,
        })),
      };
    } catch (error) {
      console.warn("[admin-listings] Could not load table reservation flags", error);
      // Mark as unknown instead of silently hiding everything when backend
      // status fails. The frontend keeps filter disabled only if false.
      return {
        ...withViews,
        items: items.map((item) => ({ ...item, table_reservation_enabled: false })),
        table_reservation_error: error instanceof Error ? error.message : "Could not load reservation settings.",
      };
    }
  });

const assignAdminListingSchema = ownerIdentitySchema.extend({
  listingId: z.number().int().positive(),
  userEmail: z.string().trim().email(),
});

export const assignAdminListing = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof assignAdminListingSchema>) => assignAdminListingSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, listingId, userEmail } = data;
    return ownerRequest("/wp-json/xplore/v1/admin/assign-listing", "POST", { listing_id: listingId, user_email: userEmail }, { email, identityToken });
  });

export const fetchAdminListingClaims = createServerFn({ method: "GET" })
  .validator(ownerIdentitySchema)
  .handler(async ({ data }) => ownerRequest("/wp-json/xplore/v1/admin/claims", "GET", undefined, data));

export const approveAdminListingClaim = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof assignAdminListingSchema>) => assignAdminListingSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, listingId, userEmail } = data;
    return ownerRequest("/wp-json/xplore/v1/admin/claims/approve", "POST", { listing_id: listingId, user_email: userEmail }, { email, identityToken });
  });
