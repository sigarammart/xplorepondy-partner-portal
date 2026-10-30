import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/verify.server";
import { verifyWpIdentityToken } from "@/lib/wp-identity-token.server";

const WP_ORIGIN = (process.env.XPLORE_WORDPRESS_URL || "https://xplorepondy.com").replace(/\/$/, "");
const identitySchema = z.object({
  email: z.string().trim().email().optional(),
  identityToken: z.string().max(4096).optional(),
});
async function statusRequest(path: string, method: "GET" | "POST", body?: unknown, identity: z.infer<typeof identitySchema> = {}) {
  const user = await getSessionUser();
  let email = user?.email?.trim().toLowerCase() ?? "";
  if (!email && identity.email && identity.identityToken && await verifyWpIdentityToken(identity.identityToken, identity.email)) {
    email = identity.email.trim().toLowerCase();
  }
  if (!email) throw new Error("Please sign in again before managing your status.");
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("Status publishing is not configured on the server.");
  const response = await fetch(`${WP_ORIGIN}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "X-Xplore-PWA-Secret": secret,
      "X-Xplore-PWA-User-Email": email,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let payload: unknown;
  try { payload = raw ? JSON.parse(raw) : null; } catch { throw new Error("WordPress returned an unreadable status response."); }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message : `Status request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export type OwnerStatus = {
  id: number; listing_id: number; listing_name: string; media_url: string;
  thumbnail_url: string; media_type: "image" | "video"; caption: string;
  created_at: string; expires_at: string; views: number; cta_type: string;
};

export const fetchOwnerStatuses = createServerFn({ method: "GET" })
  .validator(identitySchema)
  .handler(async ({ data }) => {
    const result = await statusRequest("/wp-json/xplore/v1/statuses/owner", "GET", undefined, data) as { statuses?: OwnerStatus[] };
    return Array.isArray(result.statuses) ? result.statuses : [];
  });

const publishSchema = identitySchema.extend({
  listingId: z.number().int().positive(),
  fileName: z.string().min(1).max(180),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]),
  base64: z.string().min(1).max(14000000),
  caption: z.string().max(500).optional().default(""),
  ctaType: z.enum(["listing", "directions", "call"]).default("listing"),
});
export const publishOwnerStatus = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof publishSchema>) => publishSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, identityToken, listingId, fileName, mimeType, base64, caption, ctaType } = data;
    return statusRequest("/wp-json/xplore/v1/statuses/owner-upload", "POST", {
      listing_id: listingId, file_name: fileName, mime_type: mimeType,
      base64, caption, cta_type: ctaType,
    }, { email, identityToken });
  });
