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
  | "email_mismatch";

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
