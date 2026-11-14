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

const vehicleSchema = identitySchema.extend({
  vehicleId: z.number().int().positive().optional(),
  vehicleType: z.enum(["bike", "car"]),
  brand: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(120),
  variant: z.string().trim().max(120).optional(),
  registrationYear: z.number().int().min(1900).max(2100).nullable().optional(),
  fuelType: z.string().trim().max(30).optional(),
  transmission: z.string().trim().max(30).optional(),
  engineCc: z.number().int().min(0).nullable().optional(),
  seatingCapacity: z.number().int().min(1).max(99).nullable().optional(),
  hasAc: z.boolean().optional(),
  helmetsIncluded: z.boolean().optional(),
  description: z.string().max(5000).optional(),
  pricePerHour: z.number().min(0).nullable().optional(),
  pricePerDay: z.number().min(0),
  pricePerWeek: z.number().min(0).nullable().optional(),
  securityDeposit: z.number().min(0).optional(),
  minimumDurationHours: z.number().int().min(1).max(720).optional(),
  pickupLocation: z.string().trim().max(255).optional(),
  deliveryAvailable: z.boolean().optional(),
  deliveryCharge: z.number().min(0).optional(),
  featuredImageUrl: z.string().url().max(2000).or(z.literal("")).optional(),
  gallery: z.array(z.string().url().max(2000)).max(20).optional(),
});

export type RentalVehicle = {
  id: number;
  vehicle_type: "bike" | "car";
  brand: string;
  model: string;
  variant: string;
  registration_year: number | null;
  fuel_type: string;
  transmission: string;
  engine_cc: number | null;
  seating_capacity: number | null;
  has_ac: boolean;
  helmets_included: boolean;
  description: string;
  price_per_hour: number | null;
  price_per_day: number;
  price_per_week: number | null;
  security_deposit: number;
  minimum_duration_hours: number;
  pickup_location: string;
  delivery_available: boolean;
  delivery_charge: number;
  featured_image_url: string;
  gallery: string[];
  status: "draft" | "active" | "inactive";
  owner_user_id?: number;
  listing_id?: number | null;
  created_at?: string;
  updated_at?: string;
};

async function rentalRequest(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", identity: z.infer<typeof identitySchema>, body?: unknown) {
  const user = await getSessionUser();
  let email = user?.email?.trim().toLowerCase() ?? "";
  if (!email && identity.email && identity.identityToken && await verifyWpIdentityToken(identity.identityToken, identity.email)) {
    email = identity.email.trim().toLowerCase();
  }
  if (!email) throw new Error("Please sign in again before managing rental vehicles.");

  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) throw new Error("Rental management is not configured on the server.");

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
  try { payload = raw ? JSON.parse(raw) : null; } catch { throw new Error("WordPress returned an unreadable rental response."); }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message : `Rental request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

function vehicleBody(data: z.infer<typeof vehicleSchema>) {
  return {
    vehicle_type: data.vehicleType,
    brand: data.brand,
    model: data.model,
    variant: data.variant ?? "",
    registration_year: data.registrationYear ?? null,
    fuel_type: data.fuelType ?? "",
    transmission: data.transmission ?? "",
    engine_cc: data.engineCc ?? null,
    seating_capacity: data.seatingCapacity ?? null,
    has_ac: data.hasAc ?? false,
    helmets_included: data.helmetsIncluded ?? false,
    description: data.description ?? "",
    price_per_hour: data.pricePerHour ?? null,
    price_per_day: data.pricePerDay,
    price_per_week: data.pricePerWeek ?? null,
    security_deposit: data.securityDeposit ?? 0,
    minimum_duration_hours: data.minimumDurationHours ?? 24,
    pickup_location: data.pickupLocation ?? "",
    delivery_available: data.deliveryAvailable ?? false,
    delivery_charge: data.deliveryCharge ?? 0,
    featured_image_url: data.featuredImageUrl ?? "",
    gallery: data.gallery ?? [],
  };
}

export const fetchRentalVehicles = createServerFn({ method: "GET" })
  .validator(identitySchema)
  .handler(async ({ data }) => rentalRequest("/wp-json/xplore-rentals/v1/partner/vehicles?per_page=100", "GET", data));

export const createRentalVehicle = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof vehicleSchema>) => vehicleSchema.parse(input))
  .handler(async ({ data }) => rentalRequest("/wp-json/xplore-rentals/v1/partner/vehicles", "POST", data, vehicleBody(data)));

export const updateRentalVehicle = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof vehicleSchema>) => vehicleSchema.extend({ vehicleId: z.number().int().positive() }).parse(input))
  .handler(async ({ data }) => rentalRequest(`/wp-json/xplore-rentals/v1/partner/vehicles/${data.vehicleId}`, "PATCH", data, vehicleBody(data)));

export const deleteRentalVehicle = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof identitySchema> & { vehicleId: number }) => z.object({ ...identitySchema.shape, vehicleId: z.number().int().positive() }).parse(input))
  .handler(async ({ data }) => rentalRequest(`/wp-json/xplore-rentals/v1/partner/vehicles/${data.vehicleId}`, "DELETE", data));

export type RentalMediaItem = {
  id: number;
  url: string;
  thumbnail_url: string;
  title: string;
  mime_type: string;
};

const rentalMediaUploadSchema = identitySchema.extend({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(12 * 1024 * 1024),
});

export const fetchRentalMedia = createServerFn({ method: "GET" })
  .validator(identitySchema.extend({
    search: z.string().trim().max(100).optional(),
  }))
  .handler(async ({ data }) => {
    const query = data.search ? `&search=${encodeURIComponent(data.search)}` : "";
    return rentalRequest(`/wp-json/xplore-rentals/v1/partner/media?per_page=40${query}`, "GET", data);
  });

export const uploadRentalMedia = createServerFn({ method: "POST" })
  .inputValidator((input: z.infer<typeof rentalMediaUploadSchema>) => rentalMediaUploadSchema.parse(input))
  .handler(async ({ data }) => rentalRequest(
    "/wp-json/xplore-rentals/v1/partner/media",
    "POST",
    data,
    { filename: data.filename, mime_type: data.mimeType, base64: data.base64 },
  ));
