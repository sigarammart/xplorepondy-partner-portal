import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/verify.server";
import { verifyWpIdentityToken } from "@/lib/wp-identity-token.server";
import { wpFetch } from "@/lib/wp-http.server";

const WP_ORIGIN = (process.env.XPLORE_WORDPRESS_URL || "https://xplorepondy.com").replace(/\/$/, "");

const identitySchema = z.object({
  email: z.string().trim().email().optional(),
  identityToken: z.string().max(4096).optional(),
});

const moderatorSchema = identitySchema.extend({
  listingId: z.number().int().positive(),
  userEmail: z.string().trim().email(),
});

async function moderatorRequest(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  identity: z.infer<typeof identitySchema> = {},
) {
  const user = await getSessionUser();
  let email = user?.email?.trim().toLowerCase() ?? "";

  if (!email && identity.email && identity.identityToken && await verifyWpIdentityToken(identity.identityToken, identity.email)) {
    email = identity.email.trim().toLowerCase();
  }
  if (!email) throw new Error("Please sign in again before managing Listing Moderators.");

  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("Listing Moderator management is not configured on the server.");

  const response = await wpFetch(`${WP_ORIGIN}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Xplore-PWA-Secret": secret,
      "X-Xplore-PWA-User-Email": email,
      Authorization: `Bearer ${secret}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });

  const raw = await response.text();
  let payload: unknown = null;
  try { payload = raw ? JSON.parse(raw) : null; }
  catch { throw new Error("WordPress returned an unreadable Listing Moderator response."); }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `Listing Moderator request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export type ListingModerator = {
  id: number;
  listing_id: number;
  listing_title: string;
  user_id?: number;
  user_email: string;
  user_name: string;
  permission: "status_publish";
  status: "active" | "pending" | "revoked";
};

export const fetchListingModerators = createServerFn({ method: "GET" })
  .validator(identitySchema)
  .handler(async ({ data }) => moderatorRequest("/wp-json/xplore/v1/owner/moderators", "GET", undefined, data));

export const addListingModerator = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof moderatorSchema>) => moderatorSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, listingId, userEmail } = data;
    return moderatorRequest(
      "/wp-json/xplore/v1/owner/moderators",
      "POST",
      { action: "add", listing_id: listingId, user_email: userEmail, permission: "status_publish" },
      { email, identityToken },
    );
  });

export const removeListingModerator = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof moderatorSchema>) => moderatorSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, listingId, userEmail } = data;
    return moderatorRequest(
      "/wp-json/xplore/v1/owner/moderators",
      "POST",
      { action: "remove", listing_id: listingId, user_email: userEmail },
      { email, identityToken },
    );
  });
