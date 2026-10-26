import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/verify.server";
import { verifyWpIdentityToken } from "@/lib/wp-identity-token.server";

const WP_ORIGIN = (process.env.XPLORE_WORDPRESS_URL || "https://xplorepondy.com").replace(/\/$/, "");
const OWNER_LISTINGS_BASE = "/wp-json/xplore/v1/owner";
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
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret) {
    throw new Error("Owner listing integration is not configured on the server.");
  }

  const response = await fetch(`${WP_ORIGIN}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "X-Xplore-PWA-Secret": secret,
      "X-Xplore-PWA-User-Email": callerEmail,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    redirect: "error",
  });

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
  .handler(async ({ data }) => ownerRequest(`${OWNER_LISTINGS_BASE}/listings`, "GET", undefined, data));

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
