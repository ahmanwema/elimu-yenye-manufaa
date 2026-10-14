# Database

Status: Foundation schema **IMPLEMENTED locally (2026-10-13)** with Prisma (A39) — see §7. Migration files exist but have **not been applied to any live database**. Everything beyond the foundation in §2 is still a proposal. (2026-09-30: no schema existed.) See [../../DECISIONS.md](../../DECISIONS.md) §2.

## 1. Engine and approach

PROPOSED: PostgreSQL via Supabase, single shared database with a `tenant_id`-scoped Row Level Security (RLS) model, rather than schema-per-tenant or database-per-tenant. Rationale in [tenancy.md](tenancy.md).

## 2. Conceptual entity groups (not a final schema)

These are the entity *groups* this platform will need; exact columns/types are deferred to an implementation-time schema design that requires its own approval before migration.

- **Identity & tenancy**: users, tenants (teacher or Markaz), tenant memberships/roles, parent-child links (model open — see [roles-permissions.md](roles-permissions.md)). *2026-10-05: Parent is a separate account type linked to one or more Students (A27); a Teacher may hold memberships in several Markaz, each with its own role (A28); Markaz Administrator is an approved per-tenant role (A26). Column-level design is still not done.*
- **Invitations**: invitation links (scope, role granted, expiry, max uses, redemption log).
- **Curriculum**: subjects, levels/books/chapters/lessons, courses/modules/lessons, teacher-defined curriculum trees.
- **Live Class**: class sessions, attendance records, whiteboard documents/pages, whiteboard operation logs + snapshots, recordings (metadata + storage pointers), raise-hand/permission-grant events.
- **Corrections/annotations**: annotation records scoped to (document, page, student, teacher, visibility), optionally linked to a recording timestamp/audio segment. *2026-10-05: timestamp + short audio segment is the approved default (Option B, A29). Whether the segment is a stand-alone object or a pointer into a parent recording is not decided (open question 15).*
- **Payments** must keep the five commercial concepts of A34 distinguishable (see [../features/payments.md](../features/payments.md)).
- **Assessment**: exercises, exam definitions, questions (with grading-method per question: automatic/teacher/future-AI), submissions, grades, feedback, certificates.
- **Language learning**: vocabulary items (with source reference), sentence-construction submissions, grammar/I'rab exercises and answers, dictation audio + transcriptions.
- **Payments**: plans, subscriptions, course purchases, payment provider transactions (M-Pesa, Airtel Money), invoices.
- **Audit**: audit log of sensitive actions (recording start/stop, permission grants, data exports, role changes).

## 3. Multi-tenant data isolation pattern (PROPOSED)

- Every tenant-scoped table carries a `tenant_id` (or resolves to one via a parent FK) plus an index on it.
- RLS policies filter by the current user's tenant/role, sourced from **custom JWT claims** (tenant memberships + role) rather than a per-row subquery against a memberships table, for performance at scale — this is the pattern Supabase's own 2026 guidance recommends for multi-tenant RLS.
- `service_role` (which bypasses RLS) is used only in trusted server-side contexts (e.g. Supabase Edge Functions / server route handlers) and is never exposed to any client. This must be enforced by code review and secrets handling, not assumed.
- A student who studies with multiple teachers/tenants has multiple membership rows, not a single tenant_id on the user — see [tenancy.md](tenancy.md) for why.

## 4. Private annotations

Correction/annotation rows carry an explicit `visibility` scope (e.g. `private_to_student` vs `class_shared`) and RLS must filter on that scope *in addition to* tenant/role, so a private correction is unreadable even to other students in the same class, same teacher, same tenant. See [../features/student-corrections.md](../features/student-corrections.md).

## 5. What this document deliberately does not do

- It does not define column names, types, or constraints — that's implementation-time schema design, subject to its own review.
- It does not choose between soft-delete and hard-delete, or define retention periods — deferred to [security.md](security.md) data-retention open questions.
- It does not authorize creating any database or running any migration (see [../../DECISIONS.md](../../DECISIONS.md) §2).

## 7. Implemented foundation schema (2026-10-13)

Source of truth: [prisma/schema.prisma](../../prisma/schema.prisma). Migrations: `prisma/migrations/20261013000000_init` (generated offline with `prisma migrate diff`) and `20261013000100_supabase_auth_rls` (hand-written; Supabase-specific).

| Table | Purpose | Key rules |
|---|---|---|
| `profiles` | One per Supabase Auth user; `id` **is** `auth.users.id` | FK to `auth.users` with ON DELETE **RESTRICT** (account-deletion mechanics undecided). A trigger on `auth.users` creates the profile and nothing else. No email/PII duplicated from Auth. |
| `platform_admins` | Global Super Admin flag | Separate table; no Data API write path |
| `tenants` | Markaz | `slug` unique |
| `memberships` | Tenant-scoped role | Unique (tenant, profile, role). Status ACTIVE/ENDED with a CHECK tying `ended_at` to ENDED |
| `student_accounts` | Student account type | Future personal records reference this, not memberships (A32) |
| `parent_accounts` | Parent account type (A27) | — |
| `parent_student_links` | Parent ↔ Student | Status PENDING/VERIFIED/ACTIVE/REVOKED (A42); unique pair; CHECK parent ≠ student; FKs force a parent account on one side and a student account on the other. `status_changed_by_id` / `status_changed_at` are audit fields only — they do not define who may change status. |

**Identity mapping:** Supabase Auth owns identity (email, phone, passwords, sessions). The application never creates users; it reads the verified user id from the Supabase token and loads `profiles` by that id. There is no competing user table.

**Applying migrations:** use `prisma migrate deploy` against a **Supabase** database (the second migration needs the `auth` schema). `prisma migrate dev` needs a shadow database that also has the `auth` schema, such as the Supabase local stack. Never run either against production without explicit authorization.

**Not in the schema on purpose:** courses, classes, corrections, recordings, payments/plans/tuition/subscriptions/add-ons/entitlements (A34 concepts stay separate when built — no placeholder tables were created), invitation links, independent-teacher tenants.

## 8. Phase 2A schema additions (2026-10-13)

Migrations `20261013000200_phase2a` (generated offline as a schema-to-schema diff) and `20261013000300_phase2a_constraints_rls` (hand-written). Applied **only** to in-memory PGlite in tests.

| Table / change | Purpose | Key rules |
|---|---|---|
| `parent_student_links` + `tenant_id`, `verified_by_id`, `verified_at` | Link belongs to a Markaz; verification audit | VERIFIED/ACTIVE require verification fields (CHECK) |
| `tenant_permission_grants` | Explicit permissions (`PARENT_LINK_VERIFY`) | One live grant per (Markaz, person, permission) (partial unique); revocation keeps the row |
| `invitations` | Invite-first onboarding | Token **hash** only; normalized email; expiry after creation; status ↔ audit-field CHECKs; one pending per (Markaz, email, role) |
| `markaz_admin_appointment_requests` | Request → Super Admin review | One pending per (Markaz, candidate); reviewer ≠ requester; candidate ≠ requester |
| `corrections` (minimal) | Anchor for correction audio | References `student_accounts` (survives departure, A32); RESTRICT deletes |
| `correction_audio_clips` | **Standalone** correction audio (A53) | Own unique storage key from registration; composite FK pins the clip's tenant to the correction's; source/status/finalized CHECKs; recording id is provenance only (no FK until recordings exist — then ON DELETE SET NULL) |

**`profiles` must stay basic** (id, display name): teachers can read the names of ACTIVE students in their Markaz through RLS (A51). Any sensitive student data belongs in a separate table with its own policy.

**Note:** `parent_student_links.tenant_id` was added NOT NULL without a default. That is safe only because no database holds links yet.

## 9. Parent workflow & invitation changes (2026-10-13)

Migrations `20261013000400_parent_links_invites` (offline schema diff) and `20261013000500_parent_links_invites_rls` (hand-written). Applied only to in-memory PGlite; **not yet applied to any Supabase instance** (see docs/testing/dev-supabase-verification.md).

| Change | Purpose |
|---|---|
| `TenantPermission` + PARENT_LINK_CREATE / ACTIVATE / REVOKE, INVITATION_CREATE | Explicit permissions (A55–A59) |
| `parent_student_links` + `initiated_by`, `requested_by_id/at`, `activated_by_id/at`, `revoked_by_id/at` | Audit per step; CHECK `parent_student_links_state_fields` ties each state to its fields; CHECK `parent_student_links_order` |
| `parent_link_events` | Append-only history of every transition (server-only) |
| `invitations` + `kind` (MEMBERSHIP/PARENT), nullable `role`, `proposed_student_id` | Parent invitations (A61); CHECK `invitations_kind_fields`; pending-uniqueness index rebuilt with `NULLS NOT DISTINCT` (PostgreSQL 15+) |
| `app.has_tenant_permission` | All grantable permissions are eligible for MARKAZ_ADMIN/TEACHER |
| RLS `parent_student_links_select_tenant` | Visible to Markaz Admins and holders of any parent-link permission in that Markaz |

## 10. Registration number (2026-10-13)

Migrations `20261013000600_student_registration_number` (offline diff: column + unique (tenant_id, registration_number)) and `20261013000700_registration_number_trigger`:
- `app.new_registration_number()` generates the number;
- the BEFORE INSERT/UPDATE trigger `memberships_assign_registration_number` assigns it and makes it immutable;
- backfill for existing STUDENT memberships;
- CHECKs: student-only, present-for-students, format.

## 11. Development database (2026-10-13)

- Supabase project `elimu-yenye-manufaa` (PostgreSQL 17.11, eu-central-1) is the **development** database (A65). All 9 migrations are applied, and the schema is identical to the PGlite test database (scripts/compare-schema.mjs).
- `20261013000800_revoke_trigger_fn_execute` revokes EXECUTE on the profile trigger function from the API roles.
- Prisma interactive transactions use `maxWait 10 s / timeout 20 s` (src/server/db.ts), because of measured ~230 ms round-trips from the development machine.
- Connection strings use the **Session pooler**: the direct host is IPv6-only and was unreachable from the development machine.

## 12. Recording & correction media (2026-10-14, migrations 20261014000000 / 20261014000100)

Additive only (no drops; two FKs on the existing clips table added NOT VALID; one non-destructive backfill of `is_primary`).

| Table / column | Purpose |
|---|---|
| `student_accounts.date_of_birth` (+ recorded by/at) | Consent input; minor status derived (A70). Server-only. |
| `corrections.annotation`, `corrections.note` | Option B content (A67). |
| `correction_anchors` | Flexible anchors; opaque `ref_id` (no FK); required `snapshot`; `source_removed_at` (A67, A76). |
| `correction_audio_clips` + `is_primary`, `failed_at`, `deleted_at`, `archived_at`, `purge_eligible_at`, `purged_at`; FKs `created_by_id` → profiles, `source_recording_id` → recordings (SET NULL) | Primary/history (A68), format (A69), lifecycle (A73–A75). |
| `recording_consents` | GUARDIAN_ONLINE / OFFLINE_VERIFIED; withdrawal kept (A71–A72). |
| `recordings`, `recording_participants`, `recording_segments` | Provider-neutral Option C foundation (A77–A79). |
| `media_deletion_requests` | Exactly one target; PENDING → APPROVED (A73). |
| `audit_events` | Append-only audit (A80). |

Integrity is enforced in SQL as well as in services: one primary per correction; primary ⇒ live FINALIZED; finalized ⇒ `audio/mp4` and ≤ 60 000 ms; deletion ⇒ archive + purge date; purge ⇒ after grace; consent method fields; participant audio ⇔ CONSENTED; recording status ⇔ audit fields; started ⇒ notice shown; one pending deletion per target. RLS: see [security.md](security.md) §3.7.

## 6. Open questions

See [../roadmap/open-questions.md](../roadmap/open-questions.md) for tenant-ownership-of-student-data and Markaz/teacher relationship questions that materially affect the final schema shape.
