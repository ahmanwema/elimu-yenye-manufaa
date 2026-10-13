# Feature: Individual Student Corrections

Status: **PROPOSED** design for **APPROVED** requirement A17. The correction-storage approach is now **APPROVED** as a tiered model (Option B default, Option C optional add-on) — [../../DECISIONS.md](../../DECISIONS.md) A29, owner decision BR-04, 2026-10-05. Technical mechanics of clipping and audio storage remain **not decided**.

> History: until 2026-10-05 the storage recommendation below was marked PROPOSED (brief Part 4.5 required it to stay proposed until approved). The comparison table is kept unchanged as the record of how the decision was reached.

## Purpose

Let a teacher mark reading mistakes (Qur'an or other text) directly on the page for one specific student, and let that student privately review those corrections after the lesson — without any other student, or any shared recording/broadcast, ever exposing that private data.

## User roles

Teacher (creates corrections), Student (the correction's subject — the only student who can view it).

## User journey

1. During a live class, a student reads aloud (Qur'an/book passage).
2. Teacher switches to correction mode and marks mistakes directly on that student's current page (underline, circle, highlight, note) — A17.
3. The correction is tagged private-to-that-student at creation time, not filtered afterward.
4. After the lesson, the student opens their lesson page and finds their private corrections listed alongside the material, without needing to scrub through a full recording to find them (via [lesson-player.md](lesson-player.md)).

## Functional requirements

- Correction tools: underline, circle/highlight a word or passage, free-text explanatory note (A17).
- Every correction is bound to (document, page, student, teacher, timestamp) and a visibility scope of exactly that student + teacher.
- Corrections must be reviewable independent of watching a full recording — i.e. surfaced as discrete, navigable items on the lesson page (brief Part 11 item 6).

## Data requirements

Annotation records as described in [../system/database.md](../system/database.md) §2/§4: (document, page, student_id, teacher_id, visibility, timestamp, geometry/marks, optional note text, optional linked audio-segment reference — see storage comparison below).

## Permissions

- Only the correction's teacher and its subject student can read it; enforced by RLS on the visibility scope, not application-level filtering alone (A17, [../system/security.md](../system/security.md) §4).
  - **2026-10-13 exception (A41, supersedes A17 in part):** a Parent with an **ACTIVE** link to the subject student may also read that student's corrections. Teacher-private notes attached to a correction (if such a field is ever added) remain teacher-only and must be stored so they can be excluded from Parent and student reads. No other party is added. Enforcement must follow [../system/security.md](../system/security.md) §2.1: a server-side authz rule *and* an RLS policy, both tested.
- A Markaz Admin does **not** see another teacher's private corrections by default (consistent with A8/roles model).

## UI states

- Teacher: correction mode toggle, visually distinct from class-shared annotation mode (so a teacher never accidentally broadcasts what was meant to be private, and vice versa).
- Student: a "my corrections" view scoped to a lesson, listing each correction with enough context (page reference, note, optional audio) to be self-contained.

## Error handling & edge cases

- Teacher accidentally marks a correction in class-shared mode instead of private (or vice versa): the toggle's current mode must be unambiguous in the UI at all times — this is a privacy-critical UI state, not a cosmetic one.
- Student is removed from the class/teacher after receiving corrections: ~~OPEN QUESTION whether they retain access~~ **APPROVED (A32, BR-07, 2026-10-05)**: the student retains access to their own personal submissions/corrections; restricted/licensed Markaz content may be removed from their access; leaving is not deletion of their academic history. **Still open**: what remains visible when the correction's anchor page is itself restricted Markaz content ([../roadmap/open-questions.md](../roadmap/open-questions.md) item 20), and whether a departed *teacher* keeps access to corrections they authored (item 19).
- Correction referencing a page/document that is later deleted/replaced: needs a defined behavior (PROPOSED: soft-reference preservation, i.e. keep the correction viewable against an archived copy of that page).

## Security considerations — screen share, recording, live broadcast

This is the crux of the feature per the brief's explicit instruction to investigate it:

- **Screen sharing**: private corrections must not be drawn onto whatever is being screen-shared to the class. Since the teacher's correction marks live in a visibility-scoped operation-log layer (not "whatever pixels are on the teacher's screen"), a screen-share of, say, the teacher's own OS desktop must be architecturally separate from the whiteboard/PDF rendering layer, or the correction layer must be explicitly excluded from the shared composite. This constrains implementation: correction marks should render as an overlay the *broadcast pipeline* can filter, not be baked into a single flattened video frame.
- **Recording**: because the recording (per [../system/architecture.md](../system/architecture.md) §3.4) is proposed as *audio + whiteboard operation log*, not a flattened video, private-visibility operations can be excluded from the class-wide replay stream and only included when a viewer requests their own private layer, checked server-side each time. This is the primary reason Option C (full video recording) is not the recommended default — filtering private content out of an already-flattened video is far harder than filtering it out of a structured operation log before rendering.
- **Live broadcast**: the same visibility check that gates real-time delivery (per [whiteboard.md](whiteboard.md)) already prevents other students from receiving private operations live, since they're never sent to non-owner clients in the first place — not sent-then-hidden.

## Correction storage: options comparison (brief Part 4.5)

| Option | Description | Cost/storage | Privacy | Sync complexity | Offline access | Implementation complexity | Long-term maintainability |
|---|---|---|---|---|---|---|---|
| **A — Structured annotations linked to documents/pages only** | Marks + notes, no audio/video context. | Lowest (tiny records). | Simplest to isolate (pure structured data, easy RLS). | Low — reuses whiteboard op-log directly. | Easiest — small JSON-like records cache trivially. | Lowest. | Highest, but a student may lack audio context for *why* a mark was made (e.g. a mispronunciation is hard to convey with a circle alone). |
| **B — Structured annotations + timestamp + relevant short audio segment** (**APPROVED default**, A29) | Same as A, plus a pointer to a short clipped audio segment (the student's recitation at that moment, or the teacher's spoken correction). | Low–moderate (short clips, not full sessions). | Still easy to isolate per-student since only the relevant short segment is stored/linked, not the whole class audio. | Moderate — needs timestamp alignment between the op-log and the audio track. | Good — short clips are small enough to cache for offline review (A18). | Moderate. | Good balance of context and cost; recommended default. |
| **C — Structured annotations + complete lesson recordings** (**APPROVED as optional add-on**, A29) | Full session audio (+ implied whiteboard replay) retained. | Highest (full-session storage × every class × retention period). | Hardest to isolate — a full recording inherently contains everyone's audio/activity, requiring careful reconstruction to serve only a private slice, and total-lesson recordings raise broader consent questions (Part 9). | Highest. | Poor for routine correction review — large files are impractical to download just to see one correction. | Highest. | Costly at scale; better suited as an optional paid add-on (e.g. "record my whole class for my own review") than the default correction mechanism. |

**Original recommendation (2026-09-30, PROPOSED at the time):** Option B as the default correction-storage mechanism; Option C offered only as an optional, separately-consented, likely paid feature for teachers/Markaz who want full-session recordings for other reasons (e.g. absentee catch-up), not as the mechanism corrections rely on.

### Approved tiered model (A29, owner decision BR-04, 2026-10-05)

This defines the "tiered offering" previously mentioned but not defined.

| Tier | What it is | Status |
|---|---|---|
| **Default — Option B** | Structured annotations + timestamp + short relevant audio segment + private correction context. Full lesson recordings are **not** required for normal corrections. | APPROVED default |
| **Add-on — Option C** | Full-session lesson recording. Not the default correction mechanism; expected to be separately enabled; may become a paid feature/add-on; must not be treated as mandatory infrastructure for ordinary corrections. | APPROVED as optional add-on |
| Option A | Annotations only, no audio. | Not selected as a tier. Not explicitly prohibited either; no decision recorded. |

Recording consent (A30) and retention (A31) apply to any recorded audio, including correction clips.

**Not decided by A29** (do not assume): how the short audio segment is produced (clipped from a session capture vs captured separately — see [../roadmap/open-questions.md](../roadmap/open-questions.md) item 15); whether a clip is a stand-alone file or a pointer into a parent recording; clip length; storage path layout; Option C pricing (DECISIONS §5 deferred); how Option C is enabled (per teacher, per Markaz, per class).

## Dependencies

[whiteboard.md](whiteboard.md), [pdf-annotations.md](pdf-annotations.md), [audio-recording.md](audio-recording.md), [lesson-player.md](lesson-player.md), [../system/security.md](../system/security.md).

## Acceptance criteria

- A correction created in private mode is retrievable by its subject student and by the teacher, and by no other account, verified via an automated cross-account access test.
- A private correction never appears in any other student's live view or in a class-wide recording export.
- A student can review a correction (mark + note + linked audio segment — Option B is the approved default, A29) without downloading a full lesson recording.

## Testing requirements

[../testing/security-tests.md](../testing/security-tests.md) (cross-account access denial), [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md).

## Correction audio source (A43, owner decision BR-06, 2026-10-13)

Resolves open question 15. **Hybrid:**

- When a full-session recording (Option C) exists: correction → timestamp → the relevant clip/segment **may** be derived from that recording.
- When no full-session recording exists: correction → **independently captured short correction audio**.
- Option B must work without Option C. Ordinary corrections never depend on a full-session recording.
- **Durability rule:** a correction's required context must not silently disappear because an unrelated full-session recording is deleted.

Technical evaluation (P10, **proposed**, not implemented): store every correction clip as a **standalone object**; keep the segment pointer only as provenance. A pointer-only design would break the durability rule unless recording deletion were restricted, and deletion mechanics are an open owner decision (OQ16). Correction clips are not implemented in the current phase.

## Standalone clips — APPROVED and data foundation implemented (A53, 2026-10-13)

P10 is approved. Implemented (vendor-neutral, no media processing) in `src/server/services/correction-audio.ts` with tables `corrections` (minimal) and `correction_audio_clips`:

- **Every clip gets its own private object key at registration** (random, with no tenant/student ids in it). Playback signs **that** object only — never a byte range of a recording.
- **Path 1, no full recording:** `registerDirectCaptureClip` (status AWAITING_UPLOAD + signed upload URL) → client uploads → `finalizeDirectCaptureClip` checks the object really exists and records the server-side size → FINALIZED.
- **Path 2, full recording exists:** `registerExtractedClip` (AWAITING_EXTRACTION, recording id + start/end ms as provenance) → a future worker **copies** the segment into the clip's own object → `finalizeExtractedClip` → FINALIZED.
- **Deleting a recording:** `detachSourceRecording` clears only the provenance pointer; the clip stays FINALIZED and playable (tested). The future recordings FK must be `ON DELETE SET NULL`.
- **Who may add audio:** only the correction's teacher, while an ACTIVE teacher of that Markaz. **Who may play:** the student (always — A32), an ACTIVE-linked parent (A41/A48), the authoring teacher while active. Not Markaz Admins or Super Admins (A17). Server and RLS agree (tested).
- **Deferred / not decided:** capture UI, the extraction worker, codecs, maximum duration, retention/deletion of clips, the departed-teacher rule (OQ19).

## Parent access to corrections (2026-10-13)

A parent sees a student's corrections only through an **ACTIVE** link (A48), which now has a full, permissioned workflow: request (parent or `parent_link.create`) → verify → activate → revoke (A55–A57). Revoking or withdrawing removes access immediately (tested at the RLS layer for student records; the correction policy uses the same `app.has_active_parent_link`).

## Open questions

- ~~Final approval of Option B vs A vs C (or a tiered offering)~~ — **Resolved 2026-10-05** (A29; [../roadmap/open-questions.md](../roadmap/open-questions.md) item 4).
- ~~Whether a removed student retains access to their historical corrections~~ — **Resolved 2026-10-05** (A32; item 10).
- ~~Recording consent mechanism~~ — **Resolved at business level 2026-10-05** (A30; item 7).
- Option B clip source and lifecycle, including dependence on a parent recording — item 15.
- Who may delete correction clips, and deletion mechanics — item 16.
- Teacher-departure access to authored corrections — item 19.
- Visibility of a retained correction when its anchor page is removed restricted content — item 20.
- Whether a linked Parent may see private corrections (A17 currently says student + teacher only) — item 14.
