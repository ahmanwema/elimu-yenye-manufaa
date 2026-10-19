# Feature: Plans & Payments

Status: **PROPOSED** analysis; **no pricing, commission percentages, or subscription limits are decided or invented here**, per explicit brief instruction (Part 8). Not in Phase 1 scope.

> **2026-10-13:** Not implemented. The local foundation deliberately contains **no** payment, plan, tuition, subscription, add-on or entitlement tables — not even placeholders — so that the five A34 concepts are designed properly when Phase 3 is authorized. No prices, billing cycles, capacity limits or entitlement rules exist anywhere in code.
>
> **2026-10-19 (A107–A109) — partly superseded:** a deliberately NARROW manual payment/access foundation now exists for Live Class enrollments only:
> - `access_payment_submissions` (+ `access_payment_submission_enrollments`): an assigned teacher or a Markaz Admin **submits** evidence for an access period (`coverage_note` describes the class/subject/package as the Markaz sees it; `evidence_reference` is a receipt/transaction reference — never the evidence itself, never copied to the audit trail). A submission grants nothing.
> - Only a **Markaz Admin verifies** (A107; a teacher never does). Verification extends each covered enrollment's `access_until` and returns GRACE/SUSPENDED enrollments to ACTIVE. Rejection leaves access untouched. All steps are audited.
> - Grace (A108): 7 days by default after `access_until`, extendable by an assigned teacher or Markaz Admin with a reason (no maximum).
> - Plan **capacity ceilings** per Markaz (`tenants.class_enrollment_capacity_max`, `class_live_capacity_max`), set by a Super Admin; NULL = none. **No numbers are defined.**
> - There is still **no** amount, currency, price, provider, gateway, M-Pesa/Airtel integration, invoice, tax, refund, partial payment, subscription or revenue-share field or logic. The five A34 concepts remain undesigned. Remaining decisions: [../roadmap/open-questions.md](../roadmap/open-questions.md) items 55 and 57.
>
> **2026-10-19 final corrections (A135, A136, A139):** each class has `payment_required` (default **false** — not every class is paid). For a paid class a new enrollment is PENDING_PAYMENT until a payment is VERIFIED; then it becomes ACTIVE (or WAITLISTED when the class is full). Verification: the Markaz Admin by role, or anyone holding the explicit tenant permission **`payment.verify`** (Finance Officer / Accountant). A Teacher may submit evidence but never verifies by default. **[Superseded by A140, 2026-10-19:]** verification and rejection belong to the Markaz Admin and the dedicated **`FINANCE_OFFICER`** role only; `payment.verify` can no longer be granted; **a Teacher cannot verify payment**. Finance Officers use the Finance page (`/[locale]/markaz/[tenantId]/finance`), which shows only payment submissions and enrollment access periods. Plan ceilings: Super Admin (numbers still open). Still undecided: amounts, currency, gateways (M-Pesa / Airtel), invoices, tax, refunds, partial payments, revenue share, and how the five A34 concepts relate (item 6).

## Purpose

Support free and paid access to the platform via monthly subscriptions and course-based payments, using M-Pesa and Airtel Money as payment methods, while the exact relationship between tuition, course payments, and platform/teacher-level subscriptions is still being defined by the project owner.

## User roles

Student/parent (payer), Teacher (may have their own platform subscription tier), Markaz (may have an institution-level subscription), Super Admin (plan/pricing configuration, once decided).

## Approved commercial structure (A34, owner decision BR-09, 2026-10-05)

The platform uses a **hybrid** commercial model. The following are **separate concepts** and must not be collapsed into one generic "payment type" in documentation, data model, or UI:

| # | Concept | Payer → payee (as far as decided) | Status |
|---|---|---|---|
| 1 | Platform-level plans | Not decided (student tier, teacher/Markaz operating tier, or both — question 3 below) | Concept approved; terms open |
| 2 | Markaz tuition | Student/Parent → Markaz (implied by the name; mechanics open) | Concept approved; terms open |
| 3 | Teacher-level subscriptions | Not decided (question 2 below) | Concept approved; terms open |
| 4 | Paid courses | Not decided | Concept approved; terms open |
| 5 | Optional paid features/add-ons (e.g. full-session recording, Option C — A29) | Not decided | Concept approved; terms open |

**Not decided** (do not invent): prices, revenue sharing / commission, subscription durations, renewal/grace rules, the Option C add-on price, and how the concepts interact (questions below). Payment methods remain M-Pesa and Airtel Money (A21).

## Business model questions requiring owner decision (this is the core content of this doc — see [../roadmap/open-questions.md](../roadmap/open-questions.md) item 6)

> 2026-10-05: A34 settles that all of these payment paths exist as **distinct** concepts. The questions below are about how they relate to each other and remain **open**, except where noted.

1. **Monthly tuition vs. course payment**: is monthly tuition a per-teacher relationship (student pays their teacher monthly), a per-Markaz relationship, or a platform-level subscription that unlocks access broadly? The brief notes "the latest requirements emphasize monthly tuition" but does not resolve how it relates to course-based payment — these could be two independent payment paths (recurring tuition *and* one-off course purchases) or mutually exclusive per course.
2. **Teacher-level subscription**: does an independent teacher pay the *platform* a subscription to operate (e.g. to unlock Live Class capacity/features), separate from what students pay the teacher? If so, is teacher-subscription tier what determines class-capacity limits referenced in A15?
3. **Platform-level plans**: are "free and paid plans" (A21) primarily about the *student's* access tier, the *teacher's* operating tier, or both independently?
4. **Markaz billing**: does a Markaz pay one institutional subscription covering all its teachers, or does each teacher within a Markaz have their own billing relationship?

None of these are answered by the brief; a concrete proposal here would risk inventing business terms the brief explicitly warns against. (2026-10-05: A34 does not answer them either — it fixes the *set* of concepts, not their relationships.)

5. **Entitlements** (raised 2026-10-05): once several payment paths can each unlock access (tuition, course purchase, plan, add-on), which one grants which access, and what happens to access when one lapses while another is still active? This is not decided. It shapes whether an entitlement/access-grant concept is needed separately from payment records.

## Functional requirements (structural only, no numbers)

- Payment methods: M-Pesa, Airtel Money (A21) — both are mobile-money APIs common in East Africa; integration requires each provider's merchant/API onboarding, which is a business/legal step, not just a technical one.
- Subscription billing: recurring monthly charge, needs a defined renewal/grace-period/failure-retry behavior once the model above is settled.
- Course-based payment: one-off purchase unlocking a specific course, independent of subscription status (or not — see open question 1 above).

## Data requirements

Plans, subscriptions, course purchases, provider transaction records, invoices — see [../system/database.md](../system/database.md) §2. No schema detail is proposed here because it depends entirely on the open business-model questions above. Constraint from A34: whatever schema is later proposed must keep the five commercial concepts distinguishable. A single undifferentiated "payment" record is not acceptable as the model of record.

## Permissions

Only Super Admin (platform-level) or the relevant tenant owner (once the model is settled) can configure pricing/plans; payment records are visible only to the payer and relevant admin, never cross-tenant.

## UI states, error handling, edge cases, security considerations

Deferred until the business model is settled — designing these prematurely risks encoding an unapproved assumption into the UI/data model.

## Dependencies

[../system/tenancy.md](../system/tenancy.md) (who bills whom depends on the tenant model), [live-class.md](live-class.md) (A15 ties class capacity to "plan").

## Acceptance criteria / testing requirements

Not defined — this feature cannot be meaningfully specified further until the open questions above are resolved.

## Open questions

All four business-model questions above, consolidated in [../roadmap/open-questions.md](../roadmap/open-questions.md) item 6. This is the single most business-critical open question in the entire project, since it affects tenancy, roles, and Live Class capacity design.
