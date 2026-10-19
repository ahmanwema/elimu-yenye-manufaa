# Security Testing

Status: **PROPOSED**.

## Principle

"The happy path worked" is not evidence of correct isolation. Every access-control claim in the documentation needs a corresponding *negative* test proving the denial actually happens, not just that the allowed case works.

## Required negative test categories

1. **Cross-tenant isolation**: Teacher A's API/DB queries must never return Teacher B's students, courses, or corrections, even when IDs are guessed/enumerated. ([../system/tenancy.md](../system/tenancy.md), [../system/security.md](../system/security.md))
2. **Cross-student private-data isolation**: Student A must never be able to read Student B's private corrections, submissions, or grades, including via the recorded-lesson replay path. ([../features/student-corrections.md](../features/student-corrections.md))
3. **Markaz Admin boundary**: A Markaz Admin must not see a teacher's private student corrections within their own institution unless a future sharing mechanism is explicitly built and approved. ([../system/roles-permissions.md](../system/roles-permissions.md))
4. **Permission-revocation immediacy**: Revoking a student's whiteboard-write or mic access must reject further actions from that client immediately at the server, not merely hide the control client-side. ([../system/security.md](../system/security.md) §5)
5. **Invitation-link abuse**: expired links, exceeded max-use links, and role-scope tampering attempts must all be rejected server-side; redemption must be rate-limited against brute-force enumeration. ([../system/security.md](../system/security.md) §3)
6. **service_role key exposure**: automated check (e.g. a build/CI secret-scan) that the Supabase `service_role` key never ships in any client bundle.
7. **Broadcast/recording leakage**: automated test asserting that a private-visibility whiteboard operation is never present in any payload sent to a non-owner client or in a class-wide recording export. ([../features/student-corrections.md](../features/student-corrections.md))
8. **Parent access boundary** (parent account model approved 2026-10-05, A27; scope still open): a parent must only ever see their explicitly linked child/children, never other students.

*2026-10-05 note:* A26–A28 and A32 imply further negative-test categories, including multi-Markaz teacher cross-tenant leakage, Markaz Admin cross-tenant denial, and departed-student retained-vs-removed access. They are **not** added here yet. They will be written with the implementation plan for those areas, once open questions 13, 14, 19 and 20 are answered.

## Implemented negative tests (2026-10-13 foundation)

Every scenario runs at **two layers** against one shared fixture (`tests/support/fixture.ts`):

| Scenario | Server authz (`tests/unit/policy.test.ts`, `data-access.test.ts`) | RLS (`tests/db/rls.test.ts`) |
|---|---|---|
| Markaz A admin cannot read Markaz B (including by id) | ✓ | ✓ |
| Teacher in A+B works in both; teacher in A only cannot see B | ✓ | ✓ |
| A teacher's role in one Markaz does not grant admin rights, or anything in another Markaz | ✓ | ✓ |
| Student X cannot read Student Y | ✓ | ✓ |
| ACTIVE parent sees only the linked child; VERIFIED / PENDING / REVOKED / unlinked parents see nothing | ✓ | ✓ |
| Departed student keeps own records, loses Markaz access | ✓ | ✓ |
| Tenant-id manipulation (foreign, random, malformed, array/object, SQL-like) | ✓ | ✓ (by-id queries) |
| Denied requests never reach the database | ✓ | — |
| No self-granting of platform admin, memberships, link activation; no direct writes | — | ✓ |
| Anonymous requests read nothing; a forged claim for an unknown user sees nothing | — | ✓ |

Schema integrity (`tests/db/schema.test.ts`): profile ↔ auth user mapping, trigger creates no role, unique memberships, ENDED/ended_at check, enum rejects SUPER_ADMIN/PARENT as tenant roles, link uniqueness/self-link/account-type FKs.

**Mutation check performed:** weakening the `tenants` policy to `USING (true)` and letting any non-revoked parent link grant access made 9 RLS tests fail. The suite detects real policy regressions.

**Limits:** the database tests use PGlite with a minimal Supabase stand-in (`tests/db/harness.ts`: `anon`/`authenticated` roles, `auth.users`, Supabase's `auth.uid()` definition). They do not exercise PostgREST, real JWT verification, pooling, or a hosted project's exact role attributes. Re-run against a Supabase local stack (`supabase start`) before relying on them for a release. Category 6 (service_role key never in client bundles) is not automated yet.

## Phase 2A tests (2026-10-13)

Service tests run **real Prisma Client over PGlite** (`pglite-prisma-adapter`, test-only) with the real migrations and fixture, so transactions, conditional updates and unique-index races are exercised. A call-recording proxy (`spyDb`) proves denied actors never reach the database.

| Area | File |
|---|---|
| Invitations (tenant-bound, expired/invalid/revoked/reused, email mismatch, tampered tenant/role ignored, cross-tenant abuse, accept race) | `tests/services/invitations.test.ts` |
| Parent-link verification (explicit permission, tenant boundary, no Super Admin bypass, no self-verification, PENDING-only, ACTIVE-only access) | `tests/services/parent-links.test.ts` |
| Teacher basic roster + explicit grants | `tests/services/roster-permissions.test.ts` |
| Markaz Admin appointment (request scope, duplicates incl. race, Super Admin-only review, no self-approval, candidate re-check) | `tests/services/appointments.test.ts` |
| Correction audio (standalone object, provenance detach, playback authorization, DB CHECKs, RLS parity) | `tests/services/correction-audio.test.ts` |
| RLS for new tables/policies | `tests/db/rls-phase2a.test.ts` |
| Redirect safety, OTP error handling, **server-action export surface** | `tests/unit/auth-safety.test.ts` |
| Locale default/persistence/fallback/RTL, dictionary completeness | `tests/unit/i18n.test.ts` |
| Policy rules (grants, roster, invitations, parent contract, detail hook) | `tests/unit/policy-phase2a.test.ts` |

**Mutation check (2026-10-13):** six deliberate weakenings were each caught by the suite: grant ignores role eligibility (2 failures), parent access on any non-revoked link (10), self-verification allowed (1), invite email check skipped (1), RLS grant ignores revocation (1), Markaz Admin may review appointments (1). All files restored; 275/275 pass.

Not automated in the local suite: UI/E2E flows, real Supabase Auth and real Storage — those run in `tests/real` and `scripts/dev-e2e.mjs` against the development project (stale note corrected 2026-10-14).

## Recording & correction media tests (2026-10-14)

| Area | File |
|---|---|
| Access matrix incl. departed teacher, same/cross-Markaz admin, ACTIVE/other parents, audited Super Admin; deletion/approval authority | `tests/unit/policy-media.test.ts` |
| DOB-derived minor status; consent eligibility; fail-closed defaults | `tests/unit/recording-consent.test.ts` |
| M4A/AAC container inspection (duration, codec, audio-only, truncation, moov-last, fragmented, parse budget) | `tests/unit/m4a.test.ts` |
| Clip capture with consent gate, server-side format/duration, primary/history, extraction from a real recording, playback matrix, Super Admin audit (and no URL if the audit fails), cross-Markaz parent, RLS parity | `tests/services/correction-audio.test.ts` |
| DOB recording, guardian/offline consent, withdrawal → review requests (no deletion), live participation ≠ eligibility | `tests/services/consent.test.ts` |
| Correction model (annotation, note, timestamp, anchors, snapshots), Option B with zero recordings | `tests/services/corrections.test.ts` |
| Recording states, notice, submit/approve/revoke, parent gates, segments, audited Super Admin | `tests/services/recordings.test.ts` |
| Deletion request/approval, immediate hiding, 30-day purge, history retained, append-only audit, abandoned uploads | `tests/services/media-deletion.test.ts` |
| Data API: server-only tables, DOB column hidden, anchors follow corrections, no writes | `tests/db/rls-media.test.ts` |

Not covered locally: a real browser-recorded M4A file (no ffmpeg/sample file on this machine — the parser is tested on spec-built files), and the real-Supabase run of the updated `tests/real` storage test (needs the new migrations on the dev project — owner approval).

## Media policy decisions tests (2026-10-15)

| Area | File |
|---|---|
| Under-18 boundary by date, unverified DOB, adult/minor eligibility | `tests/unit/recording-consent.test.ts` |
| DOB entry/verification, adult & minor consent, withdrawal actors | `tests/services/consent.test.ts` |
| 10 MB limit (exact boundary, no read of oversized files), current-clip selection | `tests/services/correction-audio.test.ts` |
| Reject / resubmit after rejection or revocation, teacher notice, Option C gate | `tests/services/recordings.test.ts` |
| Cancel / decline, second-admin rule (service + DB), single-admin pending, 7-day cleanup (boundary, idempotent, failure-safe) | `tests/services/media-deletion.test.ts` |
| Option C request/enable, entitlement-only model | `tests/services/option-c.test.ts` |
| New policy helpers; server-only entitlement table; DOB verification columns hidden | `tests/unit/policy-media.test.ts`, `tests/db/rls-media.test.ts` |

## 2026-10-16 tests (A92–A98)

| Area | File |
|---|---|
| Admin author approves/rejects own recording; teacher and other-Markaz admin cannot; deletion self-approval still refused | `tests/services/recordings.test.ts`, `tests/unit/policy-media.test.ts` |
| Student own-recording access and every denial gate; departed student (interim); consent valid at capture vs later withdrawal; never-valid consent; offline consent Markaz-specific | `tests/services/recordings.test.ts` |
| DOB self-verification refused (service + DB); student/guardian entry verified by admin; single-admin Markaz stays unverified | `tests/services/consent.test.ts` |
| Option C cancel/decline/enable/disable, audit, history kept after disable, DB consistency | `tests/services/option-c.test.ts` |
| 10 MB = 10,485,760 bytes | `tests/unit/policy-media.test.ts`, `tests/services/correction-audio.test.ts` |

## Real DEV Supabase media verification (2026-10-16)

`tests/real/media-dev.test.ts` (run with `npm run test:dev-supabase`) checks on the real project:
- **Bucket:** private / `audio/mp4` / 10,485,760.
- **Uploads:** exactly 10,485,760 bytes accepted end to end; one byte more and non-audio/mp4 uploads refused by the bucket.
- **Clips:** signed upload, server inspection and playback; no public or direct read.
- **RLS via PostgREST:** student, same-Markaz admin and ACTIVE parent across Markaz see corrections; VERIFIED parent and Super Admin see none; DOB column denied.
- **Consent and DOB:** departed student keeps own corrections; unverified DOB; self-verification refused (service + DB) and a second admin verifies; adult self-consent; guardian consent in both Markaz; offline consent in its own Markaz only.
- **Deletion:** cancel / decline / self-approval refused / second-admin approval / hidden / no early purge.
- **Option C:** full lifecycle including re-request as a new cycle.
- **Recordings (DB-only media):**
  - admin author approves/rejects own recording; teachers and other-Markaz admins cannot;
  - consent valid at capture — later withdrawal stays visible and goes to review; future capture blocked;
  - departed student denied (A99); never-consented child never visible.
- **Super Admin:** audited clip read.

## Live Class foundation tests (2026-10-19, A101–A130)

| Area | File |
|---|---|
| Role/action matrix (Primary, Co-Teacher, Substitute, Markaz Admin, student, parent, other-Markaz admin, Super Admin); operational vs teaching; departed teacher; cross-Markaz context | `tests/unit/live-class-rules.test.ts` |
| Time zone (UTC storage, Markaz-local interpretation, DST), windows (−15 join/start, +30 safety close, +15 late), grace, attendance union/precedence, capacity ceilings, device capabilities | `tests/unit/live-class-rules.test.ts` |
| Class tenancy, one Primary (service + partial index), many Co-Teachers, replacement not silent, departed teacher keeps history, cross-tenant assignment (service + trigger), listing scope, refused request reaches no DB call | `tests/services/classes.test.ts` |
| Enrollment eligibility (ACTIVE student membership + explicit enrollment; service + trigger), who enrolls, multi-class, history; capacity → WAITLIST, admin override audited, teacher cannot override, FIFO admission | `tests/services/classes.test.ts` |
| Payment: submission ≠ verification, only Markaz Admin verifies, renewal restores access, package coverage, no evidence in audit, no amount/currency columns; grace 7 days, expiry → GRACE → SUSPENDED (system audit), extension by teacher/admin with stored fields, unrelated teacher denied | `tests/services/classes.test.ts` |
| Scheduling and lifecycle (UTC/Markaz zone, recurring idempotent generation, early start/join, cancellation actors, safety close, ad hoc default, one LIVE per class, Option C at start), substitute rules (incl. DB trigger) | `tests/services/live-sessions.test.ts` |
| Join eligibility (suspended/waitlisted/ended/none/parent/other Markaz), live capacity → WAITING_FOR_SLOT and promotion, devices (primary + view-only, third refused, no double slot), removal | `tests/services/live-sessions.test.ts` |
| One student mic (service + partial index), mic/whiteboard actors, view-only device never publishes, admin no teaching capabilities, grants cleared on disconnect, access lapse removes capabilities | `tests/services/live-sessions.test.ts` |
| Attendance accumulation (reconnect + second device), LATE/ABSENT/PRESENT, manual adjustment actors + audit, parent sees status only, raw attendance staff-only | `tests/services/live-sessions.test.ts` |
| Chat persistence, authorship, waiting student cannot post, class/Markaz isolation, parent/unrelated denied, substitute session-only, suspended student loses history | `tests/services/live-sessions.test.ts` |
| Recording: session FK (cross-tenant refused), Option C at session start and recording start, presence participants, consent snapshot, late joiner excluded until consent passes (live unaffected), free-form list refused, corrections (actors, enrolled-only, frozen after finalization, audited), excluded participant never a viewer | `tests/services/live-recording.test.ts` |
| All 12 Live Class tables server-only (every role + anon), no Data API writes, RLS enabled, guard function not executable, composite FKs, partial indexes, status CHECKs | `tests/db/rls-live-class.test.ts` |
| Action surface pinned (job entry points never exported); no LiveKit/Agora package, no `pilot/` import, no Realtime `.channel(` in `src/` | `tests/unit/auth-safety.test.ts` |

## Method

Prefer integration tests running against a real (test) Postgres instance with RLS enabled — testing RLS policies by mocking them defeats the purpose, since the policies themselves are the thing under test.

## Reporting

Findings should be tracked and, where they reveal a genuine gap, fed back into [../system/security.md](../system/security.md) or the relevant feature doc rather than only living in a test report.
