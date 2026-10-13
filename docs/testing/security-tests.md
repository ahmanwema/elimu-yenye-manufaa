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

Not automated yet: UI/E2E flows, real Supabase Auth (OTP emails, `/auth/confirm`), real Storage signed URLs.

## Method

Prefer integration tests running against a real (test) Postgres instance with RLS enabled — testing RLS policies by mocking them defeats the purpose, since the policies themselves are the thing under test.

## Reporting

Findings should be tracked and, where they reveal a genuine gap, fed back into [../system/security.md](../system/security.md) or the relevant feature doc rather than only living in a test report.
