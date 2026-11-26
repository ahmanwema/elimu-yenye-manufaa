// Pure helpers for the student home page (ui-plan §4, F3). Presentation only: they choose what
// to show from data the services already authorized; nothing here grants or checks access.

export type SessionLike = {
  id: string;
  status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";
  scheduledStartAt: Date;
};

/** A LIVE session first (the most recently started); otherwise the earliest future SCHEDULED one. */
export function pickNextSession<T extends SessionLike>(sessions: readonly T[], now: Date): T | null {
  const live = sessions.filter((s) => s.status === "LIVE").sort((a, b) => b.scheduledStartAt.getTime() - a.scheduledStartAt.getTime());
  if (live[0]) return live[0];
  const upcoming = sessions
    .filter((s) => s.status === "SCHEDULED" && s.scheduledStartAt.getTime() >= now.getTime())
    .sort((a, b) => a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime());
  return upcoming[0] ?? null;
}

export type AttendanceTone = "present" | "late" | "absent";

/** PRESENT + punctuality LATE reads as late (A131 keeps the two separate; the calendar shows both as one colour). */
export function attendanceTone(status: "PRESENT" | "LATE" | "ABSENT", punctuality: "ON_TIME" | "LATE" | null): AttendanceTone {
  if (status === "ABSENT") return "absent";
  if (status === "LATE" || punctuality === "LATE") return "late";
  return "present";
}

const TONE_RANK: Record<AttendanceTone, number> = { present: 0, late: 1, absent: 2 };

/** "YYYY-MM-DD" of an instant in a time zone (UTC when the Markaz has none, as elsewhere). */
export function dayKey(date: Date, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export type CalendarCell = { day: number; key: string; tone: AttendanceTone | null; today: boolean } | null;

/**
 * A month as weeks of 7 cells (Sunday first), padded with nulls. When a day holds several
 * sessions the most serious tone wins (absent > late > present).
 */
export function monthGrid(
  year: number,
  month: number, // 0–11
  records: readonly { key: string; tone: AttendanceTone }[],
  todayKey: string,
): CalendarCell[][] {
  const tones = new Map<string, AttendanceTone>();
  for (const r of records) {
    const prev = tones.get(r.key);
    if (!prev || TONE_RANK[r.tone] > TONE_RANK[prev]) tones.set(r.key, r.tone);
  }
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= days; day++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, key, tone: tones.get(key) ?? null, today: key === todayKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type EnrollmentTone = "success" | "warning" | "accent" | "info" | "danger" | "muted";

/** Badge colour for an enrollment state. */
export function enrollmentTone(state: string): EnrollmentTone {
  switch (state) {
    case "ACTIVE":
      return "success";
    case "GRACE":
      return "warning";
    case "PENDING_PAYMENT":
      return "accent";
    case "WAITLISTED":
      return "info";
    case "SUSPENDED":
      return "danger";
    default:
      return "muted";
  }
}
