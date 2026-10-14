# Feature: Lesson Recording & Audio

Status: **PROPOSED**, supporting **APPROVED** requirement A13 (lesson recording) and A18 (students submit recitation audio). Business rules approved 2026-10-05 that constrain this design: full-session recording is the optional **Option C add-on**, not required for corrections (A29); consent = enrollment consent **and** start-of-recording notice (A30); retention until an authorized user deletes, subject to policy (A31); storage = Supabase Storage for now (A38). See [../../DECISIONS.md](../../DECISIONS.md).

## Purpose

Capture a live class's audio (and the whiteboard's parallel activity log) for later replay, and let students submit standalone recitation audio for teacher review — both without leaking private per-student data across accounts.

## User roles

Teacher (recording control, reviews student submissions), Student (submits recitation audio, later reviews own recording/corrections).

## User journey — class recording

1. Teacher starts the class; recording begins only if enabled. Full-session recording is the optional Option C add-on (A29). Consent per A30: participants must already have given general consent at enrollment/account setup, **and** a clear notice is shown when recording begins.
2. Teacher's mic audio is captured continuously by the RTC provider's recording/egress capability. *(2026-10-13: stale as a default — full-session recording is the optional Option C add-on (A29/A44). This step applies only when that add-on is enabled. Short correction clips can be captured without it; see [../testing/rtc-pilot-results.md](../testing/rtc-pilot-results.md) §2.)*
3. In parallel, the whiteboard/PDF operation log for the session is retained (already durable by design, per [whiteboard.md](whiteboard.md)).
4. After class, the two streams (audio + operation log) are associated by a shared session timeline so [lesson-player.md](lesson-player.md) can play them back in sync.

## User journey — student recitation submission

1. Student records/uploads recitation audio against an assigned exercise (A18).
2. Audio is stored, linked to the student + exercise, visible only to that student and the reviewing teacher.
3. Teacher reviews and grades/comments — ties into [assessments.md](assessments.md).

## Functional requirements

- Class audio recording via the chosen RTC provider's built-in recording/egress feature (provider TBD — [../system/technology-evaluation.md](../system/technology-evaluation.md) §4), rather than a custom client-side capture, for reliability.
- Whiteboard operation log is retained by default as part of normal operation (it's the live-sync mechanism itself, per [whiteboard.md](whiteboard.md)) — no separate "recording toggle" needed for that half.
- Student-submitted recitation audio: standard record-or-upload flow, associated with a specific exercise/assessment.
- Timestamp alignment between audio and whiteboard operation log so playback can be synchronized (Part 11.1).

## Data requirements

Recording metadata (session, storage pointer, duration, consent flag), student submission audio (storage pointer, exercise link, student, timestamps).

## Permissions

- Class recordings are visible to the class's teacher and enrolled students (subject to the private-annotation exclusion rules in [student-corrections.md](student-corrections.md)); not visible cross-tenant.
- Student recitation submissions are visible only to the submitting student and their teacher for that exercise.

## UI states

- Recording-in-progress indicator visible to all participants (transparency, ties into consent).
- Post-processing/"recording being prepared" state before replay becomes available.
- Student submission: recording/uploading/submitted/graded states.

## Error handling & edge cases

- Recording fails to start (provider error): class must still function live; recording is not a hard dependency of the live session itself.
- Student's device fails to produce a valid audio submission (corrupt upload, mic permission denied): clear error state, not a silent failed submission.
- Very long class sessions: storage/duration limits per plan tier are an open question tied to [payments.md](payments.md).

## Security considerations

- Recording must not become a backdoor around the private-correction isolation rules — see [student-corrections.md](student-corrections.md) §security for why the recording architecture is split (audio + operation log) rather than a single flattened video.
- Recording requires a consent/notice mechanism — ~~OPEN QUESTION~~ **APPROVED (A30, 2026-10-05)**: general consent during enrollment/account setup **and** a clear notice when recording begins; general consent alone is not sufficient. Who consents on behalf of a minor is still open ([../roadmap/open-questions.md](../roadmap/open-questions.md) item 17; [../system/security.md](../system/security.md) §8).
- Retention (A31): recordings stay available until an authorized user deletes them, subject to the retention/deletion policy. Who is authorized and the deletion mechanics are not decided (item 16).
- Storage access to recordings/submissions must be tenant- and enrollment-scoped, not a public/guessable URL.

## Dependencies

[whiteboard.md](whiteboard.md), [student-corrections.md](student-corrections.md), [lesson-player.md](lesson-player.md), [../system/technology-evaluation.md](../system/technology-evaluation.md) §4 and §8 (storage cost).

## Acceptance criteria

- A completed class session produces a recording that, on replay, has audio and whiteboard activity in sync within an acceptable drift tolerance (target pending testing).
- A student's recitation submission is retrievable only by that student and their teacher, verified by an automated cross-account test.

## Testing requirements

[../testing/live-class-acceptance.md](../testing/live-class-acceptance.md), [../testing/security-tests.md](../testing/security-tests.md).

## 2026-10-13 updates

- **Correction audio source is hybrid (A43):** a correction clip may be derived from a full-session recording when one exists; otherwise short correction audio is captured independently. The live-class audio pipeline must therefore support capturing a short segment **without** running full-session recording. Correction clips must survive deletion of the parent recording (see P10 in [../../DECISIONS.md](../../DECISIONS.md)).
- **Parent visibility (A41):** a Parent with an ACTIVE link may see "approved recordings" of their child. What makes a recording approved is open (open question 23).
- Nothing in this document is implemented yet. Recording is outside the current scope.

## 2026-10-13 (Phase 2A)

- P10 approved as **A53**: correction audio is always a standalone object. The data model and storage contract exist (see [student-corrections.md](student-corrections.md)). Recording itself is still not implemented and remains vendor-neutral (A54) — no Agora/LiveKit code.

## 2026-10-13 (parent workflow)

No change to recording. Parent access to "approved recordings" still requires an ACTIVE link (now fully implemented). What makes a recording "approved" remains open (OQ23).

## Open questions

- ~~Recording consent flow and retention/deletion policy~~ — **resolved at business level 2026-10-05** (A30, A31; [../roadmap/open-questions.md](../roadmap/open-questions.md) item 7). Remaining: authorized deleter + mechanics (item 16), consent for minors (item 17).
- ~~Storage vendor for recordings at scale~~ — **Supabase Storage for the current phase** (A38; item 12). Re-evaluation only on real volume/cost data.
- Relationship between A13/A24 class recording + replay and the Option C add-on (item 18).
- Whether Option B correction clips are cut from a session capture when Option C is off, and whether clips depend on a parent recording (item 15).
- Recording provider depends on the RTC pilot (A35) — Agora and LiveKit recording/egress capabilities must both be evaluated.

## 2026-10-14 — recording & consent foundation implemented (A70–A80), provider-neutral

**Not built (by decision):** capture, Agora/LiveKit recording or egress, workers, extraction, transcoding. The RTC vendor is still undecided (A35). Media enters only through server-internal functions a future worker will call (`registerRecordingMedia`/`finalizeRecordingMedia`, segment equivalents). The private bucket `recordings` is referenced in code but **not created** on the dev project (owner approval needed).

**Consent (A70–A72), one policy for clips and recordings** (`src/server/authz/recording-consent.ts`):
- `student_accounts.date_of_birth`; minor status is derived, never stored.
- `recording_consents`: GUARDIAN_ONLINE (ACTIVE guardian; counts while that guardian's link stays ACTIVE; valid in all the child's Markaz) or OFFLINE_VERIFIED (Markaz Admin; who consented + evidence **reference** only; valid in that Markaz). Withdrawal sets `withdrawn_at` — rows are never deleted.
- **Fail-closed until the owner decides** the age threshold (item 34) and adult consent (item 35): today **no student is eligible**, so no clip or recorded student audio can be captured.
- Withdrawal blocks future capture and creates PENDING `CONSENT_WITHDRAWN` deletion requests for live clips/recordings in each Markaz where the student is no longer eligible. Nothing is deleted until a Markaz Admin approves.

**Live participation ≠ recording eligibility (A72):** `recording_participants.audio_included` and `getCapturePlan` are the boundary a future provider adapter must honour (exclude the student's audio from recorded media); nothing in a live/mic path consults consent (tested).

**Recordings (A77–A79):** `recordings` (tenant, author teacher, status, notice/start/end, media object, submit/approve/revoke audit fields, soft-delete/archive/purge), `recording_participants`, `recording_segments`.
- Start requires confirming the recording-start notice (A30; DB CHECK `recording_started_with_notice`).
- DRAFT → PENDING_APPROVAL (author teacher, media finalized) → APPROVED (Markaz Admin of that Markaz; interim: not the author; scope WHOLE, or SEGMENTS as a special case) → REVOKED (Markaz Admin). No rejection state (item 39).
- Playback: author teacher (active) and same-Markaz admin; Super Admin audited; **parent** only if APPROVED, not deleted, ACTIVE link to a participant whose audio was included, and that child still eligible (interim reading — item 41). With SEGMENTS approval a parent gets only an approved segment's **own** object, never the whole file. Students: not granted (item 42).
- Correction clips extracted from a recording: `source_recording_id` is now a real FK (`ON DELETE SET NULL`, added NOT VALID) — validated (same Markaz, media present, student's audio included); deleting the recording never affects a finalized clip.

## 2026-10-15 — decisions completed (A81–A83, A87, A89, A90)

**Consent (A81–A83):**
- **Minor = under 18.** The DOB is entered by the student or an ACTIVE guardian and must be **verified by a Markaz Admin** (who confirms the exact value shown; re-entry clears verification). Unverified → not eligible (`DATE_OF_BIRTH_UNVERIFIED`).
- **Adults** give and withdraw their **own** consent (`SELF_ONLINE`), possibly before verification; it counts once the DOB is verified ≥ 18. Guardian/offline consent never substitutes for an adult.
- **Minors:** an ACTIVE guardian's consent (or verified offline consent in that Markaz). Any ACTIVE guardian may withdraw a minor's consent. When a minor turns 18, guardian consent stops counting and their own consent is needed — a direct consequence of A81/A83.

**Review workflow (A87):** `DRAFT → PENDING_APPROVAL → APPROVED → REVOKED`, plus `PENDING_APPROVAL → REJECTED` (optional reason) and resubmission `REJECTED/REVOKED → PENDING_APPROVAL` by the author (title can be fixed). Resubmission clears the previous decision on the row and **withdraws** any approved segments; it is never auto-approved. Audited: SUBMITTED, APPROVED, REJECTED, APPROVAL_REVOKED, RESUBMITTED.

**Teacher notice (A89):** starting capture requires both the participants' notice and the teacher's own acknowledgement (`teacher_notice_acknowledged_at/by`, audited). It is not consent and creates no consent row.

**Option C (A90):** `recording_entitlements` per Markaz — NOT_ENABLED → PENDING (Markaz Admin request) → ENABLED (Super Admin). Creating or starting a recording requires ENABLED. No pricing/billing. Decline/disable are not decided (item 48).
