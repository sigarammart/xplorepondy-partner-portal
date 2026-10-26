type TextHit = { at: number; ok: boolean; status: number; body: string; total?: string; pages?: string };

const textCache = new Map<string, TextHit>();
const textOrder: string[] = [];
const inflight = new Map<string, Promise<TextHit>>();
const MAX_ENTRIES = 64;

function remember(key: string, hit: TextHit) {
  if (textCache.has(key)) {
    const i = textOrder.indexOf(key);
    if (i >= 0) textOrder.splice(i, 1);
  }
  textCache.set(key, hit);
  textOrder.push(key);
  while (textOrder.length > MAX_ENTRIES) {
    const old = textOrder.shift();
    if (old) textCache.delete(old);
  }
}

/** One in-flight request per URL. Fresh hits skip WordPress; stale hits are reused if WordPress fails. */
export async function cachedOriginText(
  url: string,
  ttlMs: number,
  timeoutMs: number,
  headers: HeadersInit = { Accept: "text/html,application/json" },
): Promise<TextHit> {
  const now = Date.now();
  const hit = textCache.get(url);
  if (hit && now - hit.at < ttlMs) return hit;
  const pending = inflight.get(url);
  if (pending) return pending;
  const job = (async () => {
    try {
      const res = await fetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text();
      const next = {
        at: Date.now(),
        ok: res.ok,
        status: res.status,
        body,
        total: res.headers.get("X-WP-Total") ?? undefined,
        pages: res.headers.get("X-WP-TotalPages") ?? undefined,
      };
      if (res.ok && body.length > 40) remember(url, next);
      return next;
    } catch (error) {
      if (hit && now - hit.at < ttlMs * 6) return hit;
      throw error;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, job);
  return job;
}
