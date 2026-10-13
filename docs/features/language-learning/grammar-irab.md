# Language Learning: Grammar & I'rab

Status: **DEFERRED** future module (brief Part 6.3); documented for completeness.

## Purpose
Let teachers give a sentence and require students to analyze each word grammatically — part of speech, grammatical role, grammatical state, relevant markers — and produce a full I'rab analysis, at both word and sentence level.

## User roles
Teacher (provides sentence, grades), Student (produces analysis).

## User journey
1. Teacher provides an Arabic sentence.
2. Student, per word, identifies: Ism/Fi'l/Harf classification, grammatical role, grammatical state, relevant markers, then produces a complete sentence-level I'rab.
3. Teacher grades, since a full I'rab typically requires expert judgment.

## Functional requirements
- Word-level answer capture (per-word classification + role + state + marker explanation) and sentence-level answer capture (full I'rab narrative), both supported — not just one or the other (explicit requirement).
- Grading-method selection consistent with [../assessments.md](../assessments.md); given the analytical/expert nature of I'rab, teacher-graded is the realistic default, with narrow automatic pre-checks (e.g. "did the student classify this word as Ism") possible where the sentence has an unambiguous answer.

## Multiple valid analyses
Not every sentence has a single uniquely "correct" grammatical analysis — some constructions are legitimately analyzed more than one valid way by different grammarians/schools. The platform must not assume a single answer key is always sufficient; teacher review should be able to accept alternate valid analyses, not just pattern-match against one fixed key.

## Data requirements
Sentence, per-word structured answer fields, sentence-level free-text I'rab, teacher grade/feedback, and (for auto-checkable parts only) an answer key that's explicitly scoped to unambiguous elements.

## Permissions
Standard tenant/enrollment scoping.

## UI states, error handling, edge cases, security considerations
Deferred to implementation-time design.

## Dependencies
[../assessments.md](../assessments.md), [grading-feedback.md](grading-feedback.md).

## Acceptance criteria / testing requirements
Deferred — not scheduled.

## Open questions
How much of the word-level classification can be safely auto-checked without over-constraining legitimate grammatical debate.
