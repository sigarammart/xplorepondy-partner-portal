/**
 * The identity providers this app offers for sign-in.
 *
 * Source of truth for the client sign-in buttons. Kept in its own dependency-free
 * module so the client can import it without pulling the server-only Better Auth
 * instance (and `pg`) into the browser bundle.
 *
 * Google uses Better Auth's native Google provider and the app's Google OAuth
 * credentials. X continues to use the shared Grok auth broker.
 *
 */
export type AuthProvider = {
  /** Better Auth provider id used by the sign-in client. */
  providerId: string;
  /** Human label for the sign-in button. */
  label: string;
};

export const GROK_PROVIDERS: readonly AuthProvider[] = [
  { providerId: "google", label: "Google" },
  { providerId: "grok-x", label: "X" },
];
