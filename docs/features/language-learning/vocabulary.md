# Language Learning: Vocabulary

Status: **DEFERRED** future module (brief Part 6.1); documented for completeness, not scheduled in [../../roadmap/phases.md](../../roadmap/phases.md).

## Purpose
Let teachers curate vocabulary drawn from Qur'an, Hadith, and scholarly lectures, with source references preserved, for students to practice using in original sentences and everyday contexts.

## User roles
Teacher (curates vocabulary + source references), Student (practices usage).

## User journey
1. Teacher adds a vocabulary item, attaching a verified source reference (Qur'anic ayah, Hadith citation, or lecture reference) when the word is drawn from one.
2. Student studies the word and its source context, then practices using it (feeding into [sentence-construction.md](sentence-construction.md)).

## Functional requirements
- Vocabulary item with word, meaning(s), and an optional but strongly encouraged source reference field.
- **Source references must never be invented or auto-generated** — only real, verifiable Qur'anic ayat, Hadith attributions, or scholarly citations the teacher actually supplies (explicit brief constraint, A19). The platform's role is to preserve and display what the teacher enters, not to generate or infer citations.
- Vocabulary organized by subject/curriculum node ([../curriculum.md](../curriculum.md)).

## Data requirements
Vocabulary items with optional structured source-reference fields (type: Qur'an/Hadith/Lecture, citation text) — schema detail deferred.

## Permissions
Teacher-owned, tenant-scoped like other curriculum content.

## UI states, error handling, edge cases
Deferred to implementation-time design.

## Security considerations
None beyond standard tenant isolation.

## Dependencies
[sentence-construction.md](sentence-construction.md), [../curriculum.md](../curriculum.md).

## Acceptance criteria / testing requirements
Deferred — not scheduled.

## Open questions
Whether/how source-reference accuracy is verified (e.g. does the platform validate a Hadith citation format, or trust the teacher entirely) — leans toward trusting the teacher as the domain authority, but worth confirming.
