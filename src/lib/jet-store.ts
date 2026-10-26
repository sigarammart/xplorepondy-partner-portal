/** JetEngine data store used by xplorepondy.com listing cards (`local-storage` type). */
export const JET_TEMP_TRIP_SLUG = "trip-itinerary-temp";
export const JET_TEMP_STORAGE_KEY = `jet_engine_store_${JET_TEMP_TRIP_SLUG}`;
/** JetEngine bookmark store (`user-meta` on WP; mirrored locally in the app). */
export const JET_BOOKMARK_SLUG = "save-bookmark";
export const JET_BOOKMARK_STORAGE_KEY = `jet_engine_store_${JET_BOOKMARK_SLUG}`;

function readIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  const unique = [...new Set(ids.map(String))];
  try {
    if (unique.length) window.localStorage.setItem(key, unique.join(","));
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore quota */
  }
}

export function jetTempIds(): string[] {
  return readIds(JET_TEMP_STORAGE_KEY);
}

export function jetTempHas(postId: number | string): boolean {
  return readIds(JET_TEMP_STORAGE_KEY).includes(String(postId));
}

export function jetTempAdd(postId: number | string): string[] {
  const ids = readIds(JET_TEMP_STORAGE_KEY);
  const id = String(postId);
  if (!ids.includes(id)) ids.push(id);
  writeIds(JET_TEMP_STORAGE_KEY, ids);
  return ids;
}

export function jetTempRemove(postId: number | string): string[] {
  const ids = readIds(JET_TEMP_STORAGE_KEY).filter((x) => x !== String(postId));
  writeIds(JET_TEMP_STORAGE_KEY, ids);
  return ids;
}

export function jetTempWriteAll(postIds: Array<number | string>) {
  writeIds(JET_TEMP_STORAGE_KEY, postIds.map(String));
}

export function jetBookmarkIds(): string[] {
  return readIds(JET_BOOKMARK_STORAGE_KEY);
}

export function jetBookmarkWriteAll(postIds: Array<number | string>) {
  writeIds(JET_BOOKMARK_STORAGE_KEY, postIds.map(String));
}

export function parseJetStoreIds(raw: unknown): number[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseJetStoreIds(JSON.parse(trimmed));
      } catch {
        /* comma-separated fallback below */
      }
    }
    return [...new Set(trimmed.split(",").map((id) => Number(id.trim())).filter((n) => Number.isFinite(n) && n > 0))];
  }
  if (Array.isArray(raw)) {
    return [...new Set(raw.flatMap((value) => parseJetStoreIds(value)))];
  }
  if (typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    const entries = Object.entries(row);
    const counted = entries.length > 0 && entries.every(([key, value]) => {
      const id = Number(key);
      const count = Number(value);
      return Number.isFinite(id) && id > 0 && Number.isFinite(count) && count > 0 && typeof value !== "object";
    });
    if (counted) {
      return [...new Set(entries.map(([key]) => Number(key)).filter((n) => Number.isFinite(n) && n > 0))];
    }
    for (const key of ["listing_id", "item_id", "post_id", "id"]) {
      const value = row[key];
      if (value != null && typeof value !== "object") {
        const id = Number(value);
        if (Number.isFinite(id) && id > 0) return [id];
      }
    }
    return [...new Set(Object.values(row).flatMap((value) => parseJetStoreIds(value)))];
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? [id] : [];
}

export function bookmarkIdsFromUserMeta(meta?: Record<string, unknown> | null): number[] {
  if (!meta) return [];
  const keys = [
    "je_data_store_save-bookmark",
    "save-bookmark",
    "jet_engine_store_save-bookmark",
    "jet_engine_save-bookmark",
    "jet_engine_data_store_save-bookmark",
    "jet-engine-store-save-bookmark",
  ];
  const ids: number[] = [];
  for (const key of keys) {
    if (meta[key] != null) ids.push(...parseJetStoreIds(meta[key]));
  }
  for (const [key, value] of Object.entries(meta)) {
    if (keys.includes(key)) continue;
    if (/save[-_]?bookmark/i.test(key)) ids.push(...parseJetStoreIds(value));
  }
  return [...new Set(ids)];
}
