# Tenancy Model

Status: **PROPOSED**, with several **OPEN QUESTIONS** flagged inline — this is the least settled area of the system and should not be treated as final.

## 1. Tenant types

Two kinds of tenant (PROPOSED terminology):

- **Independent Teacher tenant** — a single teacher operating on their own, not affiliated with a Markaz.
- **Markaz tenant** — an institution with potentially many teachers, its own administrator(s), and its own students.

## 2. Why shared-schema + RLS over schema-per-tenant

- Student self-registration and cross-teacher enrollment (a student studying with multiple teachers, possibly across both independent teachers and Markaz) is a core requirement (A2, A3 in [../../DECISIONS.md](../../DECISIONS.md)). Schema-per-tenant makes cross-tenant enrollment and any future cross-tenant reporting significantly harder, since a single student's data would be scattered across schemas.
- Supabase's 2026 guidance and general SaaS practice: use shared database + RLS for the common case, reserve dedicated databases for enterprise/compliance-driven exceptions. Nothing in the current brief indicates a Markaz needs a dedicated database.

## 3. Relationships (PROPOSED, needs approval)

- A **Teacher** can operate independently, or be a member of one or more Markaz. ~~OPEN QUESTION: can a teacher belong to more than one Markaz simultaneously?~~ **APPROVED (A28, BR-03, 2026-10-05)**: yes. Each Markaz relationship is tenant-scoped; roles, classes, access and data visibility must not leak across Markaz boundaries; a Teacher's role/permissions may differ in each Markaz. (Consequence for the P3 JWT-claims approach: claims must carry a per-tenant role, not a single global teacher role — see [database.md](database.md) §3.)
- A **Student** has one membership row per teacher/Markaz relationship they hold — there is no single "the student's tenant." Enrollment is the unit of tenancy scoping, not the account itself.
- A **Markaz** has one or more **Markaz Admin** users (**APPROVED role**, A26, 2026-10-05 — see [roles-permissions.md](roles-permissions.md) §2.1). They hold broad operational authority inside their own Markaz only, with no authority over other tenants or global settings. Whether that authority reaches each teacher's private student corrections is **not** granted by A26; A8 and A17 still apply, and the exact rows are open (open question 13).
- A **Parent** account (**APPROVED account type**, A27) links to one or more Students. Those Students may be enrolled across several tenants, so how a Parent link is scoped per tenant is open (open question 14).

### 3.1 Departure (2026-10-05)

- **Student leaves a Markaz (A32, BR-07):** the Student retains access to their own personal submissions/corrections; restricted/licensed Markaz content may be removed from their access; leaving is not deletion of personal academic history. The membership-revocation rule in [security.md](security.md) §5 must therefore distinguish "the student's own records" from "Markaz content". Open edge case: corrections anchored to Markaz-owned pages (open question 20).
- **Teacher leaves a Markaz:** not covered by an approved rule — open question 19.

## 4. Data ownership when a student studies under both an independent teacher and a Markaz

**OPEN QUESTION** (see [../roadmap/open-questions.md](../roadmap/open-questions.md) item 3): does the Markaz have any visibility into a student's work with an independent teacher they *also* study with outside the Markaz? Default assumption until told otherwise: **no** — each enrollment's data is scoped to that specific teacher/Markaz relationship only. This default should be explicitly confirmed, not assumed permanently.

## 5. Invitation links as the tenancy on-ramp

Invitation links are the mechanism by which a student's membership row gets created (A2). A link is scoped to exactly one teacher or one Markaz + a specific role, carries an expiry and optional max-use count, and redemption creates the membership without manual approval. Security requirements for these links are in [security.md](security.md).

## 5.1 What is implemented (2026-10-13 local foundation)

- `tenants` = Markaz. Independent-teacher tenants (§1) are **not** modelled yet; they are documented but not approved as a tenant type.
- `memberships(tenant_id, profile_id, role, status ACTIVE|ENDED, ended_at)`, unique per (tenant, profile, role). A Teacher in two Markaz has two independent rows (A28). A person may hold two roles in one Markaz.
- Tenant access = an ACTIVE membership in **that** tenant. Checked in `hasTenantPermission()` (server) and `app.has_tenant_role()` (RLS). A role in Markaz A is never consulted for Markaz B.
- Departure: set the membership to ENDED (no deletion). The student keeps their own account record and ENDED membership history (A32). The former Markaz loses visibility (deny-by-default; open question 21). Personal academic records will reference `student_accounts`, not memberships, so departure cannot orphan them.
- Invitation links (§5) are **not** implemented yet.

## 5.2 Phase 2A (2026-10-13)

- **Invitations are implemented** (invite-first, A45): single-use, hashed token, 7-day default, bound to one Markaz + one role + one email; tenant/role/email never come from the recipient. Markaz Admins invite TEACHER/STUDENT into their own Markaz; Super Admins may invite any role, including MARKAZ_ADMIN. Re-inviting a departed student re-activates their ENDED membership.
- **Parent links now belong to a Markaz** (`parent_student_links.tenant_id`) — the Markaz whose verifiers may verify the link (A46). A student in several Markaz may have their parent link verified in one of them; which one is part of OQ29.
- **Markaz Admin appointment** is a request → Super Admin approval workflow (A52). The candidate must already be an ACTIVE member of that Markaz.

## 5.3 Parent workflow (2026-10-13)

- Every parent link belongs to exactly one Markaz (`tenant_id`). Create (staff), verify, activate and staff-revoke require the matching permission **in that Markaz**, and the student must be an ACTIVE student there for create/verify/activate.
- A parent self-request names the Markaz by its code (slug). A staff link or a parent invitation is placed in the staff member's Markaz.
- A REVOKED link may be requested again, which re-opens it at PENDING in the requested Markaz. Full history is kept in `parent_link_events`.

## 5.4 Registration numbers (2026-10-13)

A student's registration number belongs to their STUDENT membership, so it is **per Markaz**: unique within a Markaz, different in each Markaz they join, and kept unchanged if they leave and rejoin. A self-request looks it up only within the Markaz named by the code, and only among ACTIVE students.

## 6. What is NOT decided

- ~~The exact Markaz Admin permission boundary (item 1)~~ — boundary resolved by A26; exact permission rows still open (item 13).
- Markaz visibility into a student's work with an independent teacher (item 3, second half — still open).
- Whether a "sub-teacher"/teaching-assistant concept exists within a Markaz (currently DEFERRED).
- Billing relationship between Markaz-level and teacher-level subscriptions — A34 confirms these are distinct concepts (Markaz tuition, teacher-level subscriptions, platform plans); how they interact is still open — see [../features/payments.md](../features/payments.md).
- Teacher departure behavior (item 19).
