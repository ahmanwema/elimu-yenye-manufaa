# Feature: PDF Display & Annotation

Status: **PROPOSED** design supporting **APPROVED** requirement A13 (PDF display + annotation, including Qur'an pages).

## Purpose

Let a teacher display a PDF (book, Qur'an page, worksheet) during a live class and annotate directly on it, synchronized live to students, using the same underlying operation-log mechanism as the whiteboard, scoped per page.

## User roles

Teacher (display + annotate), Student (view; may receive private corrections on their own submitted/viewed page).

## User journey

1. Teacher selects a PDF from their materials/library and opens it in the live class.
2. Students see the current page rendered live.
3. Teacher navigates pages; the annotation layer switches with the page (each page has its own operation log/snapshot, per [whiteboard.md](whiteboard.md)).
4. Teacher annotates (underline, circle, highlight, note) — either class-wide (e.g. marking a Tajwid rule for everyone) or private-to-one-student (a recitation correction) — see [student-corrections.md](student-corrections.md) for the private case.
5. After class, the student can revisit the same page with the annotation layer intact via the lesson player — see [lesson-player.md](lesson-player.md).

## Functional requirements

- Render PDF pages in-browser (proposed: Mozilla `pdf.js`, [../system/technology-evaluation.md](../system/technology-evaluation.md) §6).
- Annotation tools: underline, circle/ellipse, highlight, free-form note/text, consistent with the correction tools required in A17.
- Annotations are positioned relative to the rendered page (normalized coordinates), so they stay aligned regardless of zoom level or viewing device's screen size.
- Page-scoped operation log/snapshot, reusing the whiteboard's sync protocol (not a separate bespoke protocol) — see [whiteboard.md](whiteboard.md).
- Support for Qur'an-specific page sources (A13) — pages may come from a curated Qur'an PDF/image set rather than an arbitrary teacher upload; source/version handling is an implementation detail deferred to curriculum design ([curriculum.md](curriculum.md)).

## Data requirements

Document metadata (title, source, owner/tenant, subject), per-page annotation operation logs + snapshots (shared shape with whiteboard data — see [../system/database.md](../system/database.md)).

## Permissions

- Only the teacher can upload/select and display materials in their own class.
- Annotation visibility follows the same class-shared vs private-to-student model as the whiteboard ([whiteboard.md](whiteboard.md), [student-corrections.md](student-corrections.md)).
- Students can view materials the teacher has explicitly displayed/shared with their class/enrollment, not an arbitrary teacher's private library.

## UI states

- Viewing (read-only, page navigation only) — default student state.
- Annotating (teacher) — class-shared mode.
- Correcting (teacher) — private-to-student mode, visually distinct (see [student-corrections.md](student-corrections.md)).
- Loading/rendering a large PDF — needs a clear progress state, especially on lower-end mobile devices.

## Error handling & edge cases

- Large or malformed PDF fails to render: must fail with a clear error, not a silent blank viewer.
- Page navigation during heavy annotation activity: must not lose in-flight strokes when switching pages mid-stroke — PROPOSED rule: finalize current stroke before page navigation is allowed to take effect.
- Offline/low-bandwidth student: initial page image/render should be cacheable for the "download for offline use" requirement (A18) — ties into [student-dashboard.md](student-dashboard.md).

## Security considerations

- Private annotations on a PDF page must never be included in a class-wide broadcast, screen share, or shared recording — same enforcement as [whiteboard.md](whiteboard.md) and [student-corrections.md](student-corrections.md).
- Materials belong to a tenant (teacher/Markaz); RLS must prevent one teacher's uploaded materials from being visible to another teacher's class unless explicitly shared (no such sharing mechanism is currently requested).

## Dependencies

[whiteboard.md](whiteboard.md) (shares the sync protocol), [student-corrections.md](student-corrections.md), [curriculum.md](curriculum.md) (where materials are organized), [../system/technology-evaluation.md](../system/technology-evaluation.md) §6.

## Acceptance criteria

- A teacher can display a multi-page PDF and navigate pages live, with all students' views following the current page.
- Annotations drawn on a page remain correctly positioned when viewed on a different screen size/aspect ratio than the teacher's.
- A private correction made on a page is retrievable later by the correct student only, aligned to the correct page.

## Testing requirements

See [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md) and [../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md) (annotation alignment across screen sizes).

## Open questions

- Where the curated Qur'an page source set comes from and how its accuracy/authenticity is verified (must not be invented casually — likely needs a vetted source, e.g. an established Qur'an text/image provider) — flagged for owner input, see [../roadmap/open-questions.md](../roadmap/open-questions.md) item 11. **Still OPEN after 2026-10-05 (A37 / BR-12):** no source is selected; whichever source is chosen must pass a verification/authenticity review before production use.
