# Roles & Permissions

Status: base roles are **APPROVED**. Since 2026-10-05 the **Markaz Administrator** role (A26) and the **Parent** account type (A27) are also **APPROVED** as roles; their detailed permission rows are still **PROPOSED** / **OPEN QUESTION**. See [../../DECISIONS.md](../../DECISIONS.md).

## 1. Approved base roles

1. **Super Admin** — platform-level, cross-tenant operational access (support, abuse handling, platform configuration).
2. **Teacher** — owns their own courses, classes, students' educational data within their own enrollments.
3. **Student** — self-registers, enrolls via invitation link, consumes content, submits work.
4. **Unregistered visitor** — public marketing/catalog pages only, no account.

## 2. Additional roles

> **2026-10-05 update:** Markaz Admin and Parent/Guardian are now approved roles — see §2.1. The table below is the original 2026-09-30 proposal, kept for history. Where its *description* of the Markaz Admin is narrower than A26, A26 wins.

| Proposed role (2026-09-30) | Purpose | Why it's needed |
|---|---|---|
| **Markaz Admin** | Institution-level admin distinct from an individual Teacher: manages the Markaz's teacher roster, shared settings, possibly billing — but does **not** automatically inherit each teacher's private student data. | Without this role, "institution" has no owner distinct from an arbitrary teacher, which conflicts with A8 (teacher data isolation) once a Markaz has multiple teachers. |
| **Parent/Guardian** | Read-only access to one or more linked Student accounts' progress, attendance, results. | Required by A9, but the brief leaves the account model open (see below). |
| **Teaching Assistant** (DEFERRED) | Delegated subset of Teacher permissions within one class. | Not requested in the brief; flagged only as a future possibility, not to be built now. |

### 2.1 Approved role decisions (2026-10-05)

- **Markaz Administrator (A26, BR-01)** — close to a Super Admin *inside their own Markaz*, with broad operational authority over that tenant. They do **not** automatically gain authority over other Markaz/tenants, global platform settings, or Super Admin-only operations. The exact permission rows are **not** derived yet — they must come from documented/implemented system capabilities, not be invented ([../roadmap/open-questions.md](../roadmap/open-questions.md) item 13). A26 does not by itself change A8 or A17. In particular, A17 limits a private correction to its student + teacher, and the Super Admin row in §4 already denies routine access to private corrections, so "close to Super Admin" does not by itself grant that access.
- **Parent (A27, BR-02)** — a separate account type, linkable to one or more Students. It must not be modelled as a viewer flag or an embedded Student property. Linking/verification method, whether access is read-only, and which data a Parent may see are open (item 14).

### 2.2 Decisions and implementation (2026-10-13)

- **Markaz Administrator = full tenant administrator for their own Markaz (A40).** Applies to capabilities that exist in documentation. Never: another Markaz, platform-global settings, Super Admin management, global pricing/policy, global tenant administration.
- **Parent visibility (A41):** progress, attendance, assessments, submissions, corrections and approved recordings of an ACTIVE-linked child; never teacher-private notes, administrator-only notes, unrelated students, or other parents' children. Link states (A42): PENDING / VERIFIED / ACTIVE / REVOKED. **The foundation grants access on ACTIVE only** (the safer reading of "verified/active"; owner to confirm — open question 14). Who verifies a link is not decided and **no transition workflow is implemented**.

**Role model as implemented** (`prisma/schema.prisma`, `src/server/authz/policy.ts`):

| Role | Scope | Stored as |
|---|---|---|
| SUPER_ADMIN | Global | Row in `platform_admins` (separate table, so no profile update can grant it) |
| MARKAZ_ADMIN, TEACHER, STUDENT | Per Markaz | `memberships(tenant_id, profile_id, role, status)` — one row per role per Markaz |
| PARENT | Account type + relationship, **not** a tenant role | `parent_accounts` + `parent_student_links` |
| Unregistered visitor | No account | Public pages only (A7). No authenticated "guest" exists. |

**Foundation permissions as implemented** (rows for future features are added with those features):

| Capability | Super Admin | Markaz Admin | Teacher | Student | Parent |
|---|---|---|---|---|---|
| `tenant:read` (see the Markaz) | All | Own Markaz | Each Markaz they belong to | Own Markaz | No |
| `tenant:members:read` (membership list) | All | Own Markaz | No (OQ25) | No | No |
| Read a student account record | All | Students active in own Markaz | No (OQ25) | Own only | ACTIVE-linked child only |
| Any write to application tables via the Data API | No (server only) | No | No | No | No |

Only ACTIVE memberships count. An ENDED membership grants nothing in that Markaz, but the student keeps access to their own records (A32).

### 2.3 Phase 2A decisions and implementation (2026-10-13)

**Two kinds of permission** (`src/server/authz/policy.ts`, mirrored in SQL):

1. **Role-derived** — implied by an ACTIVE role in *that* Markaz. A Super Admin holds a fixed platform-scope subset.
2. **Explicit (grantable)** — never implied by a role (A47). Stored in `tenant_permission_grants` (per person, per Markaz, revocable, audited). It takes effect only while the holder also has an **eligible ACTIVE role** in that Markaz. **No platform-admin bypass.** Today there is one: `parent_link.verify` (eligible roles: MARKAZ_ADMIN, TEACHER — A46).

| Permission | Kind | Super Admin | Markaz Admin | Teacher | Student | Parent |
|---|---|---|---|---|---|---|
| `tenant.read` | role | ✓ | own Markaz | each Markaz | own Markaz | — |
| `tenant.members.read` | role | ✓ | own Markaz | — | — | — |
| `tenant.roster.read` (BASIC: id + display name of ACTIVE students) | role | ✓ | own Markaz | each Markaz they teach in (A51) | — | — |
| `tenant.invitations.manage` | role | ✓ (any role incl. MARKAZ_ADMIN) | own Markaz (TEACHER/STUDENT only) | — (OQ27) | — | — |
| `tenant.parent_links.read` | role | ✓ | own Markaz | only with `parent_link.verify` | — | own links |
| `tenant.admin_appointment.request` | role | **— (approves instead)** | own Markaz | — | — | — |
| Approve/reject Markaz Admin appointment | platform | ✓ (not own request) | — | — | — | — |
| `parent_link.verify` (PENDING → VERIFIED) | **explicit** | **— unless granted *and* eligible role** | only if granted, in that Markaz | only if granted, in that Markaz | — | — |
| Grant/revoke `parent_link.verify` | platform | ✓ (interim; OQ30) | — | — | — | — |

Other rules:
- A verifier cannot verify a link they are party to. The student must be an ACTIVE student of the link's Markaz.
- **Not implemented, because the actor is undecided:** VERIFIED → ACTIVE, link creation/request, revocation (OQ14, OQ29).
- **Detailed student data:** `canReadStudentDetail()` takes a `ClassAssignmentResolver`. Until classes exist it returns "teaches nobody", so teachers get no detailed access (A51). Private categories (corrections, teacher-private notes, admin notes) have their own rules and are never unlocked by the roster or by detail access.
- **Parent visibility contract** (`parentMaySee`): progress, attendance, assessments, submissions, corrections, approved recordings — ACTIVE link only; never teacher-private or admin-only notes. Future features must call it and mirror it in RLS.

### 2.4 Parent-link workflow and invitation permissions (2026-10-13, A55–A61)

**Explicit permissions** (never implied by role; per person, per Markaz; effective only with an ACTIVE MARKAZ_ADMIN or TEACHER role in that Markaz; no Super Admin bypass):

| Permission | Allows | Decision |
|---|---|---|
| `parent_link.create` | Start a link for an existing parent account (status PENDING, initiated by STAFF); propose a child in a parent invitation | A56 (+ interim OQ32) |
| `parent_link.verify` | PENDING → VERIFIED | A46 |
| `parent_link.activate` | VERIFIED → ACTIVE | A55 |
| `parent_link.revoke` | Any non-revoked state → REVOKED | A57 |
| `invitation.create` | A **Teacher** may invite STUDENT or PARENT into that Markaz | A59 |

**Without staff permissions:** a Parent may request their own link (PENDING, initiated by PARENT) and revoke their own link. A Parent can never verify or activate.

**Assignment (A58):**

| Assigner | May assign | Where | To whom |
|---|---|---|---|
| Super Admin | all five (create/activate/revoke/invitation.create are interim — OQ31) | any Markaz | an ACTIVE Markaz Admin or Teacher there |
| Markaz Admin | `parent_link.verify` only | own Markaz | an ACTIVE Teacher there, never themselves |
| Teacher | nothing | — | — |

Revocation of grants follows the same scope. A grant whose holder loses the eligible role stops working immediately (the row is kept).

**Invitation targets:**

| Inviter | Targets |
|---|---|
| Super Admin | MARKAZ_ADMIN, TEACHER, STUDENT, PARENT (any Markaz) |
| Markaz Admin (by role) | TEACHER, STUDENT, PARENT (own Markaz) |
| Teacher with `invitation.create` | STUDENT, PARENT (that Markaz only); lists and cancels only their own invitations |
| Anyone else | nothing |

**Illegal transitions are refused in code and by the database CHECK** `parent_student_links_state_fields`:
- PENDING → ACTIVE;
- REVOKED → ACTIVE / VERIFIED;
- activation without a recorded verification;
- any change by someone party to the link (as verifier or activator).

### 2.5 Delegation update (2026-10-13, A62–A64)

**Assignment now:**

| Assigner | May assign | Where | To whom |
|---|---|---|---|
| Super Admin | all five | any Markaz | an ACTIVE Markaz Admin or Teacher there |
| Markaz Admin | **all five** | own Markaz | an ACTIVE **Teacher** there; never themselves |
| Teacher | nothing | — | — |

A Markaz Admin may remove grants in their own Markaz that are held by non-admins, including grants of Teachers who have left; never their own, and never another admin's.

**Child proposal in a parent invitation** needs both explicit grants, `invitation.create` + `parent_link.create`, for every inviter, Markaz Admins included (A63).

**Self-request** (A64): Markaz code + student email OR Markaz code + student registration number.

### 2.6 Recording & correction media (2026-10-14, A66–A80)

| Capability | Super Admin | Markaz Admin (own Markaz) | Authoring Teacher (active) | Other / departed Teacher | Student | ACTIVE Parent | Other Parent |
|---|---|---|---|---|---|---|---|
| Read correction + clips | ✓ **audited** | ✓ | ✓ | — | own | child, all Markaz | — |
| Create correction / add clip | — | — | ✓ (clip needs consent) | — | — | — | — |
| Request media deletion | — | ✓ | ✓ | — | — | (withdrawing consent creates a review) | — |
| Approve media deletion | — | ✓ (interim: not own request) | — | — | — | — | — |
| Create / submit recording | — | — | ✓ | — | — | — | — |
| Approve / revoke recording | — | ✓ (interim: not if author) | — | — | — | — | — |
| Play full recording | ✓ **audited** | ✓ | ✓ | — | not decided (OQ42) | approved + consent gates | — |
| Record DOB | — | ✓ (student ACTIVE there; interim) | — | — | — | ✓ (interim) | — |
| Online consent | — | — | — | — | — | ✓ | — |
| Verified offline consent | — | ✓ | — | — | — | — | — |

These are role/relationship rules (like the existing correction rule), not grantable permissions; the explicit-permission system (A47) is unchanged. Pure rules: `src/server/authz/policy.ts` §5 and `recording-consent.ts`.

### 2.7 Media policy decisions (2026-10-15, A81–A91)

| Capability | Super Admin | Markaz Admin (own Markaz) | Authoring Teacher (active) | Student | ACTIVE Guardian |
|---|---|---|---|---|---|
| Enter DOB | — | — | — | own | child |
| Verify DOB | — | ✓ (not one they entered — interim) | — | — | — |
| Own (adult) consent / withdraw | — | — | — | ✓ own | — |
| Minor consent / withdraw | — | offline consent only (record) | — | — | ✓ |
| Approve deletion | — | ✓ never own request (A84) | — | — | — |
| Decline deletion | — | ✓ | — | — | — |
| Cancel deletion | requester only (any role that may request) | | | | |
| Reject / approve recording | — | ✓ (not if author — interim) | — | — | — |
| Resubmit recording | — | — | ✓ | — | — |
| Choose current clip | — | ✓ | ✓ | — | — |
| Request Option C | — | ✓ | ✗ | — | — |
| Enable Option C | ✓ | — | ✗ | — | — |

### 2.8 2026-10-16 (A92–A98)

- Approve/reject a recording: any Markaz Admin of that Markaz, **including its author** (A92). Approve a deletion request: never the requester (A84).
- Verify a DOB: a Markaz Admin who did **not** enter it (A93).
- Play an approved full recording: the participating student (A94), an ACTIVE parent (A95), plus staff as before.
- Option C: request (Markaz Admin, own Markaz), cancel (the requester), enable/decline/disable (Super Admin) — A96.

### 2.9 Live Class (2026-10-19, A101–A130)

Implemented in `src/server/authz/live-class.ts` (pure, unit-tested as a matrix) and enforced by every service before any query. Every cell also requires the person's ACTIVE membership in the class's Markaz: Primary/Co/Substitute need an ACTIVE **Teacher** membership (an assignment alone grants nothing), the Markaz Admin an ACTIVE **Markaz Admin** membership. A Super Admin has **no** Live Class powers (none were approved), except setting the plan capacity ceilings. "Admin" = Markaz Admin of that Markaz — operational, **not** teaching (A115).

| Action | Primary | Co-Teacher | Substitute (that session) | Markaz Admin | Student | Parent |
|---|---|---|---|---|---|---|
| Create class / edit details / capacity / schedule / archive / assign or replace teachers | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Read class (roster, waitlist, payments state) | ✓ | ✓ | ✗ | ✓ | own state only | ✗ |
| Enroll / admit from waitlist / end enrollment | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Capacity override (above capacity, with reason) | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Extend grace | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Submit payment evidence | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Verify / reject payment | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| ~~…or with the explicit `payment.verify` grant (A136)~~ — **superseded by A140**: no grant exists; see §2.10 | — | — | — | — | — | — |
| Create session (scheduled, from schedule, ad hoc) | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Start / end session | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Cancel scheduled session | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Assign substitute | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Join session | ✓ | ✓ | ✓ | ✓ (operational) | ACTIVE/GRACE enrollment | ✗ |
| Remove participant | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Grant / revoke student mic | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Grant / revoke student whiteboard; author whiteboard | ✓ | ✓ | ✓ | ✗ | if granted (primary device) | ✗ |
| Screen share | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read session attendance (incl. durations) | ✓ | ✓ | ✓ | ✓ | own status | child's status only |
| Adjust attendance and punctuality (A132) | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Admit from waitlist out of FIFO order, with reason (A134) | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Detailed student data (A51/A137) — students with ACTIVE/GRACE access in the teacher's current class | ✓ | ✓ | ✗ | own Markaz | self | own category rules |
| Read / write class chat | ✓ | ✓ | that session only | ✓ (write if joined) | with ACTIVE/GRACE access | ✗ |
| Start / stop session recording (Option C) | ✓ | ✓ | ✓ | stop only | ✗ | ✗ |
| Correct recording participants (before finalization) | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Set Markaz time zone | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |

~~A51's teacher-detail resolver (`NO_CLASSES_YET`) is intentionally unchanged in this pass (open question 58).~~ **Superseded 2026-10-19 (A137):** the resolver is wired to real class data (`src/server/data/student-detail.ts`); `NO_CLASSES_YET` was removed.

**[Superseded 2026-10-19 by A140 — kept for history]** **Explicit permissions, 2026-10-19 (A136):** the grantable list is now six — `parent_link.create/verify/activate/revoke`, `invitation.create`, **`payment.verify`**. Like the others it is never implied by a role, is tenant-scoped, effective only for an ACTIVE Markaz Admin or Teacher there, assigned by a Markaz Admin (own Teachers) or Super Admin, never by a Teacher. Design choice: a **permission**, not a new tenant role, because a new role would ripple through invitations, roster, RLS role arrays and the typed role maps. A non-teaching finance member therefore needs a staff membership today; a dedicated Finance Officer role would be a future design if wanted.

## 3. Parent account model — options (~~OPEN QUESTION~~ **Resolved 2026-10-05: Option 1**, A27 — see [../roadmap/open-questions.md](../roadmap/open-questions.md) item 2)

- **Option 1** (**selected by A27**): Parent is its own account type, linked to one or more Student accounts via a verified relationship (e.g. invite from the student's enrollment, or verified by the teacher/Markaz). *The verification examples in brackets are still proposals, not decisions.*
- **Option 2** (not selected): Parent is a "viewer" permission grant on an existing Student account, with no separate account type — simpler, but weaker for a parent with multiple children across different teachers.

History: on 2026-09-30 no default was assumed because the choice affects the schema (see [database.md](database.md)).

## 4. Permission matrix (PROPOSED — illustrative, not exhaustive)

| Capability | Super Admin | Markaz Admin (proposed) | Teacher | Parent (proposed) | Student | Visitor |
|---|---|---|---|---|---|---|
| Manage platform config | Yes | No | No | No | No | No |
| Manage a Markaz's teacher roster | Yes | Yes (own Markaz) | No | No | No | No |
| Create/manage own courses & classes | Yes | No (unless also a Teacher) | Yes (own) | No | No | No |
| View another teacher's private student corrections | No (support exception only, audited) | No | No | No | No | No |
| View own child's progress | N/A | N/A | N/A | Yes (linked children only) | N/A | No |
| Grant/revoke whiteboard write access in a live class | Yes | No | Yes (own class) | No | No | No |
| Join class via invitation link | N/A | N/A | N/A | N/A | Yes | No (must register first) |
| View public course catalog | Yes | Yes | Yes | Yes | Yes | Yes |

This table is illustrative to show the shape of the decision, not a final authorization spec — it must be reviewed and approved before being encoded into RLS policies (see [database.md](database.md) §3).

**2026-10-05 note:** the Markaz Admin column above predates A26. Rows that say "No" for operational actions inside the admin's own Markaz (e.g. "Create/manage own courses & classes", "Grant/revoke whiteboard write access") may not match A26's "broad operational authority". They are **left unchanged on purpose**: A26 says rows must be derived from system capabilities rather than invented. They must be re-derived before any RLS work (item 13). A28 also means every "own Markaz" / "own class" cell has to be evaluated **per Markaz membership**, because a Teacher may hold different roles in different Markaz.

## 5. Enforcement principle (APPROVED, per brief Part 4.3 and Part 9)

Authorization is enforced server-side / at the database layer (Postgres RLS) for every capability above where RLS can express it; UI hiding a control is a UX nicety, never the security boundary. See [security.md](security.md).

## 6. Cross-tenant isolation

A Teacher's queries are scoped to their own tenant/classes by RLS; a Markaz Admin's queries are scoped to their Markaz's teacher roster and shared settings, but explicitly **not** to each teacher's private student-correction data unless a future, separately-approved sharing mechanism exists. This directly implements A8.

**2026-10-05 note:** the "roster and shared settings" scope above was written for the narrower 2026-09-30 proposal. A26 approves broader operational authority *within* the Markaz, and its upper bound (no other tenants, no global settings, no Super Admin-only operations) is now fixed. The lower bound is not "roster and shared settings" any more; it waits on the re-derived permission rows (item 13). The private-correction exclusion still holds through A17 until the owner decides otherwise. A28 adds a second requirement: a Teacher's membership in Markaz X must never widen their access in Markaz Y.

### 2.10 Finance Officer / Accountant (2026-10-19, A140)

**Finance Officer/Accountant is a real non-teaching Markaz role.** **Teacher cannot verify payment.**

- Stored as a tenant membership `FINANCE_OFFICER` (same table and lifecycle as other roles: ACTIVE / ENDED, one row per Markaz). Never a Teacher, Markaz Admin, class teacher or Student.
- Role-derived permissions: `tenant:read` only. No roster, no members list, no explicit permissions (grants are for MARKAZ_ADMIN/TEACHER only).
- Invited by a Markaz Admin (own Markaz) or a Super Admin; a Teacher holding `invitation.create` cannot invite one.
- `payment.verify` is no longer a grantable permission (the five A47/A62 permissions remain).

| Action | Markaz Admin | Finance Officer | Teacher |
|---|---|---|---|
| Submit payment evidence | YES | YES | YES (assigned teacher of the class) |
| Verify payment | YES | YES | NO |
| Reject payment | YES | YES | NO |
| Finance page (payments, enrollment access periods) | YES | YES | NO |
| Class configuration | YES | NO | NO |
| Enroll student | YES | NO (activation only as a side effect of verification) | assigned Teacher only |
| Grace extension | YES | NO | assigned Teacher only |
| Waitlist order / capacity override | YES | NO | NO |
| Start/end session | YES | NO | assigned teaching roles |
| Attendance adjustment, mic, whiteboard, screen share, chat | existing rules | NO | existing rules |
| View corrections | existing rules | NO | existing rules |
| View recordings | existing rules | NO (not separately approved) | existing rules |
| Roster / detailed student data | existing rules | NO | existing rules |
