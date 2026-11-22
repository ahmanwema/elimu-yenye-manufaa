"use server";

import { isSupabaseConfigured } from "@/env";
import type { ActionResult } from "@/lib/action-result";
import { AuthorizationError, canCreateTenant } from "@/server/authz/policy";
import { DomainError } from "@/server/services/errors";
import { createTenant, tenantAdminEmailSchema } from "@/server/services/tenants";
import { ensureAuthUserForEmail } from "@/server/supabase-admin";
import { field, runAsActor } from "./run";

// Every export of this file is a public endpoint (tests/unit/auth-safety.test.ts pins the list).

/**
 * Creates a Markaz (owner decision 2026-11-22). Super Admin only.
 *
 * `adminEmail` is OPTIONAL since A149. The owner's flow is to open the Markaz and then send a
 * MARKAZ_ADMIN join link to whoever will run it, so that person registers themselves with their
 * own password; there is no mailer, so naming an address here would reach nobody. When an
 * address IS supplied, the old behaviour stands: an auth account is prepared and that person
 * becomes the first ACTIVE Markaz Admin straight away.
 *
 * Order matters and is deliberate: authorization is checked FIRST, inside the actor-scoped run,
 * and only then is an auth account prepared. An unauthorized caller must never be able to make
 * this endpoint create a Supabase account for an address of their choosing.
 */
export async function createTenantAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    if (!canCreateTenant(actor)) throw new AuthorizationError();

    const rawEmail = (field(formData, "adminEmail") ?? "").trim();
    let adminProfileId: string | undefined;
    if (rawEmail !== "") {
      const email = tenantAdminEmailSchema.safeParse(rawEmail);
      if (!email.success) throw new DomainError("invalid_input");
      if (!isSupabaseConfigured()) throw new DomainError("invalid_state");
      adminProfileId = await ensureAuthUserForEmail(email.data);
    }

    await createTenant(db, actor, {
      name: field(formData, "name"),
      slug: field(formData, "slug"),
      adminProfileId,
      alsoTeacher: field(formData, "alsoTeacher") === "on",
    });
  });
}
