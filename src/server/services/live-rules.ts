// Live Class business rules (owner TO-BE approval 2026-10-19). PURE: no I/O, so every rule is
// unit-testable and the services stay thin. The numbers below are the APPROVED values; none is a
// commercial limit. Capacity numbers are deliberately absent (A33: not approved).

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A108: default grace period after the verified access period ends. */
export const GRACE_PERIOD_DAYS = 7;
/** A112: students may wait from 15 minutes before the scheduled start. */
export const EARLY_JOIN_MINUTES = 15;
/** A112: an authorized person may start from 15 minutes before the scheduled start. */
export const EARLY_START_MINUTES = 15;
/** A122: arriving after scheduled start + 15 minutes is late. */
export const LATE_THRESHOLD_MINUTES = 15;
/** A122: attending at least half of the session is PRESENT. */
export const PRESENT_MIN_FRACTION = 0.5;
/** A113: a session still LIVE at scheduled end + 30 minutes is closed for safety. */
export const SAFETY_CLOSE_MINUTES = 30;
/** A114: default ad hoc duration — a default only, never a commercial limit. */
export const DEFAULT_AD_HOC_DURATION_MINUTES = 60;
/** Technical bound on a chosen session duration (one day). Not a business rule. */
export const MAX_SESSION_DURATION_MINUTES = 24 * 60;
/** A121: one primary interactive device + one view-only device per account. */
export const MAX_OPEN_DEVICES_PER_PARTICIPANT = 2;

export type EnrollmentState = "WAITLISTED" | "ACTIVE" | "GRACE" | "SUSPENDED" | "ENDED";

/** End of grace: an explicitly extended date, else access end + 7 days. */
export function graceDeadline(accessUntil: Date, graceUntil: Date | null): Date {
  return graceUntil ?? new Date(accessUntil.getTime() + GRACE_PERIOD_DAYS * DAY);
}

/**
 * Effective enrollment state at `now` (A108). The stored status may lag behind a not-yet-run
 * lifecycle job; access decisions always use THIS, so a missed job never grants access.
 *   ACTIVE ──access period ends──▶ GRACE ──grace ends──▶ SUSPENDED
 */
export function effectiveEnrollmentState(
  e: { status: EnrollmentState; accessUntil: Date | null; graceUntil: Date | null },
  now: Date,
): EnrollmentState {
  if (e.status === "WAITLISTED" || e.status === "ENDED" || e.status === "SUSPENDED") return e.status;
  if (e.status === "GRACE") {
    const deadline = e.graceUntil ?? (e.accessUntil ? graceDeadline(e.accessUntil, null) : null);
    return deadline && now.getTime() > deadline.getTime() ? "SUSPENDED" : "GRACE";
  }
  // ACTIVE
  if (!e.accessUntil || now.getTime() <= e.accessUntil.getTime()) return "ACTIVE";
  return now.getTime() > graceDeadline(e.accessUntil, e.graceUntil).getTime() ? "SUSPENDED" : "GRACE";
}

/** Seats are held by every open, non-waitlisted enrollment (ACTIVE, GRACE, SUSPENDED). */
export const SEAT_HOLDING_STATES: readonly EnrollmentState[] = ["ACTIVE", "GRACE", "SUSPENDED"];

/** A class value must be at or below the plan ceiling when one is configured (A109). */
export function capacityWithinCeiling(value: number | null, ceiling: number | null): boolean {
  if (value === null) return true;
  return Number.isInteger(value) && value > 0 && (ceiling === null || value <= ceiling);
}

/** The capacity actually enforced: the class value, else the plan ceiling, else unlimited (null). */
export function effectiveCapacity(classValue: number | null, ceiling: number | null): number | null {
  return classValue ?? ceiling;
}

// --- Session time windows (A112–A114) ------------------------------------------------------

export function waitingRoomOpensAt(scheduledStartAt: Date): Date {
  return new Date(scheduledStartAt.getTime() - EARLY_JOIN_MINUTES * MINUTE);
}

export function startAllowedFrom(scheduledStartAt: Date): Date {
  return new Date(scheduledStartAt.getTime() - EARLY_START_MINUTES * MINUTE);
}

export function safetyCloseAt(scheduledEndAt: Date): Date {
  return new Date(scheduledEndAt.getTime() + SAFETY_CLOSE_MINUTES * MINUTE);
}

export function lateThresholdAt(scheduledStartAt: Date): Date {
  return new Date(scheduledStartAt.getTime() + LATE_THRESHOLD_MINUTES * MINUTE);
}

// --- Attendance (A122) ----------------------------------------------------------------------

export type Interval = { start: Date; end: Date | null };

/**
 * Total covered milliseconds of the UNION of intervals, clipped to [from, to]. Overlapping
 * intervals (a second device, a reconnect overlap) are counted once.
 */
export function unionDurationMs(intervals: readonly Interval[], from: Date, to: Date): number {
  const lo = from.getTime();
  const hi = to.getTime();
  const clipped = intervals
    .map((i) => [Math.max(i.start.getTime(), lo), Math.min((i.end ?? to).getTime(), hi)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of clipped) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

export type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT";

/**
 * A122, applied in this order (the owner's two rules, made consistent):
 *   1. present for at least 50 % of the session's actual duration → PRESENT;
 *   2. otherwise, first admitted arrival after scheduled start + 15 min → LATE;
 *   3. otherwise → ABSENT (including never joined).
 * See docs/roadmap/open-questions.md item 53 for the precedence confirmation request.
 */
export function computeAttendance(input: {
  actualStartAt: Date;
  actualEndAt: Date;
  scheduledStartAt: Date;
  /** Admitted presence intervals of the student (all devices). */
  intervals: readonly Interval[];
}): { status: AttendanceStatus; presentSeconds: number; sessionSeconds: number; firstArrivalAt: Date | null } {
  const sessionMs = Math.max(0, input.actualEndAt.getTime() - input.actualStartAt.getTime());
  const presentMs = unionDurationMs(input.intervals, input.actualStartAt, input.actualEndAt);
  const starts = input.intervals
    .filter((i) => (i.end ?? input.actualEndAt).getTime() > input.actualStartAt.getTime() && i.start.getTime() < input.actualEndAt.getTime())
    .map((i) => Math.max(i.start.getTime(), input.actualStartAt.getTime()));
  const firstArrivalAt = starts.length ? new Date(Math.min(...starts)) : null;
  let status: AttendanceStatus = "ABSENT";
  if (presentMs > 0 && sessionMs > 0 && presentMs >= PRESENT_MIN_FRACTION * sessionMs) status = "PRESENT";
  else if (presentMs > 0 && firstArrivalAt && firstArrivalAt.getTime() > lateThresholdAt(input.scheduledStartAt).getTime()) status = "LATE";
  return { status, presentSeconds: Math.floor(presentMs / 1000), sessionSeconds: Math.floor(sessionMs / 1000), firstArrivalAt };
}
