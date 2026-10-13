# Feature: Assessments & Grading

Status: **PROPOSED** design supporting **APPROVED** requirement A20. Not in Phase 1 scope (see [../roadmap/phases.md](../roadmap/phases.md)), except insofar as [language-learning/](language-learning/) exercises will eventually build on this model.

## Purpose

Let teachers create exercises/exams with a per-question grading method (automatic, teacher, or future AI-assisted), track submissions, and release results only once the required grading step is complete.

## User roles

Teacher (creates exercises, grades where required), Student (submits, reviews results after release).

## User journey

1. Teacher creates an exercise/exam, and for each question selects a grading method (A20: teacher selects grading method per exercise/exam).
2. Student submits answers (text, audio for recitation-style questions, structured grammar answers for the language-learning module — see [language-learning/](language-learning/)).
3. Automatically-gradable questions are scored immediately; others queue for teacher grading (or, later, AI-assisted grading — explicitly deferred, A20).
4. Results/feedback are released to the student only after all required grading for that submission is complete — not partially, per-question, unless explicitly designed otherwise.
5. Optionally, course-completion certificates are issued once criteria are met (A20).

## Functional requirements

- Per-question grading-method selection at creation time: automatic, teacher, (future) AI-assisted.
- Submission storage supporting multiple answer types: text, audio (recitation), structured grammar/I'rab answers (see [language-learning/grammar-irab.md](language-learning/grammar-irab.md)).
- Result release gating: a submission's results are visible to the student only once grading is complete for the required questions.
- Course-completion certificate issuance once a defined completion criterion is met (criteria are course-specific, not invented here).
- Hifdh/Muraja'ah assessment as a first-class assessment type (A20), distinct from a written exam — likely audio-submission-based, tying into [audio-recording.md](audio-recording.md).

## Data requirements

Exercises, questions (with grading method + answer key/rubric where applicable), submissions, per-question grades, feedback text, certificates — see [../system/database.md](../system/database.md) §2.

## Permissions

Teacher owns and grades their own exercises/exams; a student sees only their own submissions and, once released, their own results.

## UI states

Not-started / in-progress / submitted-awaiting-grading / graded-released, per submission.

## Error handling & edge cases

- Mixed-method exam (some auto-graded, some teacher-graded): must not release partial results prematurely unless the product explicitly wants per-question incremental release — default assumption is all-or-nothing release per submission, flagged as a design choice to confirm.
- Automatic grading of free-text or audio answers is inherently limited — must not overclaim automatic grading capability for question types that can't reliably support it (e.g. open-ended Arabic sentence construction — see [language-learning/sentence-construction.md](language-learning/sentence-construction.md) on accepting multiple valid answers).

## Security considerations

Submission and grade data is tenant/enrollment-scoped like everything else; a student must never see another student's submission or grade.

## Dependencies

[curriculum.md](curriculum.md), [audio-recording.md](audio-recording.md), [language-learning/grading-feedback.md](language-learning/grading-feedback.md).

## Acceptance criteria

Deferred — not part of Phase 1; will be defined when this feature is scheduled for implementation.

## Testing requirements

Deferred to implementation-time planning.

## Open questions

Whether result release is strictly all-or-nothing per submission or can be incremental per question; concrete completion criteria for certificates (not invented here, per brief instruction against inventing pricing/limits — same caution applies to certificate criteria).
