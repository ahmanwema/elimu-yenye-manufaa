// Markaz time-zone helpers (A112). Timestamps are ALWAYS stored as UTC instants; a Markaz's IANA
// zone is used only to interpret schedule wall-clock times and to display. No zone is assumed:
// the database default is "UTC" until the Markaz sets its own. Pure — uses only Intl.

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock parts of a UTC instant in a zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of the zone from UTC at a UTC instant, in ms (e.g. +3 h for Africa/Nairobi). */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = zonedParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a local calendar date "YYYY-MM-DD" (no zone). */
export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const m = DATE.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * The UTC instant of a Markaz-local wall-clock time: `localDate` + `minuteOfDay` in `timeZone`.
 * Across a DST change the second offset check picks the valid instant.
 */
export function zonedWallTimeToUtc(localDate: string, minuteOfDay: number, timeZone: string): Date {
  const d = parseLocalDate(localDate);
  if (!d) throw new RangeError("invalid local date");
  const guess = Date.UTC(d.year, d.month - 1, d.day, 0, minuteOfDay);
  const first = offsetMs(guess, timeZone);
  const candidate = guess - first;
  const second = offsetMs(candidate, timeZone);
  return new Date(second === first ? candidate : guess - second);
}

/** Weekday (0 = Sunday) of a local calendar date. */
export function localWeekday(localDate: string): number {
  const d = parseLocalDate(localDate);
  if (!d) throw new RangeError("invalid local date");
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Local calendar date "YYYY-MM-DD" of a UTC instant in a zone. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Adds whole days to a local calendar date. */
export function addLocalDays(localDate: string, days: number): string {
  const d = parseLocalDate(localDate);
  if (!d) throw new RangeError("invalid local date");
  const next = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return next.toISOString().slice(0, 10);
}
