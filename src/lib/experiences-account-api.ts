import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/verify.server";

const WP_ORIGIN = "https://xplorepondy.com";

export type ExperienceTerm = { id: number; name: string; slug: string };
export type ExperienceAccountItem = { id: number; title: string; slug: string; status: string; excerpt: string; modified: string; url: string; image: string };
export type ExperienceImage = { id: number; url: string; thumbnail: string; alt: string };
export type ExperienceDraft = {
  id: number; title: string; content: string; excerpt: string; status: string;
  category_id: number; location_id: number; featured_image: string; gallery_images: ExperienceImage[];
  fields: Record<string, unknown>; availability: Record<string, Array<{time: string; capacity: number; price?: number}>>;
};

async function verifyExperienceIdentity(email: string, identityToken?: string) {
  const session = await getSessionUser();
  const sessionEmail = String(session?.email ?? "").trim().toLowerCase();
  const normalized = email.trim().toLowerCase();
  if (sessionEmail && sessionEmail === normalized) return;
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret || !identityToken || identityToken.length > 4096) throw new Error("Please sign in again to manage your experiences.");
  const [payloadPart, signature, extra] = identityToken.split(".");
  if (!payloadPart || !signature || extra !== undefined || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error("Your experience account session could not be verified. Please sign in again.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sigBytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payloadPart))) throw new Error("Your experience account session could not be verified. Please sign in again.");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as { email?: unknown; exp?: unknown; userId?: unknown };
  if (typeof payload.email !== "string" || payload.email.trim().toLowerCase() !== normalized || !Number.isInteger(payload.exp) || Number(payload.exp) <= Math.floor(Date.now() / 1000) || !Number.isInteger(payload.userId)) throw new Error("Your experience account session has expired. Please sign in again.");
}

async function experienceAccountRequest<T>(path: string, email: string, identityToken?: string, init?: RequestInit): Promise<T> {
  await verifyExperienceIdentity(email, identityToken);
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("The WordPress experience account bridge is not configured.");
  const url = new URL("/wp-json/xpe/v1/account/" + path, WP_ORIGIN);
  if (init?.method !== "POST" && init?.method !== "PATCH" && init?.method !== "PUT") url.searchParams.set("email", email.trim().toLowerCase());
  const response = await fetch(url.toString(), {
    ...init, cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json", "X-Xplore-PWA-Secret": secret, ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not access your experience account.");
  return payload as T;
}

const identitySchema = z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() });

export const fetchExperienceCategories = createServerFn({ method: "GET" })
  .validator(identitySchema)
  .handler(async ({ data }) => experienceAccountRequest<ExperienceTerm[]>("categories", data.email, data.identityToken));

export const fetchExperienceLocations = createServerFn({ method: "GET" })
  .validator(identitySchema)
  .handler(async ({ data }) => experienceAccountRequest<ExperienceTerm[]>("locations", data.email, data.identityToken));

export type ExperienceBookingTicket = {
  type: "experience"; booking_id: number; reference: string; token: string; title: string; slug: string;
  date: string; time: string; venue: string; attendee: string; quantity: number; checked_in: boolean; checked_in_at: string;
};
export type ExperienceTicketCheckInResult = {
  success: boolean; type: "experience"; booking_id: number; reference: string; title: string;
  attendee: string; quantity: number; checked_in_at: string;
};
async function experienceBookingRequest<T>(path: string, email: string, identityToken?: string, init?: RequestInit): Promise<T> {
  await verifyExperienceIdentity(email, identityToken);
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("The WordPress experience booking bridge is not configured.");
  const url = new URL("/wp-json/xpe/v1/" + path, WP_ORIGIN);
  if (init?.method !== "POST") url.searchParams.set("email", email.trim().toLowerCase());
  const response = await fetch(url.toString(), {
    ...init, cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json", "X-Xplore-PWA-Secret": secret, ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not access your experience booking.");
  return payload as T;
}
export const fetchMyExperienceTicket = createServerFn({ method: "GET" })
  .validator(identitySchema.extend({ bookingId: z.number().int().positive() }))
  .handler(async ({ data }) => experienceBookingRequest<ExperienceBookingTicket>(`booking-requests/mine/${data.bookingId}/ticket`, data.email, data.identityToken));
export const checkInOwnerExperienceTicket = createServerFn({ method: "POST" })
  .validator(identitySchema.extend({ token: z.string().min(10).max(200) }))
  .handler(async ({ data }) => experienceBookingRequest<ExperienceTicketCheckInResult>("booking-requests/owner-check-in", data.email, data.identityToken, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), token: data.token }),
  }));

export const fetchMyExperiences = createServerFn({ method: "GET" })
  .validator(identitySchema)
  .handler(async ({ data }) => experienceAccountRequest<ExperienceAccountItem[]>("mine", data.email, data.identityToken));

export const fetchExperienceForEdit = createServerFn({ method: "GET" })
  .validator(identitySchema.extend({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const result = await experienceAccountRequest<ExperienceDraft>(`experiences/${data.id}`, data.email, data.identityToken);
    const fields = { ...result.fields };
    for (const key of ["highlights", "includes", "excludes", "important_info", "faqs"]) {
      if (Array.isArray(fields[key])) fields[key] = (fields[key] as unknown[]).map(String).join("\n");
    }
    if (Array.isArray(fields.itinerary_json)) fields.itinerary_json = JSON.stringify(fields.itinerary_json, null, 2);
    return { ...result, fields };
  });

const experiencePayloadSchema = z.object({
  title: z.string().trim().min(1).max(180),
  content: z.string().trim().min(1).max(30000),
  excerpt: z.string().max(500).default(""),
  category_id: z.number().int().nonnegative(),
  location_id: z.number().int().nonnegative(),
  fields: z.record(z.string(), z.unknown()),
  availability: z.record(z.string(), z.array(z.object({ time: z.string(), capacity: z.number().int().positive(), price: z.number().nonnegative().optional() }))).default({}),
  cover_image_data: z.string().max(4200000).optional(),
  cover_image_name: z.string().max(200).optional(),
  gallery_images: z.array(z.object({ data: z.string().max(4200000), name: z.string().max(200) })).max(8).optional(),
});

export const submitExperienceFromApp = createServerFn({ method: "POST" })
  .validator(identitySchema.extend({ experience: experiencePayloadSchema }))
  .handler(async ({ data }) => experienceAccountRequest<{ok: boolean; id: number; status: string; message: string}>(
    "submit", data.email, data.identityToken,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), ...data.experience }) },
  ));

export const updateExperienceFromApp = createServerFn({ method: "POST" })
  .validator(identitySchema.extend({ id: z.number().int().positive(), experience: experiencePayloadSchema }))
  .handler(async ({ data }) => experienceAccountRequest<{ok: boolean; id: number; status: string; message: string}>(
    `experiences/${data.id}/edit`, data.email, data.identityToken,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), ...data.experience }) },
  ));
