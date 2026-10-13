# Language Learning: Sentence Construction

Status: **DEFERRED** future module (brief Part 6.2); documented for completeness.

## Purpose
Let teachers assign vocabulary-based sentence construction exercises where students write original Arabic sentences using selected words, with teacher correction and appropriate automated grading.

## User roles
Teacher (assigns, corrects), Student (writes sentences).

## User journey
1. Teacher selects vocabulary ([vocabulary.md](vocabulary.md)) and assigns a sentence-construction exercise.
2. Student writes an original Arabic sentence using the required word(s).
3. Teacher reviews and corrects; some mechanical checks (e.g. "does the sentence contain the required word in some valid form") may be automatable, but semantic/grammatical correctness generally requires teacher judgment.

## Functional requirements
- Exercise requiring one or more specific vocabulary words to appear (in some valid inflected form) in the student's sentence.
- Grading-method selection per exercise, consistent with the general assessment model ([../assessments.md](../assessments.md)) — likely teacher-graded by default given Arabic morphological variation.

## Accepting multiple valid answers
Arabic sentence construction has many grammatically valid realizations of "use this word correctly." Automatic grading should be scoped narrowly (e.g. presence-of-word-root checks) rather than attempting to fully auto-validate grammatical correctness, which risks false negatives against legitimately correct but unanticipated student answers. Full correctness judgment is a teacher task unless/until a much later NLP-assisted grading capability is explicitly approved (ties into the deferred AI-grading item, A20).

## Data requirements
Submission text, required-word linkage, teacher feedback/grade.

## Permissions
Standard tenant/enrollment scoping.

## UI states, error handling, edge cases, security considerations
Deferred to implementation-time design.

## Dependencies
[vocabulary.md](vocabulary.md), [../assessments.md](../assessments.md), [grading-feedback.md](grading-feedback.md).

## Acceptance criteria / testing requirements
Deferred — not scheduled.

## Open questions
Exact scope of any automatic pre-check (e.g. word-presence detection) vs. leaving all grading to the teacher.
