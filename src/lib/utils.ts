import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Decode HTML entities, including leftover encoded ampersands. */
export function decodeEntities(value: string): string {
  let out = String(value ?? "");
  const amp = String.fromCharCode(38);
  for (let i = 0; i < 4; i++) {
    const next = out
      .split(`${amp}amp;`)
      .join(amp)
      .split(`${amp}AMP;`)
      .join(amp)
      .replace(/&#0*38;/g, amp)
      .replace(/&#x0*26;/gi, amp)
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
        if (body[0] === "#") {
          const n =
            body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
          return Number.isFinite(n) ? String.fromCharCode(n) : match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
      });
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}
