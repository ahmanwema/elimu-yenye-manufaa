import "server-only";
import { refresh } from "next/cache";
import type { ActionResult, ResultCode } from "@/lib/action-result";
import { getCurrentActor } from "@/server/auth";
import { AuthorizationError, type Actor } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/services/errors";
import type { PrismaClient } from "@/generated/prisma/client";

/** Maps any failure to a translatable code. Internal error details are only logged. */
export function toResultCode(error: unknown): ResultCode {
  if (error instanceof AuthorizationError) return "forbidden";
  if (error instanceof DomainError) return error.code;
  console.error("[action] unexpected failure", error);
  return "error";
}

/**
 * Runs a mutation as the signed-in Actor. The actor is loaded fresh from the verified
 * session; the service performs its own authorization before touching the database.
 */
export async function runAsActor<T>(
  fn: (db: PrismaClient, actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  const current = await getCurrentActor();
  if (current.state !== "signed-in") return { status: "error", code: "forbidden" };
  try {
    const data = await fn(getDb(), current.actor);
    refresh();
    return { status: "ok", data };
  } catch (error) {
    return { status: "error", code: toResultCode(error) };
  }
}

export function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}
