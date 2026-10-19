# Test Strategy

Status: **PROPOSED**.

## Principle

Type checking and unit/integration test suites verify code *correctness*; they do not verify feature *correctness* on real hardware/network conditions — especially critical here given the XPPen Deco 640 and mobile-network dependencies. Both layers are required, and neither substitutes for the other.

## Layers

1. **Unit tests** — pure logic: permission-check functions, operation-log ordering/compaction, grading-method dispatch.
2. **Integration tests** — database-level: RLS policy behavior (see [security-tests.md](security-tests.md)), API route behavior against a real (test) Supabase instance.
3. **End-to-end tests** — simulated multi-client scenarios: teacher writes, student sees it; permission grant/revoke propagation; late-join snapshot correctness.
4. **Manual hardware/device testing** — cannot be fully automated: XPPen Deco 640 pointer/pressure behavior in real Chrome ([device-compatibility.md](device-compatibility.md)), real mobile network conditions.
5. **Acceptance testing** — feature-level sign-off against the acceptance criteria defined in each feature doc under `docs/features/`.

**As implemented (2026-10-19):** layers 1–2 run locally with `npm test` (Vitest; pure rules + real migrations, RLS and Prisma services on in-process PGlite), plus the real DEV Supabase suite (`npm run test:dev-supabase`) and the UI E2E (`scripts/dev-e2e.mjs`). Time-dependent Live Class rules take an explicit `now`, so windows (−15/+15/+30 minutes, 7-day grace) are tested deterministically. Layer 3 multi-client media tests and layer 4 hardware tests wait for the RTC vendor (A35).

## Ownership

Each feature's own documentation (e.g. [../features/live-class.md](../features/live-class.md)) defines its specific acceptance criteria and testing requirements; this document defines the shared methodology, not feature-specific cases.

## What must never be skipped

- Cross-tenant/cross-account access-denial tests ([security-tests.md](security-tests.md)) — these are the tests most likely to be under-written because "the happy path worked" is not evidence of correct isolation.
- Real hardware testing before claiming XPPen Deco 640 compatibility ([device-compatibility.md](device-compatibility.md)) — manufacturer OS-compatibility claims are not the same claim as "works with our custom browser whiteboard via Pointer Events," per brief 4.1's explicit caution.
