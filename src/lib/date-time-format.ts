/**
 * Shared Xplore Pondy display formatters.
 * Date-only values are parsed as calendar dates to avoid timezone day shifts.
 */
export function formatDisplayDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value).replaceAll("/", "-");
  }
  const raw = value.trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed).replaceAll("/", "-");
}

export function formatDisplayTime(value: string | null | undefined): string {
  if (!value) return "—";
  const raw = value.trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return raw;
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${String(displayHour).padStart(2, "0")}:${match[2]} ${suffix}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).format(parsed).replace(/\s+/g, " ").toUpperCase();
}

export function formatDisplayDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (value instanceof Date) return `${formatDisplayDate(value)} · ${formatDisplayTime(`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`)}`;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatDisplayDate(raw);
  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/);
    return match ? `${formatDisplayDate(match[1])} · ${formatDisplayTime(match[2])}` : raw;
  }
  return `${formatDisplayDate(parsed)} · ${formatDisplayTime(`${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`)}`;
}
