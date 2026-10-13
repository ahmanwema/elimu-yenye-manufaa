import type { PGlite } from "@electric-sql/pglite";
import { GRANTS, LINKS, MEMBERSHIPS, PARENTS, STUDENTS, T, U } from "../support/fixture";

/** Seeds the shared fixture as the database owner (bypassing RLS, like a migration/seed would). */
export async function seed(db: PGlite) {
  for (const id of Object.values(U)) {
    // Inserting into auth.users fires the profile-bootstrap trigger.
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  }
  await db.query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'Markaz A', 'markaz-a'), ($2, 'Markaz B', 'markaz-b')", [
    T.A,
    T.B,
  ]);
  for (const m of MEMBERSHIPS) {
    await db.query(
      `INSERT INTO memberships (tenant_id, profile_id, role, status, ended_at)
       VALUES ($1, $2, $3::"TenantRole", $4::"MembershipStatus", CASE WHEN $4 = 'ENDED' THEN now() END)`,
      [m.tenantId, m.profileId, m.role, m.status],
    );
  }
  for (const id of STUDENTS) await db.query("INSERT INTO student_accounts (profile_id) VALUES ($1)", [id]);
  for (const id of PARENTS) await db.query("INSERT INTO parent_accounts (profile_id) VALUES ($1)", [id]);
  for (const l of LINKS) {
    // Each state carries the audit trail of the steps that led to it (CHECK constraint).
    const verified = l.status === "VERIFIED" || l.status === "ACTIVE";
    const active = l.status === "ACTIVE";
    const revoked = l.status === "REVOKED";
    await db.query(
      `INSERT INTO parent_student_links
         (parent_profile_id, student_profile_id, tenant_id, status, requested_by_id, requested_at,
          verified_by_id, verified_at, activated_by_id, activated_at, revoked_by_id, revoked_at)
       VALUES ($1, $2, $3, $4::"ParentStudentLinkStatus", $1, now() - interval '3 days',
          $5, CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() - interval '2 days' END,
          $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() - interval '1 day' END,
          $7, CASE WHEN $7::uuid IS NULL THEN NULL ELSE now() END)`,
      [l.parent, l.student, l.tenantId, l.status, verified ? U.adminA : null, active ? U.adminA : null, revoked ? l.parent : null],
    );
  }
  for (const gr of GRANTS) {
    await db.query(
      `INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id, revoked_at, revoked_by_id)
       VALUES ($1, $2, 'PARENT_LINK_VERIFY', $3, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN $3::uuid END)`,
      [gr.tenantId, gr.profileId, U.superAdmin, gr.revoked ?? false],
    );
  }
  await db.query("INSERT INTO platform_admins (profile_id) VALUES ($1)", [U.superAdmin]);
}
