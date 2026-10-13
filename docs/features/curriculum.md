# Feature: Curriculum Structure

Status: **PROPOSED** design supporting **APPROVED** requirement A10. Not in Phase 1 scope beyond whatever minimal structure Live Class needs to attach a session to (see [../roadmap/phases.md](../roadmap/phases.md)).

## Purpose

Let teachers organize educational content in the structures the brief requires — Level→Book→Chapter→Lesson (typical for Qaaidah/Qur'an-style progression), Course→Module→Lesson (typical for modern course-style subjects), and fully teacher-defined structures — without forcing every subject into one rigid shape.

## User roles

Teacher (defines curriculum), Student (consumes it via enrollment), Markaz Admin (role approved 2026-10-05, A26; whether it may define shared curriculum templates for their teachers is still an open question — open-questions item 13).

## User journey

1. Teacher creates a curriculum container using whichever structure fits their subject (e.g. Qaaidah as Level→Book→Chapter→Lesson; a Fiqh course as Course→Module→Lesson).
2. Teacher attaches materials, live class sessions, and exercises to specific lessons within that structure.
3. Student, once enrolled, sees the curriculum tree relevant to their enrollment and their progress through it.

## Functional requirements

- Support at least two named structural templates (Level/Book/Chapter/Lesson and Course/Module/Lesson) plus a generic teacher-defined tree, rather than hardcoding one shape platform-wide (A10).
- A lesson node is the attachment point for live class sessions, recordings, materials, and exercises.
- Curriculum belongs to a tenant (teacher/Markaz); not shared across tenants by default.

## Data requirements

A generic hierarchical container model (parent/child nodes with a "kind" label per level, e.g. `level`, `book`, `chapter`, `lesson`, or `course`, `module`, `lesson`) rather than separate rigid tables per template — see [../system/database.md](../system/database.md) §2. Exact schema is implementation-time work, not decided here.

## Permissions

Only the owning teacher (or, per an open question, a Markaz Admin acting on behalf of a teacher within their institution) can edit a curriculum tree; students have read access scoped to their enrollment.

## UI states

Tree/outline editor (teacher), browsing view (student) — likely rendered via [../components/course-card.md](../components/course-card.md) at the top level and a lesson list within.

## Error handling & edge cases

- Reordering/restructuring a curriculum after students have already progressed through part of it: needs a defined behavior so progress records don't silently orphan — **not decided**, flagged for design once curriculum work is scheduled.
- A lesson deleted after it has an associated live class recording: recording/correction records should not become inaccessible — ties into the soft-reference approach mentioned in [student-corrections.md](student-corrections.md).

## Security considerations

Tenant isolation as with all other tenant-owned data ([../system/tenancy.md](../system/tenancy.md)).

## Dependencies

[live-class.md](live-class.md) (lessons are the attachment point for sessions), [assessments.md](assessments.md), [../system/tenancy.md](../system/tenancy.md).

## Acceptance criteria

Not detailed here — curriculum is not part of the Phase 1 Live Class implementation; acceptance criteria will be defined when this feature is scheduled (see [../roadmap/phases.md](../roadmap/phases.md)).

## Testing requirements

Deferred to implementation-time planning per [../../CLAUDE.md](../../CLAUDE.md) process.

## Open questions

Whether curriculum "templates" are fixed platform choices or teachers can define arbitrary custom hierarchies beyond the two named templates.
