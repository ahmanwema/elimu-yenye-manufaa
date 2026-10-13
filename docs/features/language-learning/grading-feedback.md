# Language Learning: Grading & Feedback

Status: **DEFERRED** future module; documented for completeness as the shared grading/feedback layer for the language-learning exercises above.

## Purpose
Provide a consistent grading and feedback mechanism across vocabulary, sentence-construction, grammar/I'rab, and audio-dictation exercises, reusing the general assessment model rather than inventing a separate one per exercise type.

## User roles
Teacher (grades, gives feedback), Student (reviews).

## Functional requirements
- Reuses [../assessments.md](../assessments.md)'s per-question grading-method selection (automatic/teacher/future-AI) rather than a bespoke language-module-specific grading pipeline.
- Feedback should be able to reference specific word/segment-level detail (consistent with the word-level and timestamp-level granularity required by [grammar-irab.md](grammar-irab.md) and [audio-dictation.md](audio-dictation.md)), not just a whole-submission comment.
- Results released to the student consistent with the release-gating rule in [../assessments.md](../assessments.md).

## Data requirements, permissions, UI states, error handling, security considerations
Inherited from [../assessments.md](../assessments.md) — no separate model proposed here to avoid duplicating that document.

## Dependencies
[../assessments.md](../assessments.md), [vocabulary.md](vocabulary.md), [sentence-construction.md](sentence-construction.md), [grammar-irab.md](grammar-irab.md), [audio-dictation.md](audio-dictation.md).

## Acceptance criteria / testing requirements
Deferred — not scheduled.

## Open questions
None beyond those already listed in the individual exercise-type documents above.
