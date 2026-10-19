import { Prisma } from "@/generated/prisma/client";

/**
 * Expected, user-facing failures of a domain operation. `code` maps to a translated
 * message in the UI; nothing from the database or Supabase is shown to users.
 * Authorization failures use AuthorizationError (src/server/authz/policy.ts) instead.
 */
export type DomainErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "expired"
  | "email_mismatch"
  /** Recording consent (A70–A72) does not allow capturing this student's audio. */
  | "consent_required"
  /** The stored file is not AAC audio in M4A of at most 60 seconds (A69). */
  | "invalid_media"
  /** A84: the requester cannot approve their own deletion request; another admin must. */
  | "second_admin_required"
  /** A90: Option C (full recording) is not enabled for this Markaz. */
  | "feature_not_enabled"
  /** Live Class (A112): before the 15-minute early window of a scheduled session. */
  | "too_early"
  /** Live Class (A106): no ACTIVE/GRACE enrollment (waitlisted, suspended, ended or none). */
  | "access_inactive"
  /** Live Class: above the Markaz plan capacity ceiling (A109), or too many devices (A121). */
  | "limit_exceeded"
  /** A131: the Markaz has not chosen its time zone yet, so nothing can be scheduled. */
  | "timezone_required"
  /** A135: this class requires a VERIFIED payment/access authorization first. */
  | "payment_required"
  /** A134: not the next student in the FIFO waitlist; only a Markaz Admin may override, with a reason. */
  | "out_of_order";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
