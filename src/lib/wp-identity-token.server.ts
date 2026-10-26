/**
 * Server-only HMAC identity tokens for verified WordPress-password sessions.
 * These tokens are signed by the PWA server and must never be minted in the browser.
 */
const WP_IDENTITY_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 14;

export async function signWpIdentityToken(email: string, userId: number): Promise<string | undefined> {
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret || !email || !Number.isInteger(userId) || userId <= 0) return undefined;
  const payload = Buffer.from(JSON.stringify({
    email: email.trim().toLowerCase(),
    userId,
    exp: Math.floor(Date.now() / 1000) + WP_IDENTITY_COOKIE_TTL_SECONDS,
  })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const signature = Array.from(signatureBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return payload + "." + signature;
}

export async function verifyWpIdentityToken(token: string | undefined, email: string): Promise<boolean> {
  const secret = process.env.WP_SOCIAL_SESSION_BRIDGE_SECRET?.trim();
  if (!secret || !token || token.length > 4096) return false;
  const [payloadPart, signature, extra] = token.split(".");
  if (!payloadPart || !signature || extra !== undefined || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signatureBytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
    if (!await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payloadPart))) return false;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      email?: unknown; userId?: unknown; exp?: unknown;
    };
    return typeof payload.email === "string"
      && payload.email.trim().toLowerCase() === email.trim().toLowerCase()
      && Number.isInteger(payload.userId) && Number(payload.userId) > 0
      && Number.isInteger(payload.exp) && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
