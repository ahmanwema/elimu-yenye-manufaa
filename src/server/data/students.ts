import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, canReadStudentAccount, isValidId, type Actor } from "@/server/authz/policy";

type StudentDb = Pick<PrismaClient, "studentAccount" | "membership">;

/**
 * Reads a student account record. Not-found and not-authorized are indistinguishable
 * to the caller, so IDs cannot be probed.
 */
export async function getStudentAccount(db: StudentDb, actor: Actor, studentProfileId: unknown) {
  if (!isValidId(studentProfileId)) throw new AuthorizationError();

  // Mirrors app.administers_member() in the RLS migration: any ACTIVE membership.
  const activeTenantIds = (
    await db.membership.findMany({
      where: { profileId: studentProfileId, status: "ACTIVE" },
      select: { tenantId: true },
    })
  ).map((m) => m.tenantId);

  if (!canReadStudentAccount(actor, studentProfileId, activeTenantIds)) throw new AuthorizationError();

  const account = await db.studentAccount.findUnique({
    where: { profileId: studentProfileId },
    select: { profileId: true, createdAt: true, profile: { select: { displayName: true } } },
  });
  if (!account) throw new AuthorizationError();
  return account;
}
