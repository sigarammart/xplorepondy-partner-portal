import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/verify.server";

const WP_ORIGIN = "https://xplorepondy.com";

export type XploreEvent = {
  id: number;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  url: string;
  image: string;
  eventGallery: { id: number; url: string; thumbnail: string; alt: string }[];
  venueGallery: { id: number; url: string; thumbnail: string; alt: string }[];
  thingsToKnow: string[];
  termsAndConditions: string[];
  capacity: number;
  startDateTime: string;
  endDateTime: string;
  venueName: string;
  venueAddress: string;
  venueUrl: string;
  latitude?: number;
  longitude?: number;
  eventMode: string;
  ticketingMode: string;
  organizerName: string;
  categories: { id: number; name: string; slug: string }[];
  locations: { id: number; name: string; slug: string }[];
  ticketTypes: { id: string; name: string; price: number; currency: string; quantity: number; salesStart: string; salesEnd: string; minPerOrder: number; maxPerOrder: number }[];
  ticketSalesEnabled: boolean;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeEvent(raw: Record<string, unknown>): XploreEvent {
  const categories = Array.isArray(raw.categories) ? raw.categories.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const term = item as Record<string, unknown>;
    return [{ id: Number(term.id ?? 0), name: asText(term.name), slug: asText(term.slug) }];
  }) : [];
  const locations = Array.isArray(raw.locations) ? raw.locations.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const term = item as Record<string, unknown>;
    return [{ id: Number(term.id ?? 0), name: asText(term.name), slug: asText(term.slug) }];
  }) : [];
  const ticketTypes = Array.isArray(raw.ticket_types) ? raw.ticket_types.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const ticket = item as Record<string, unknown>;
    return [{
      id: asText(ticket.id),
      name: asText(ticket.name),
      price: Number(ticket.price ?? 0),
      currency: asText(ticket.currency) || "INR",
      quantity: Number(ticket.quantity ?? 0),
      salesStart: asText(ticket.sales_start),
      salesEnd: asText(ticket.sales_end),
      minPerOrder: Number(ticket.min_per_order ?? 1),
      maxPerOrder: Number(ticket.max_per_order ?? 10),
    }];
  }) : [];
  const normalizeGallery = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const image = item as Record<string, unknown>;
    const url = asText(image.url);
    if (!url) return [];
    return [{ id: Number(image.id ?? 0), url, thumbnail: asText(image.thumbnail) || url, alt: asText(image.alt) }];
  }) : [];
  const normalizeItems = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const latitude = Number(raw.venue_latitude);
  const longitude = Number(raw.venue_longitude);
  return {
    id: Number(raw.id ?? 0),
    slug: asText(raw.slug),
    title: asText(raw.title) || "Untitled event",
    description: asText(raw.description),
    excerpt: asText(raw.excerpt),
    url: asText(raw.url),
    image: asText(raw.featured_image),
    eventGallery: normalizeGallery(raw.event_gallery),
    venueGallery: normalizeGallery(raw.venue_gallery),
    thingsToKnow: normalizeItems(raw.things_to_know),
    termsAndConditions: normalizeItems(raw.terms_and_conditions),
    capacity: Number(raw.capacity ?? 0),
    startDateTime: asText(raw.start_datetime),
    endDateTime: asText(raw.end_datetime),
    venueName: asText(raw.venue_name),
    venueAddress: asText(raw.venue_address),
    venueUrl: asText(raw.venue_url),
    ...(Number.isFinite(latitude) && latitude !== 0 ? { latitude } : {}),
    ...(Number.isFinite(longitude) && longitude !== 0 ? { longitude } : {}),
    eventMode: asText(raw.event_mode),
    ticketingMode: asText(raw.ticketing_mode),
    organizerName: asText(raw.organizer_name),
    categories,
    locations,
    ticketTypes,
    ticketSalesEnabled: raw.ticket_sales_enabled === true,
  };
}

export const fetchXploreEvents = createServerFn({ method: "GET" })
  .validator(z.object({
    search: z.string().trim().max(120).optional().default(""),
    slug: z.string().trim().max(200).optional(),
    upcoming: z.boolean().optional().default(true),
    page: z.number().int().min(1).max(100).optional().default(1),
  }))
  .handler(async ({ data }) => {
    const query = new URLSearchParams({
      per_page: "50",
      page: String(data.page),
      upcoming: String(data.upcoming),
    });
    if (data.slug) query.set("slug", data.slug);
    else if (data.search) query.set("search", data.search);
    const response = await fetch(`${WP_ORIGIN}/wp-json/xplore/v1/events?${query.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Events could not be loaded from Xplore Pondy.");
    const payload: unknown = await response.json();
    const items = Array.isArray(payload)
      ? payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map(normalizeEvent)
      : [];
    return {
      items,
      page: data.page,
      total: Number(response.headers.get("X-WP-Total") ?? items.length),
      totalPages: Number(response.headers.get("X-WP-TotalPages") ?? 1),
    };
  });


export type EventAccountItem = {
  id: number; title?: string; slug?: string; status?: string; url?: string; start_datetime?: string;
  venue_name?: string; booking_count?: number; reference?: string; event_id?: number; event_title?: string;
  event_url?: string; ticket_type?: string; quantity?: number; created_at?: string;
  attendee_name?: string; customer_name?: string; attendee_email?: string; customer_email?: string;
  attendee_phone?: string; customer_phone?: string; payment_status?: string; payment_method?: string;
};
export type EventInboxItem = {
  id: number; notification_type: string; title: string; body: string; url: string;
  event_id: number; event_start_datetime?: string; booking_id: number | null; read_at: string | null; created_at: string;
};

async function verifyEventAccountIdentity(email: string, identityToken?: string) {
  const session = await getSessionUser();
  const sessionEmail = String(session?.email ?? "").trim().toLowerCase();
  const normalized = email.trim().toLowerCase();
  if (sessionEmail && sessionEmail === normalized) return;
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret || !identityToken || identityToken.length > 4096) throw new Error("Please sign in again to access your event account.");
  const [payloadPart, signature, extra] = identityToken.split(".");
  if (!payloadPart || !signature || extra !== undefined || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error("Your event account session could not be verified. Please sign in again.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sigBytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payloadPart))) throw new Error("Your event account session could not be verified. Please sign in again.");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as { email?: unknown; exp?: unknown; userId?: unknown };
  if (typeof payload.email !== "string" || payload.email.trim().toLowerCase() !== normalized || !Number.isInteger(payload.exp) || Number(payload.exp) <= Math.floor(Date.now() / 1000) || !Number.isInteger(payload.userId)) throw new Error("Your event account session has expired. Please sign in again.");
}

async function eventAccountRequest<T>(path: string, email: string, identityToken?: string, init?: RequestInit): Promise<T> {
  await verifyEventAccountIdentity(email, identityToken);
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("The WordPress event account bridge is not configured.");
  const url = new URL("/wp-json/xplore/v1/event-account/" + path, WP_ORIGIN);
  if (init?.method !== "POST") url.searchParams.set("email", email.trim().toLowerCase());
  const response = await fetch(url.toString(), {
    ...init, cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { Accept: "application/json", "X-Xplore-PWA-Secret": secret, ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Could not load your event account.");
  return payload as T;
}

export const fetchMyEvents = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => eventAccountRequest<{ items: EventAccountItem[] }>("my-events", data.email, data.identityToken));

export type EventCategoryOption = { id: number; name: string; slug: string };
export type EventPlaceOption = { id: number; title: string; address: string; latitude: number | null; longitude: number | null; image: string };
export type NewEventPayload = {
  title: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  venue_name: string;
  venue_address: string;
  venue_listing_id: number;
  venue_latitude: number | null;
  venue_longitude: number | null;
  event_mode: "in_person" | "online" | "hybrid";
  ticketing_mode: "free" | "paid" | "external";
  category_id: number;
  capacity: number;
  organizer_name: string;
  organizer_email: string;
  organizer_phone: string;
  things_to_know: string;
  terms_and_conditions: string;
  ticket_types: { name: string; price: number; quantity: number; min_per_order: number; max_per_order: number }[];
  cover_image_data?: string;
  cover_image_name?: string;
  gallery_images?: { data: string; name: string }[];
};

export const fetchEventCategories = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => eventAccountRequest<{ items: EventCategoryOption[] }>("event-categories", data.email, data.identityToken));

export const searchEventPlaces = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), query: z.string().trim().min(2).max(120) }))
  .handler(async ({ data }) => {
    const path = `search-places?q=${encodeURIComponent(data.query)}`;
    return eventAccountRequest<{ items: EventPlaceOption[] }>(path, data.email, data.identityToken);
  });

const newEventSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(20000),
  start_datetime: z.string().min(16).max(20),
  end_datetime: z.string().min(16).max(20),
  venue_name: z.string().trim().min(1).max(180),
  venue_address: z.string().max(250),
  venue_listing_id: z.number().int().nonnegative(),
  venue_latitude: z.number().min(-90).max(90).nullable(),
  venue_longitude: z.number().min(-180).max(180).nullable(),
  event_mode: z.enum(["in_person", "online", "hybrid"]),
  ticketing_mode: z.enum(["free", "paid", "external"]),
  category_id: z.number().int().nonnegative(),
  capacity: z.number().int().min(0).max(1000000),
  organizer_name: z.string().trim().min(1).max(180),
  organizer_email: z.string().trim().email().max(254),
  organizer_phone: z.string().max(40),
  things_to_know: z.string().max(5000),
  terms_and_conditions: z.string().max(5000),
  ticket_types: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    price: z.number().min(0).max(10000000),
    quantity: z.number().int().min(1).max(1000000),
    min_per_order: z.number().int().min(1).max(100),
    max_per_order: z.number().int().min(1).max(100),
  })).min(1).max(20),
  cover_image_data: z.string().max(4200000).optional(),
  cover_image_name: z.string().max(200).optional(),
  gallery_images: z.array(z.object({ data: z.string().max(4200000), name: z.string().max(200) })).max(8).optional(),
});

export const submitEventFromApp = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), event: newEventSchema }))
  .handler(async ({ data }) => eventAccountRequest<{ ok: boolean; id: number; status: string; message: string }>(
    "submit", data.email, data.identityToken,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), ...data.event }) },
  ));

export type EditableTicket = { name: string; price: number; quantity: number; min_per_order: number; max_per_order: number };
export type EditableGalleryImage = { id: number; url: string; thumbnail: string; alt: string };
export type EditableEvent = {
  id: number; title: string; description: string; status: string;
  start_datetime: string; end_datetime: string; venue_name: string; venue_address: string;
  venue_listing_id: number; venue_latitude: number | null; venue_longitude: number | null;
  event_mode: "in_person" | "online" | "hybrid"; ticketing_mode: "free" | "paid" | "external";
  category_id: number; capacity: number; organizer_name: string; organizer_email: string; organizer_phone: string;
  things_to_know: string; terms_and_conditions: string; cover_image: string;
  gallery_images: EditableGalleryImage[]; ticket_types: EditableTicket[];
};

const eventEditFields = {
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(20000),
  start_datetime: z.string().min(16).max(20),
  end_datetime: z.string().min(16).max(20),
  venue_name: z.string().trim().min(1).max(180),
  venue_address: z.string().max(250),
  venue_listing_id: z.number().int().nonnegative(),
  venue_latitude: z.number().min(-90).max(90).nullable(),
  venue_longitude: z.number().min(-180).max(180).nullable(),
  event_mode: z.enum(["in_person", "online", "hybrid"]),
  ticketing_mode: z.enum(["free", "paid", "external"]),
  category_id: z.number().int().nonnegative(),
  capacity: z.number().int().min(0).max(1000000),
  organizer_name: z.string().trim().min(1).max(180),
  organizer_email: z.string().trim().email().max(254),
  organizer_phone: z.string().max(40),
  things_to_know: z.string().max(5000),
  terms_and_conditions: z.string().max(5000),
  ticket_types: z.array(z.object({ name: z.string().trim().min(1).max(100), price: z.number().min(0).max(10000000), quantity: z.number().int().min(1).max(1000000), min_per_order: z.number().int().min(1).max(100), max_per_order: z.number().int().min(1).max(100) })).min(1).max(20),
  cover_image_data: z.string().max(4200000).optional(),
  cover_image_name: z.string().max(200).optional(),
  gallery_images: z.array(z.object({ data: z.string().max(4200000), name: z.string().max(200) })).max(8).optional(),
};

export const fetchMyEventForEdit = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number().int().positive(), email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => eventAccountRequest<EditableEvent>(`my-events/${data.id}`, data.email, data.identityToken));

export const updateMyEvent = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive(), email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), event: z.object(eventEditFields) }))
  .handler(async ({ data }) => eventAccountRequest<{ ok: boolean; id: number; status: string; message: string }>(
    `my-events/${data.id}/edit`, data.email, data.identityToken,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.event) },
  ));

export type BookingTicket = {
  type: "event" | "experience"; booking_id: number; reference: string; token: string;
  title: string; slug?: string; date: string; time?: string; venue: string; attendee: string;
  ticket_type?: string; quantity: number; payment_status?: string; checked_in: boolean; checked_in_at: string;
};
export type TicketCheckInResult = {
  success: boolean; type: "event" | "experience"; booking_id: number; reference: string;
  title: string; attendee: string; quantity: number; checked_in_at: string;
};

export const fetchMyEventTicket = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), bookingId: z.number().int().positive() }))
  .handler(async ({ data }) => eventAccountRequest<BookingTicket>(`bookings/${data.bookingId}/ticket`, data.email, data.identityToken));

export const checkInOwnerEventTicket = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), token: z.string().min(10).max(200) }))
  .handler(async ({ data }) => eventAccountRequest<TicketCheckInResult>("owner/check-in", data.email, data.identityToken, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), token: data.token }),
  }));

export const fetchMyEventBookings = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => eventAccountRequest<{ items: EventAccountItem[] }>("bookings", data.email, data.identityToken));

export type EventOwnerBookingItem = {
  id: number; reference?: string; event_id?: number; event_title?: string; event_slug?: string; event_url?: string;
  start_datetime?: string; venue_name?: string; customer_name?: string; customer_email?: string;
  ticket_type?: string; quantity?: number; status?: string; payment_status?: string; checked_in?: boolean; checked_in_at?: string; created_at?: string;
};

export const fetchMyOwnedEventBookings = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => eventAccountRequest<{ items: EventOwnerBookingItem[] }>("owner-bookings", data.email, data.identityToken));

export const updateMyOwnedEventBookingStatus = createServerFn({ method: "POST" })
  .validator(z.object({
    email: z.string().trim().email(),
    identityToken: z.string().max(4096).optional(),
    bookingId: z.number().int().positive(),
    status: z.enum(["pending_payment", "confirmed", "cancelled"]),
  }))
  .handler(async ({ data }) => eventAccountRequest<{ success: boolean; booking_id: number; status: string }>(
    "owner-bookings/status", data.email, data.identityToken,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), booking_id: data.bookingId, status: data.status }) },
  ));

export const fetchEventInbox = createServerFn({ method: "GET" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional() }))
  .handler(async ({ data }) => eventAccountRequest<{ items: EventInboxItem[]; unread: number }>("notifications", data.email, data.identityToken));

export const markEventInboxRead = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().email(), identityToken: z.string().max(4096).optional(), ids: z.array(z.number().int().positive()).max(100) }))
  .handler(async ({ data }) => eventAccountRequest<{ ok: boolean; updated: number }>("notifications/read", data.email, data.identityToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.email.trim().toLowerCase(), ids: data.ids }) }));
