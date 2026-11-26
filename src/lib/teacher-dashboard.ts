// Pure helpers for the teacher home page (ui-plan §4, F4). Presentation only: they order and
// count data the services already authorized; nothing here grants or checks access.

import type { SessionLike } from "@/lib/student-dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sessions worth acting on: every LIVE one, plus SCHEDULED ones from now up to `days` ahead.
 * LIVE first, then by start time.
 */
export function upcomingSessions<T extends SessionLike>(sessions: readonly T[], now: Date, days = 7): T[] {
  const end = now.getTime() + days * DAY_MS;
  return sessions
    .filter(
      (s) =>
        s.status === "LIVE" ||
        (s.status === "SCHEDULED" && s.scheduledStartAt.getTime() >= now.getTime() && s.scheduledStartAt.getTime() <= end),
    )
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "LIVE" ? -1 : 1;
      return a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime();
    });
}

export type SessionTone = "danger" | "info" | "muted" | "warning";

/** Badge colour for a session status: live stands out, cancelled warns, ended recedes. */
export function sessionTone(status: SessionLike["status"]): SessionTone {
  switch (status) {
    case "LIVE":
      return "danger";
    case "SCHEDULED":
      return "info";
    case "CANCELLED":
      return "warning";
    default:
      return "muted";
  }
}
