# Security

Status: **PROPOSED** approach to satisfy the **APPROVED** requirements in brief Part 9. See [../../DECISIONS.md](../../DECISIONS.md) A22.

## 1. Principle

Authentication proves *who*; it never implies *what they may access*. Every access decision is re-checked at the authorization layer — primarily Postgres RLS, backed by API-level checks for logic RLS cannot express (e.g. invitation-link rate limiting, cross-service checks against the RTC provider).

## 2. Multi-tenant authorization

- Postgres RLS on every tenant-scoped table, policies driven by JWT custom claims (tenant memberships + role) — see [database.md](database.md) §3 and [tenancy.md](tenancy.md).
- `service_role` key never reaches any client; used only from trusted server contexts.
- Automated tests must assert cross-tenant reads/writes are rejected, not just that same-tenant access works (see [../testing/security-tests.md](../testing/security-tests.md)).

### 2.1 Prisma, Supabase and RLS — where enforcement actually happens (IMPLEMENTED 2026-10-13)

There are two ways data is read, and they are protected differently. This must not be blurred.

| Path | Who uses it | Database role | Protected by |
|---|---|---|---|
| **Prisma** (server only: Server Components, Server Actions, route handlers) | `src/server/*` | The connection role in `DATABASE_URL` — on Supabase this role **bypasses RLS** | The **server-side authorization layer** (`src/server/authz/policy.ts`) called by every data-access function in `src/server/data/*` *before* it queries, plus tenant-scoped `where` clauses. RLS does **not** protect this path. |
| **Supabase Data API** (supabase-js / PostgREST with a user JWT) | Browser or server Supabase client | `authenticated` / `anon` | **RLS** policies in `prisma/migrations/20261013000100_supabase_auth_rls`. Read-only; there are no write policies, and `anon` has no privileges. |

Rules that follow:

- All writes go through the server (Prisma + authz). The Data API cannot write application tables.
- RLS and the TypeScript policy implement the **same rules** and are tested against the **same fixture** (`tests/support/fixture.ts`), so a drift between them shows up as a failing test.
- Authorization is computed from a fresh `Actor` on every request (`loadActor`) and is never cached, so revoking a membership or a parent link takes effect on the next request.
- The user id comes only from the verified Supabase token (`auth.getClaims()`), never from request input. Tenant and student ids from requests are validated as UUIDs; a foreign or malformed id is "not authorized", and not-found and not-authorized look the same to the caller.
- **Recommended before production** (not done — needs a live database): connect Prisma with a dedicated least-privilege database role rather than `postgres`, per Supabase's Prisma guidance. Optionally run Prisma queries under the `authenticated` role with JWT claims set per transaction, so RLS also guards server traffic — an architectural option to evaluate, not adopted now.
- Proxy (`src/proxy.ts`) only refreshes the session cookie; it is not an authorization layer.

## 3. Invitation-link security (for A2 — join without manual approval)

Requirements for the invitation mechanism (PROPOSED):

- Links are opaque tokens (not guessable sequential IDs), scoped to exactly one teacher or Markaz + a specific role.
- Expiry and optional max-redemption-count are enforced server-side at redemption time, not just at link-generation time.
- Redemption is rate-limited per IP/account to prevent brute-force enumeration of valid tokens.
- A redeemed link creates a membership row with exactly the scope encoded in the token — never an elevated role.
- Revocation: a teacher/admin can invalidate an unredeemed link at any time; already-redeemed memberships are not retroactively affected by revoking the link itself (removing a student is a separate action).

### 3.1 Implemented invitation security (2026-10-13)

- 256-bit random token (base64url), shown to the inviter once. Only its **SHA-256 hash** is stored, so a leaked database row cannot be turned into a working link.
- Acceptance takes the token only. Tenant, role and email come from the stored row, and the signed-in email must equal the invited email.
- Single use is enforced with a conditional update, so exactly one acceptance wins a race. Expiry and status are re-checked at acceptance time.
- Invitation tables are **not readable through the Data API** (no grant), which keeps hashes and emails server-only.
- At most one pending invitation per (Markaz, email, role), enforced by a partial unique index.
- Brute force: 256-bit tokens make guessing infeasible. Per-IP rate limiting of invitation pages is **not** implemented; Supabase's own OTP rate limits apply to code sending.
- The invite token appears in the URL path. `Referrer-Policy: strict-origin-when-cross-origin` stops it leaking to other sites, and invite pages are `noindex`.

### 3.2 Implemented sign-in security (2026-10-13)

- Email OTP / magic link only (A45). Plain sign-in uses `shouldCreateUser: false`; only the invitation flow can create an account. A test pins the server-action export surface, because **every export of a "use server" file is a public endpoint**.
- Unknown-email errors look like success (no account enumeration); only rate limiting is shown.
- Redirect targets are reduced to same-origin paths with the WHATWG URL parser (`src/lib/safe-redirect.ts`). Email links use `SITE_URL` from configuration, never the Host header.

### 3.3 Storage authorization (2026-10-13)

- Buckets are private. Object keys are server-generated, random, and carry no tenant/student/teacher ids. Who may read an object is decided from **database rows** (`correction_audio_clips` → `corrections`) by the server, which then mints a 5-minute signed URL. A key or path from the client is never used for authorization.
- The Supabase secret key is server-only and used only to mint signed URLs after authorization.

### 3.4 Parent-link and invitation security (2026-10-13)

- **No self-escalation:** a parent cannot verify or activate; staff cannot verify or activate a link they are party to; a teacher cannot assign permissions; a Markaz Admin cannot assign anything except `parent_link.verify`, only to their own Teachers, never to themselves.
- **No cross-tenant action:** every staff transition checks the permission in the link's own Markaz; grants in another Markaz are irrelevant (tested).
- **Atomic transitions:** a conditional update on the expected state plus an event row, in one transaction. Racing or illegal transitions change nothing. The database CHECK independently refuses states without their audit fields.
- **Parent self-request** never reveals whether a Markaz code, child email or link exists: the same response for every input (OQ33).
- **Invitations:** the target, Markaz and any proposed child are stored at creation, re-authorized there, and never read from the recipient. A proposed child yields only a PENDING request (A61). Exactly 7 days (A60): valid until 1 ms before `expires_at`, expired at `expires_at`.
- **History:** `parent_link_events` is append-only and not readable through the Data API.

### 3.5 Account creation and self-request hardening (2026-10-13)

- **Public sign-ups disabled by design:** `signInWithOtp` always uses `shouldCreateUser: false`. Invited accounts are created by the server through the Supabase admin API (`ensureAuthUserForInvitation`) only after the invitation token has been validated. So the Supabase project setting "allow new users to sign up" can and must be **off**, which closes the direct-to-Supabase sign-up bypass. Tests pin this.
- **Registration numbers** are identifiers, not secrets: random (not sequential or guessable), 8 characters, immutable. Using one only creates a PENDING request that staff must verify and activate.
- **Self-request is non-enumerating:** success, unknown Markaz, unknown or mismatched email or number, wrong Markaz, departed student and existing relationship all return the identical result (tested). Residual: response *timing* may differ slightly between paths (LOW; add constant-time padding if this becomes a concern).

### 3.6 Findings from real Supabase verification (2026-10-13)

| Finding | Severity | Cause | Fix |
|---|---|---|---|
| SECURITY DEFINER `public.handle_new_auth_user` was executable by `anon`/`authenticated` | LOW (trigger functions cannot be called directly) | Supabase grants EXECUTE on new public-schema functions to the API roles explicitly; `REVOKE ... FROM PUBLIC` does not remove that | Migration 0800 revokes it; the PGlite stand-in now copies Supabase's default function grants, so tests catch this class of issue |
| Sign-up test passed for the wrong reason | MEDIUM (test validity) | Supabase rejects `@example.com` in public auth flows | Tests now require `disable_signup=true` and the specific `signup_disabled` / `otp_disabled` errors |
| Public sign-ups were enabled in the project | HIGH until fixed | Dashboard default | Disabled by the owner; verified (`disable_signup=true`) |

Everything else matched the PGlite results: RLS for tenants, students, parents (only ACTIVE), roster, server-only tables, write refusal, no platform-admin bypass in SQL; Storage keys not readable by path, publicly or with a user JWT.

### 3.7 Recording & correction media (2026-10-14, A66–A80)

- **Authorization before signed URLs, as before** — now with A66: same-Markaz Markaz Admins may read corrections/clips; a departed teacher may not; an ACTIVE parent may across all of the child's Markaz.
- **Super Admin:** media reads are allowed only through the server, which writes `SUPER_ADMIN_MEDIA_READ` to `audit_events` **before** minting a URL (a failed audit write means no URL — tested). RLS deliberately has **no** Super Admin branch on corrections/clips/anchors, and the recording/consent/deletion/audit tables have **no Data API grant at all**, so there is no un-audited path.
- **Date of birth** is server-only: the Data API keeps column-level SELECT on `student_accounts(profile_id, created_at)` only.
- **Audit trail** (`audit_events`) is append-only: UPDATE/DELETE/TRUNCATE are refused by triggers for every role, including the owner. It never stores signed URLs, object keys or DOB values.
- **Media validation:** finalized clips are AAC in M4A ≤ 60 s as measured by the server from the stored bytes (ranged reads of box headers and `moov` only; parse budget 1 MiB for metadata — an engineering bound, not a file-size limit). A DB CHECK repeats the rule for finalized rows.
- **Purge safety:** bytes are removed only by `purgeExpiredMedia` after `purge_eligible_at` (30 days after approval); DB CHECKs refuse a purge timestamp before the grace period or without a deletion. Rows are never deleted.
- **Object keys** stay random and carry no tenant/student/teacher ids (clips, recordings, segments).

### 3.8 Media policy decisions (2026-10-15, A81–A91)

- DOB remains server-only (new verification columns included). A Markaz Admin sees the DOB **value** only while it awaits their verification; otherwise only its state.
- Deletion self-approval is impossible in the service **and** in the database (`deletion_no_self_approval`); cancellation only by the requester (`deletion_cancel_by_requester`).
- `recording_entitlements` is server-only (no Data API grant). Only a Super Admin enables Option C.
- Oversized clips (> 10 MB) are rejected from `stat` alone — no bytes are downloaded.

### 3.9 2026-10-16 (A92–A98)

- DB CHECKs added: `student_dob_not_self_verified` (verifier ≠ enterer), `entitlement_cancel_by_requester`, and a rebuilt `entitlement_status_fields`.
- Historical recording visibility uses the consent snapshot taken at capture (`audio_included`), never "current consent", so a later withdrawal cannot silently change past visibility; it triggers review instead.
- Offline consent stays tenant-scoped in the pure policy (`tenantId === recording/correction tenant`).

### 3.10 Live Class foundation (2026-10-19, A101–A130)

- **Authorization before access.** Every Live Class service loads only the class/session context it needs (unknown or malformed ids look exactly like forbidden ones), asks the pure rules in `src/server/authz/live-class.ts`, then queries. Tests assert that a refused class creation never reaches the database.
- **Tenant isolation at three layers:** (1) pure rules require an ACTIVE membership in the class's Markaz; (2) composite `(id, tenant_id)` foreign keys make a cross-Markaz pointer impossible (class ↔ schedule/enrollment/session/chat/recording); (3) the `app.require_active_membership` trigger refuses a teacher assignment, enrollment, substitute or payment submission for someone without the right ACTIVE membership in the same Markaz (the function is not executable by API roles).
- **Server-only tables (A128).** All 12 Live Class tables have RLS enabled and **no** grants or policies for `anon`/`authenticated` — raw presence (`live_session_connections`), payment evidence references, override records, waitlist, grace extensions, attendance and chat are reachable only through the server. The new `tenants` columns (time zone, capacity ceilings) inherit the existing tenant-member read policy; they are not sensitive.
- **Operational vs teaching authority (A115).** A Markaz Admin can operate (start/end, remove, mic, attendance) but has no whiteboard, screen-share or audio capability by role; teaching authority always needs an ACTIVE Teacher membership plus an assignment (or the session's substitute slot).
- **Device boundary (A121).** `getMyDeviceCapabilities()` re-checks enrollment access and membership on every call; a VIEW_ONLY device never publishes mic or writes the whiteboard. A future RTC adapter must issue provider tokens only from this answer.
- **Recording consent (A125).** Live join/mic never consult consent; capture does. Late joiners' audio is excluded until their check passes (`audio_included_from`); corrections exclude rather than delete and are audited; an excluded participant never qualifies as a viewer.
- **Parents (A127)** get attendance status + class + session date only — the service never selects durations or connection timestamps; no chat, no live view.
- **Audit (A129)** covers class, teacher, capacity override, enrollment transitions (system transitions with a null actor), grace, payment submit/verify/reject, session create/start/end/safety close/cancel/substitute, participant removal, mic and whiteboard grants/revocations, attendance adjustments (from/to) and recording participant corrections. Evidence references, reasons for payment and chat bodies are never copied into audit metadata.
- **No RTC.** A unit test fails if a LiveKit/Agora package, a `pilot/` import or a Supabase Realtime `.channel(` appears in `src/`.

### 3.11 Final Live Class corrections (2026-10-19, A131–A139)

- **Finance authority** is an explicit tenant permission (`payment.verify`): never implied by a role, tenant-scoped, effective only for an ACTIVE staff member, mirrored by `app.has_tenant_permission` (no SQL change needed — it already restricts holders to Markaz Admin/Teacher). No platform bypass.
- **Fail closed on time zone:** no scheduling path falls back to UTC.
- **No silent capacity changes:** SUSPENDED/PENDING_PAYMENT students regain access only through a free seat or an audited admin override; out-of-order admission needs an audited admin reason.
- **Mic handoff** happens under a session lock in one transaction; the DB partial unique index still guarantees one student holder.
- **Detailed student data** (A137) is decided server-side from current assignments and effective enrollment state; substitutes get none.
- Parents still never receive durations or raw join/leave times — now also covering punctuality, which is a status only.

### 3.12 Finance Officer role (2026-10-19, A140)

- **Teacher cannot verify payment** (service rule + no grant path: `payment.verify` is removed from the grantable list and refused by a DB CHECK).
- Finance Officer/Accountant is a real non-teaching role. Authority comes only from an ACTIVE membership in that exact Markaz; ending it removes authority at once; cross-tenant access is impossible.
- Least privilege is structural: the role has only `tenant:read`, is not eligible for explicit permissions, is not a Live Class participant role, and no RLS policy except the own-tenant read names it. Tests assert denial of class configuration, enrollment management, grace, waitlist/capacity overrides, sessions, attendance, mic, whiteboard, chat, corrections, recordings, roster and detailed student data.
- The finance listings select only student name, class name/payment flag, enrollment state and access period, plus submission coverage/reference/period/status.

## 4. Recording consent & private annotation leakage

- Lesson recording must have a clear consent/notice model — ~~OPEN QUESTION~~ **APPROVED 2026-10-05 (A30)**: (1) general consent during enrollment/account setup **and** (2) a clear notice when recording begins; general consent alone is not sufficient UX. This applies to any recorded audio, including Option B correction clips (A29). Retention/deletion: see §7. Still open: consent on behalf of minors (open question 17).
- Because private per-student corrections must never leak to other students (A17), and because recordings/screen-shares are broadcast to the whole class, the architecture keeps private-annotation data **out of** any shared broadcast/recording stream entirely — it lives in a separate, visibility-scoped data channel/table that is only ever rendered to the correction's owner + the teacher. This is why [architecture.md](architecture.md) treats whiteboard-op-log recording and audio recording as separate concerns rather than "record the screen." See [../features/student-corrections.md](../features/student-corrections.md).

## 5. Role-based permissions & access revocation

- Permission grants (e.g. whiteboard write access) are checked server-side at the moment of the write operation, not only at session start — so a mid-class revocation takes effect immediately (A16).
- Removing a student from a teacher/Markaz revokes their membership row and, by RLS, all further access to that tenant's data going forward; historical records of their own past submissions remain visible to them per normal student self-access rules unless explicitly deleted.
  - **2026-10-05 (A32):** approved as business direction — a departed Student keeps their own personal submissions/corrections; restricted/licensed Markaz content may be removed. Implementation consequence: RLS for a student's *own* records cannot depend only on an active membership row, because that row is revoked on departure. Open edge cases: items 19 and 20 in [../roadmap/open-questions.md](../roadmap/open-questions.md).
- **Multi-Markaz Teachers (A28):** a Teacher's permissions must be evaluated against the specific Markaz membership in play, never a union across all their memberships.

## 6. Audit logs

*2026-10-14:* implemented for media and consent (A80) — `audit_events`, append-only; see §3.7. The rest of the list below remains proposed.

Sensitive actions requiring an audit trail (PROPOSED list, to be finalized with the owner): recording start/stop, whiteboard write-permission grants/revocations, role changes, data exports, invitation-link creation/revocation, payment refunds. Audit entries are append-only and readable by Super Admin (and, scoped to their own tenant, by Teacher/Markaz Admin for their own actions).

## 7. Data retention & backups

*2026-10-14:* media deletion mechanics decided and implemented (A73–A75): request → Markaz Admin approval → soft delete + archive → 30-day grace → purge of bytes only; metadata/history kept. Abandoned-upload cleanup exists but its age is undecided (open question 37). Database backup policy is still open.

- Database backups: rely on Supabase's managed backup capability at whatever tier is provisioned; explicit retention/restore-testing policy is an **OPEN QUESTION** pending infrastructure approval.
- Recording retention period — ~~OPEN QUESTION~~ **business direction APPROVED 2026-10-05 (A31)**: recordings remain available until an authorized user deletes them, subject to the project's retention/deletion policy. **Not approved / still implementation details** (open question 16): who is an authorized deleter; soft vs hard delete; grace period; archival; storage garbage collection; legal hold. Interaction to resolve: deleting a recording must not silently destroy a departed student's retained correction context (A32) — depends on open question 15. Storage: Supabase Storage (A38); correction-storage choice: A29 ([../features/student-corrections.md](../features/student-corrections.md)).

## 8. Child protection considerations

*2026-10-14:* A70–A72 implemented — DOB stored (server-only), minor status derived; guardian online or Markaz-Admin-verified offline consent; one policy for clips and recordings; without consent a student still participates live but is never recorded. **Fail-closed** until the owner sets the age threshold (open question 34) and the adult consent flow (35).

Given the student population includes minors:

- Minimize personally identifying information collected at self-registration; parental linkage (model decided 2026-10-05: separate Parent account type, A27 — see [roles-permissions.md](roles-permissions.md) §3; verification method still open) should not require exposing a child's contact details to the platform, if avoidable.
- Recording consent (§4) is especially important where minors are recorded. A30 fixes the two-step shape (enrollment consent + start-of-recording notice), but *who* consents for a minor still needs explicit legal/owner guidance appropriate to the jurisdictions served, which is outside this document's authority to decide (open question 17).
- Teacher-to-student private messaging is **not** in the confirmed feature set (chat is classroom-question-only, per A13) — this should stay a deliberate boundary, not an accidental omission, when chat is implemented.

## 9. What this document does not do

It does not implement any of the above. It does not select a specific audit-log schema or backup-retention number — those require owner sign-off (see [../../DECISIONS.md](../../DECISIONS.md) §2 authorization boundaries).
