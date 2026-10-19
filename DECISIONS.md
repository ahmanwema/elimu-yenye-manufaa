# DECISIONS.md — Elimu Yenye Manufaa

This is the single source of truth for what has actually been decided versus what is still a proposal or open question. When in doubt, this file wins over any narrative description elsewhere.

Statuses used throughout the documentation:

- **APPROVED** — the project owner has explicitly signed off. Treat as fixed until explicitly changed here.
- **PROPOSED** — an engineering recommendation, not yet approved. May be built only after approval.
- **OPEN QUESTION** — unresolved, needs an owner decision before design/implementation can proceed in that area.
- **DEFERRED** — intentionally out of scope for now; revisit later.

Last updated: 2026-10-19 (finance-role correction — A140, §1.11). Previous: 2026-10-19 (final Live Class corrections — A131–A139, §1.10). Previous: 2026-10-19 (Live Class foundation — A101–A130, §1.9). Previous: 2026-10-16 (A92–A100, §1.8; DEV apply). Previous: 2026-10-16 (A92–A98, §1.8). Previous: 2026-10-15 (media policy decisions — A81–A91, §1.7). Previous: 2026-10-14 (recording & correction media — A66–A80, §1.6). Previous: 2026-10-13 (fourth update: delegation, child proposal, self-request, Supabase environment — A62–A65, §1.5).

History: 2026-09-30 initial documentation pass. 2026-10-05 owner business decisions BR-01–BR-13 reconciled (A26–A38, §1.1).

---

## 1. Approved decisions

These come directly from the project owner's brief and are treated as fixed requirements for documentation and future implementation planning.

| # | Decision | Source |
|---|---|---|
| A1 | Product is a multi-teacher, multi-institution (Markaz) online Islamic education platform. | Brief Part 1 |
| A2 | Students self-register; they join teachers/institutions via invitation links, without requiring manual teacher approval to join. | Brief Part 1 |
| A3 | A student may study with multiple teachers across different courses. | Brief Part 1 |
| A4 | Target platforms (eventually): desktop web, mobile web, installable PWA, Android app, iOS app. | Brief Part 1 |
| A5 | Hosting preference: Vercel + Supabase. | Brief Part 1 |
| A6 | Supported languages: Swahili, Arabic, English. | Brief Part 1 |
| A7 | Initial confirmed roles: Super Admin, Teacher, Student, Unregistered visitor. | Brief Part 2 |
| A8 | Teachers must not access unrelated teachers' private student records. | Brief Part 2 |
| A9 | Platform must support parental access to children's progress (model TBD). | Brief Part 2 |
| A10 | Curriculum must support Level→Book→Chapter→Lesson, Course→Module→Lesson, and teacher-defined structures. | Brief Part 3 |
| A11 | **Live Class is the first feature to design and implement**, before the rest of the platform. | Brief Part 4 |
| A12 | Teacher drawing tablet: XPPen Deco 640, connected to Windows, primary browser Google Chrome. No extra teaching software beyond required drivers, if browser compatibility is achievable. | Brief 4.1 |
| A13 | Confirmed Live Class capabilities: teacher mic audio, digital whiteboard (write/erase), PDF display + annotation, Qur'an page annotation, screen sharing, raise-hand, teacher-controlled student mic, text chat questions, lesson recording, attendance tracking. | Brief 4.2 |
| A14 | Live teacher video is **not** an initial requirement. | Brief 4.2 |
| A15 | Class capacity varies by plan, not a single universal cap. | Brief 4.2 |
| A16 | Students cannot write on the whiteboard by default; teacher must explicitly grant/revoke per-student write permission; this must be enforced server-side. | Brief 4.3 |
| A17 | Teacher can mark up an individual student's reading (underline/circle/highlight/annotate) and only that student + teacher can see it. | Brief 4.4 |
| A18 | Students must be able to: self-register, join via invite link, join live classes, listen to recordings, submit recitation audio, do exercises/exams, review results/progress, download permitted materials offline, review private corrections. | Brief Part 5 |
| A19 | A future Arabic-language-learning module is required (vocabulary, sentence construction, grammar/I'rab, audio dictation) — sourced from Qur'an/Hadith/scholarly lectures, with references preserved and never invented. | Brief Part 6 |
| A20 | Assessment must support teacher grading, automatic grading, Hifdh/Muraja'ah assessment, feedback, completion certificates, and future AI-assisted grading (not part of initial Live Class work). Teacher selects grading method per exercise/exam. | Brief Part 7 |
| A21 | Must support free and paid plans; monthly subscriptions, course-based payments, M-Pesa, Airtel Money. Monthly tuition is the current emphasis. | Brief Part 8 |
| A22 | Security must cover teacher data isolation, multi-institution isolation, parental access, recording permissions, audit logs, backups, child-protection considerations. | Brief Part 9 |
| A23 | UI/UX must produce an **original** design identity inspired by (not copied from) Codefinity references; must support Arabic RTL + tashkīl + accessible reading sizes. | Brief Part 10 |
| A24 | Live Class lesson page replaces the primary video area with the synchronized whiteboard/document viewer, and must support recorded-lesson replay later. | Brief Part 11 |
| A25 | No final technology stack yet — Next.js/React/TypeScript/Supabase is a candidate to evaluate, not a locked choice. | Brief Part 12 |
| A26 | **Markaz Administrator** is an approved role. Inside their own Markaz they hold broad operational authority, close to a Super Admin *for that tenant only*. They do **not** automatically gain authority over other Markaz/tenants, global platform settings, or Super Admin-only operations. Exact permission rows are **not** yet derived (see open question 13). This decision does not by itself change A8 or A17. | Owner decision BR-01, 2026-10-05 |
| A27 | **Parent** is a separate account type (not a viewer flag or a property on a Student account). A Parent account may be linked to one or more Students. Linking/verification method and the exact scope of what a Parent may see remain open (open question 14). | Owner decision BR-02, 2026-10-05 |
| A28 | One Teacher account may belong to **more than one Markaz**. Each Markaz relationship is tenant-scoped; roles, classes, access, and data visibility must not leak across Markaz boundaries; a Teacher's role/permissions may differ per Markaz. | Owner decision BR-03, 2026-10-05 |
| A29 | **Correction storage — approved tiered model.** *Default* correction mechanism is **Option B**: structured annotations + timestamp + short relevant audio segment + private correction context. Full lesson recordings must **not** be required for normal corrections. **Option C** (full-session lesson recording) is an **optional add-on**: not the default correction mechanism, expected to be separately enabled, may become a paid feature/add-on, and must not be treated as mandatory infrastructure for ordinary corrections. This formally defines the previously undefined "tiered offering". Option C pricing and the technical mechanics of clipping/audio storage are **not** decided. Supersedes P6 (see §1.1). | Owner decision BR-04, 2026-10-05 |
| A30 | **Recording consent** requires both (1) general consent during enrollment/account setup **and** (2) a clear notice when recording begins. General consent alone is not sufficient. | Owner decision BR-05, 2026-10-05 |
| A31 | **Recording retention:** recordings remain available until an authorized user deletes them, subject to the project's retention/deletion policy. Technical mechanics (soft vs hard delete, grace period, archival, storage garbage collection, legal hold) and *who* counts as an authorized user are **not** approved (open question 16). | Owner decision BR-06, 2026-10-05 |
| A32 | **Departed students:** when a Student leaves a Markaz, they retain access to their own personal submissions/corrections; restricted/licensed Markaz content may be removed from their access. Leaving a Markaz is not automatic deletion of the Student's personal academic history. | Owner decision BR-07, 2026-10-05 |
| A33 | **Live Class capacity:** no final participant numbers are hardcoded. The architecture may support plan-based capacity limits; concrete limits stay unresolved until pilot/network/cost testing. Refines A15. | Owner decision BR-08, 2026-10-05 |
| A34 | **Hybrid commercial model.** These are separate concepts and must not be collapsed into one generic "payment type": (1) platform-level plans, (2) Markaz tuition, (3) teacher-level subscriptions, (4) paid courses, (5) optional paid features/add-ons (e.g. full-session recording). No prices, revenue sharing, or subscription durations are decided. | Owner decision BR-09, 2026-10-05 |
| A35 | **RTC/whiteboard vendor:** Agora and LiveKit both remain pilot candidates. Selection process: Agora vs LiveKit → real target-network pilot → latency/reliability/cost comparison → final project-owner decision later. Neither vendor is selected. Supersedes the vendor preference in P4 (see §1.1). | Owner decision BR-10, 2026-10-05 |
| A36 | **MVP platform = PWA + mobile web first.** Native Android and native iOS are not required for MVP and may remain future phases. Refines A4 (A4's "eventually" list is unchanged). | Owner decision BR-11, 2026-10-05 |
| A37 | **Qur'an annotation source:** the final Qur'an page image/PDF source is **not** selected (open question 11 stays open). Any source must pass a verification/authenticity review before production use. | Owner decision BR-12, 2026-10-05 |
| A38 | **Large media storage:** Supabase Storage is the current storage direction. No migration to Cloudflare R2 or Backblaze B2 now; may be reconsidered later based on real volume/cost data. Supersedes the "evaluate" framing of P8 for the current phase (see §1.1). | Owner decision BR-13, 2026-10-05 |

| A39 | **Technology stack APPROVED:** Next.js, TypeScript, **Prisma ORM**, Supabase PostgreSQL, Supabase Auth, Supabase Storage, PWA, with Vercel as the *intended* deployment platform. Vercel deployment and Supabase production creation/configuration are **not** authorized by this decision (see §2). Supersedes P1. | Owner decision, 2026-10-13 |
| A40 | **Markaz Administrator = full tenant administrator for their own Markaz.** May manage normal Markaz operations (teachers, students, classes, curriculum/content, attendance, reports, Markaz settings, Markaz-level operational/billing information) **only where those capabilities exist in project documentation**. Never automatically receives: access to another Markaz, platform-global settings, Super Admin management, global pricing/policy authority, or global tenant administration. Refines A26; resolves the *direction* of open question 13. | Owner decision BR-03 (2026-10-13) |
| A41 | **Parent visibility is broad for a linked child:** progress, attendance, assessments, submissions, corrections, and approved recordings. A Parent must **not** automatically see teacher-private notes, administrator-only notes, unrelated Students, or another Parent's children. Child data becomes visible only through a verified/active Parent–Student relationship. **Explicit exception to A17** for corrections (see §1.2). Who verifies/approves a link is **not** decided (open question 14). | Owner decision BR-04 (2026-10-13) |
| A42 | **Parent–Student link states** (approved for planning): `PENDING`, `VERIFIED`, `ACTIVE`, `REVOKED`. Who moves a link between states is **not** decided. | Owner decision BR-04 (2026-10-13) |
| A43 | **Correction audio source is HYBRID (resolves open question 15).** When a full-session recording exists, a correction's clip/segment *may* be derived from it via the correction's timestamp. When no full-session recording exists, the correction uses **independently captured short correction audio**. Option B must work without Option C; ordinary corrections must never depend on a full-session recording. **Durability rule:** a correction's required context must not silently disappear because an unrelated full-session recording is deleted. Physical clip vs segment pointer vs both is a technical evaluation (see P10). | Owner decision BR-06 (2026-10-13) |
| A44 | Option C (full-session recording) stays an optional add-on, outside the mandatory MVP correction flow; no pricing or paid-entitlement behavior is implemented until pricing is approved. Restates A29 for the implementation phase. | Owner decision BR-07 (2026-10-13) |
| A45 | **Authentication = invite-first onboarding + email OTP / magic link.** Users do not self-assign privileged roles; accounts begin from an authorized invitation where applicable; sign-in uses Supabase email OTP / magic link. Passwords are not the primary login method in this phase. No social (Google/Facebook) or phone/SMS sign-in. | Owner decision A (2026-10-13) |
| A46 | **Parent–Student link verification** may be performed by a MARKAZ_ADMIN or a TEACHER **only** when that person holds the explicit, tenant-scoped permission `parent_link.verify` in the link's Markaz. The role alone is never sufficient; there is no cross-tenant verification authority. | Owner decision B (2026-10-13) |
| A47 | **Explicit permissions are not implied by roles.** `parent_link.verify` is granted per person per Markaz and is checked explicitly. No default holder is approved — nobody holds it automatically. | Owner decision B (2026-10-13) |
| A48 | **Only ACTIVE grants Parent access.** PENDING = requested, not verified; VERIFIED = verified by an authorized verifier; ACTIVE = access enabled; REVOKED = access disabled. PENDING, VERIFIED and REVOKED grant nothing. **Who moves VERIFIED → ACTIVE is NOT decided.** Confirms the foundation's ACTIVE-only reading of A41. | Owner decision C (2026-10-13) |
| A49 | **Default UI language: Kiswahili.** | Owner decision E (2026-10-13) |
| A50 | **English and Arabic are user-selectable**; Arabic uses RTL layout; the choice persists for the user/browser. Scope: application UI strings, not domain data. | Owner decision E (2026-10-13) |
| A51 | **Teacher roster:** a Teacher may see BASIC roster information for Students in their Markaz, and DETAILED Student information only for Students in classes they are authorized to teach. Basic roster visibility never unlocks private corrections, assessments, sensitive notes or full history. | Owner decision F (2026-10-13) |
| A52 | **Markaz Admin appointment:** a Markaz Admin may REQUEST another Markaz Administrator but may not grant the role; only a SUPER_ADMIN approves or rejects; no self-approval; the membership is granted on approval. | Owner decision G (2026-10-13) |
| A53 | **Standalone correction clips (P10 approved).** Every finalized correction audio clip must exist as its own storage object; a correction never stays dependent on the parent full-session recording; deleting a recording must not destroy a finalized correction's audio. | Owner decision H (2026-10-13) |
| A54 | **Reaffirmed:** hybrid correction audio source (A43); RTC vendor undecided — any audio/recording architecture stays vendor-neutral (A35); Supabase Storage remains the direction, with no production bucket changes (A38). | Owner decisions H, I, J (2026-10-13) |
| A55 | **Parent link activation:** VERIFIED → ACTIVE only by a MARKAZ_ADMIN or TEACHER holding explicit `parent_link.activate` in the link's Markaz. The role alone is not enough; no cross-tenant activation. | Owner decision A (2026-10-13, 3rd) |
| A56 | **Parent link creation/request:** a link may be initiated by the Parent (self-request, tenant-bound, never self-activating) or by staff holding explicit `parent_link.create` in that Markaz. Not every Teacher can initiate. | Owner decision B (2026-10-13, 3rd) |
| A57 | **Parent link revocation:** a Parent may revoke/withdraw their own link; staff holding explicit `parent_link.revoke` in the link's Markaz may revoke. No parent revokes another parent's link; no cross-tenant staff revocation. | Owner decision C (2026-10-13, 3rd) |
| A58 | **Assigning `parent_link.verify`:** Super Admin may assign verification permissions platform-wide; a Markaz Admin may assign `parent_link.verify` to eligible Teachers in their own Markaz only; Teachers may not assign it. Replaces the interim "Super Admin only" rule. | Owner decision D (2026-10-13, 3rd) |
| A59 | **Teacher invitations** require explicit `invitation.create` in that Markaz; tenant-bound; Teachers may not invite Super Admins or Markaz Admins. Allowed targets: STUDENT, PARENT. | Owner decision E (2026-10-13, 3rd) |
| A60 | **Invitation lifetime is exactly 7 days** — a business rule, no longer an engineering default. | Owner decision F (2026-10-13, 3rd) |
| A61 | **Parent invitations** may be issued by a MARKAZ_ADMIN or a TEACHER holding `invitation.create`. Acceptance onboards a Parent account and never grants child access; any proposed child becomes a normal PENDING → VERIFIED → ACTIVE link request. | Owner decision G (2026-10-13, 3rd) |
| A62 | **Delegation:** a Markaz Admin may assign all five explicit permissions (`parent_link.create/verify/activate/revoke`, `invitation.create`) to ACTIVE Teachers in their OWN Markaz only. Not across tenants, not to themselves, never platform/global privileges. Teachers cannot assign. Super Admin may assign across tenants. | Owner decision A (2026-10-13, 4th) |
| A63 | **Parent invitation proposing a child** requires BOTH `invitation.create` AND `parent_link.create` in that Markaz. Without a child, the right to invite is enough. The result is only ever a PENDING link. | Owner decision B (2026-10-13, 4th) |
| A64 | **Parent self-request** identifies the child by Markaz code + student email, OR Markaz code + student ID / registration number. The response must not reveal whether the Markaz, student, email, ID or relationship exists. | Owner decision C (2026-10-13, 4th) |
| A65 | **Supabase environment:** one project only for now, `elimu-yenye-manufaa`. Supabase project `elimu-yenye-manufaa` is currently used as the development environment. It must not be treated as production until the project owner explicitly approves production readiness. | Owner decision (2026-10-13, 4th) |
| A66 | **Correction-media ownership & access.** Readers: the student (always); a parent with an **ACTIVE** link — across **all** Markaz where the child has corrections (intentional, not scoped to the link's Markaz); the authoring teacher **only while an ACTIVE teacher** of that Markaz (a departed teacher loses access; the media/history belongs to the Markaz); a **Markaz Admin of that Markaz** (never another Markaz's); a **Super Admin** for support/audit across tenants — **every Super Admin correction-media / recording-media read writes an audit event**. PENDING / VERIFIED / REVOKED parents: no access. | Owner decision (2026-10-14) |
| A67 | **Option B correction content:** annotation + note/context + correction timestamp + short audio clip; **flexible anchors** (lesson, page, chunk, segment, timestamp) that can later attach to real content entities without fake foreign keys, with a **historical snapshot** so the correction stays understandable if the content is removed. | Owner decision (2026-10-14) |
| A68 | **Multiple clips per correction**, exactly one **primary/current**; replacing a clip never overwrites — the old clip stays as history and the new finalized clip becomes primary. | Owner decision (2026-10-14) |
| A69 | **Correction clip format:** AAC audio in an M4A container, **maximum 60 seconds**, validated at the application/service layer. **No maximum file size is approved.** | Owner decision (2026-10-14) |
| A70 | **Minors:** date of birth is stored; minor/adult status is **derived** from it (no manually maintained is_minor flag). | Owner decision (2026-10-14) |
| A71 | **Minor consent:** default — an ACTIVE parent/guardian consents (online); alternative — a Markaz Admin records **verified offline consent** after checking evidence. Online and verified-offline consent are distinguished; who gave, who recorded/verified, when and method are auditable; only a reference to the evidence is stored. | Owner decision (2026-10-14) |
| A72 | **Consent scope & effects:** one consent policy covers correction clips **and** full recordings. The recording-start notice (A30) is still required. Without valid consent a student may join, listen, participate and receive live mic permission, but their audio must **not** be included in recorded media (live mic permission and recording eligibility are separate). **Withdrawal** blocks future recording and correction-audio capture and sends existing affected media into the deletion/review workflow — no immediate hard delete. | Owner decision (2026-10-14) |
| A73 | **Deletion authority:** deletion may be **requested** by the authoring Teacher or a Markaz Admin; **final approval only by a Markaz Admin** (never a Teacher). Whether an admin may approve their **own** request is **not decided** (OQ36). | Owner decision (2026-10-14) |
| A74 | **Deletion lifecycle:** REQUEST → MARKAZ ADMIN APPROVAL → SOFT DELETE / RESTRICT → ARCHIVE → **30-day grace period** → PHYSICAL MEDIA PURGE. Normal playback stops at approved soft deletion. "Permanent deletion" removes the storage object only; historical metadata and audit/history records remain. | Owner decision (2026-10-14) |
| A75 | **Referenced media:** media belonging to an academic correction/history record is restricted, its metadata/history retained, and its bytes purged later under A74 — correction history is never destroyed by a media purge. | Owner decision (2026-10-14) |
| A76 | **Anchor deletion:** removing referenced lesson/page/chunk content never deletes the correction; a historical snapshot explains what it referred to. | Owner decision (2026-10-14) |
| A77 | **Full recordings stay provider-neutral** (A35 unchanged): metadata, tenant ownership, teacher author, approval state and audit, participants/consent eligibility, parent visibility checks, optional segments, extraction provenance, deletion lifecycle — no Agora/LiveKit recording, egress, worker, transcoding or capture. | Owner decision (2026-10-14) |
| A78 | **Recording approval:** the Teacher owns the teaching workflow and may **submit**; a **Markaz Admin** reviews, **approves** and may later **revoke**. Default approval covers the **whole recording**; **segment approval** is a special case. A parent sees a recording only if it is APPROVED **and** the link is ACTIVE **and** applicable consent rules are satisfied — never merely because the object exists. | Owner decision (2026-10-14) |
| A79 | **Approval revocation is not deletion:** revoked media stays stored/history-retained under the retention rules but is hidden from ordinary parent visibility. States: DRAFT → PENDING_APPROVAL → APPROVED → REVOKED (no rejection/return workflow approved). | Owner decision (2026-10-14) |
| A80 | **Mandatory audit events:** Super Admin media access, recording approval and revocation, deletion request and approval, physical purge, verified offline consent, consent withdrawal (actor, tenant, action, target type/id, time; never secrets or signed URLs). | Owner decision (2026-10-14) |
| A81 | **Minor = age < 18; adult = age ≥ 18**, derived from the date of birth (no stored is_minor flag). Resolves OQ34. | Owner decision (2026-10-15) |
| A82 | **DOB entry & verification:** the DOB may be entered by the student or a parent/guardian; a **Markaz Admin must verify it** before it is trusted for consent/minor decisions. Until verified, recording eligibility fails closed. Entered by/at and verified by/at are tracked; the DOB is not broadly exposed. | Owner decision (2026-10-15) |
| A83 | **Adult consent & withdrawal:** an adult student gives their **own** consent during the enrollment/account flow and may withdraw it. For a minor, an **ACTIVE guardian** may withdraw consent. Withdrawal keeps A72's effects (future capture blocked; existing media to review/deletion; no immediate hard delete). Resolves OQ35 and part of OQ40. | Owner decision (2026-10-15) |
| A84 | **No deletion self-approval:** a Markaz Admin must not approve a deletion request they created; a **second eligible Markaz Admin** is required. With only one admin the request stays pending, with a clear status — never silently self-approved. Resolves OQ36 for deletion. | Owner decision (2026-10-15) |
| A85 | **Deletion cancel / decline:** the requester may **cancel** their own pending request; a Markaz Admin may **decline** a pending request. States PENDING / APPROVED / DECLINED / CANCELLED; actor and time recorded; optional decline reason. Media is untouched on DECLINED or CANCELLED. Resolves OQ43. | Owner decision (2026-10-15) |
| A86 | **Abandoned uploads:** unfinalized correction-audio uploads are cleaned up after **7 days** by a safe, re-runnable server-side cleanup; finalized clips are never cleaned for age. No production scheduling. Resolves OQ37. | Owner decision (2026-10-15) |
| A87 | **Recording review flow:** PENDING_APPROVAL → REJECTED (Markaz Admin); the teacher may fix and **resubmit** after rejection or after approval revocation (REVOKED → PENDING_APPROVAL); never auto-re-approved; the Markaz Admin stays the final approver. Submit, approve, reject, revoke and resubmit are audited. Resolves OQ39. | Owner decision (2026-10-15) |
| A88 | **Current clip promotion:** when the current clip is deleted/restricted, nothing is promoted automatically; the **teacher or a same-tenant Markaz Admin** explicitly chooses a historical finalized, non-deleted, non-purged clip of the same correction. One current clip at a time; audited; history preserved; a correction may temporarily have no current clip. Resolves OQ44. | Owner decision (2026-10-15) |
| A89 | **Teacher recording notice:** teachers need no separate consent flow but must receive (and acknowledge) a recording notice, distinct from student consent and never treated as guardian/student consent. No employment/legal logic. Resolves OQ45 (teacher part). | Owner decision (2026-10-15) |
| A90 | **Option C enablement:** Markaz Admin → **request** → Super Admin → **approve/enable**. Teachers cannot enable it. Provider-neutral tenant **entitlement only** — no pricing, payment, billing or subscription logic. Resolves OQ45 (Option C part). | Owner decision (2026-10-15) |
| A91 | **Correction clip maximum file size: 10 MB** (in addition to AAC in M4A and ≤ 60 s), enforced at the service layer. Resolves OQ38. | Owner decision (2026-10-15) |
| A92 | **Recording self-review allowed:** a Markaz Admin who is also the recording's author/teacher MAY approve or reject their own recording. This deliberately differs from deletion: a requester may **never** approve their own deletion request (A84 unchanged). Resolves OQ46 (recording part). | Owner decision (2026-10-16) |
| A93 | **No DOB self-verification:** a Markaz Admin who entered a student's DOB must not verify it; another eligible Markaz Admin must. With no second admin the DOB stays unverified and recording eligibility stays fail-closed; the UI explains why. Resolves OQ46 (DOB part). | Owner decision (2026-10-16) |
| A94 | **Student full-recording access:** a student may view their own full recording when it is APPROVED, not deleted/restricted, they participated, and their consent was valid for that recording. No parent link needed. | Owner decision (2026-10-16) |
| A95 | **Parent full-recording visibility** requires ALL: ACTIVE link; APPROVED; not deleted/restricted; the child participated; the child's consent was **valid at the time the recording was made**. A later withdrawal does not automatically hide the old recording; it sends the media to the review/deletion workflow and blocks future capture. Resolves OQ41. | Owner decision (2026-10-16) |
| A96 | **Option C lifecycle:** the requesting Markaz Admin may **cancel** a pending request; a Super Admin may **decline** a pending request and **disable** an enabled entitlement. States NOT_ENABLED / PENDING / ENABLED / DECLINED / CANCELLED / DISABLED; every step audited. Disabling deletes nothing; it blocks new full-recording creation/start. No billing. Resolves OQ48. | Owner decision (2026-10-16) |
| A97 | **Verified offline consent is Markaz-specific:** consent verified by Markaz A is valid for A's recording/correction capture only; Markaz B needs its own applicable consent. Online ACTIVE-guardian consent is unchanged. Resolves OQ47. | Owner decision (2026-10-16) |
| A98 | **10 MB = 10 × 1024 × 1024 = 10,485,760 bytes**, used consistently (constant, service, DB CHECK, bucket limit). Resolves OQ50. | Owner decision (2026-10-16) |
| A99 | **Departed student and full recordings:** after a student's membership in a Markaz ends, full class recordings of that Markaz are DENIED to them — they are restricted Markaz content, not the student's own submission. The student keeps their own corrections/submissions (A32). Resolves OQ51. | Owner decision (2026-10-16, apply instruction) |
| A100 | **Option C re-request:** a new request is allowed after DECLINED, CANCELLED or DISABLED. Every re-request starts a NEW approval cycle needing Super Admin approval again; DISABLED never returns to ENABLED automatically. Resolves OQ52. | Owner decision (2026-10-16, apply instruction) |
| A101 | **Live Class MVP is MARKAZ-ONLY.** The independent/private Teacher is not part of the MVP (a future own tenant/workspace, out of scope). A Markaz Admin never gains access across tenant boundaries. | Owner TO-BE approval (2026-10-19) |
| A102 | **Persistent Class entity.** Every Class belongs to exactly one Markaz and has one Primary Teacher, zero or more Co-Teachers, explicit student enrollment, an optional recurring schedule, an enrollment capacity, a live concurrent capacity and a lifecycle status. A student may belong to several Classes. A live session MUST belong to a Class. | Owner TO-BE approval (2026-10-19) |
| A103 | **Class teacher roles:** PRIMARY (exactly one active per Class) and CO_TEACHER (zero or many). Assignment is tenant-scoped and allowed only for ACTIVE Teacher memberships in that same Markaz. | Owner TO-BE approval (2026-10-19) |
| A104 | **Teacher membership ending** does not delete the Class or historical sessions/data; a Markaz Admin may assign a replacement; ownership is never silently reassigned. | Owner TO-BE approval (2026-10-19) |
| A105 | **Substitute Teacher** is assigned per live session by the Primary Teacher or a Markaz Admin; must be an ACTIVE Teacher in the same Markaz; temporary for that session; never becomes Primary or Co-Teacher automatically. | Owner TO-BE approval (2026-10-19) |
| A106 | **Class enrollment:** a student needs an ACTIVE STUDENT membership in the Markaz AND an explicit Class enrollment. Enrollment may be created by an assigned Teacher or a Markaz Admin. A student may have several enrollments; history is preserved (no hard delete when access expires). States equivalent to ACTIVE / GRACE / SUSPENDED / ENDED. | Owner TO-BE approval (2026-10-19) |
| A107 | **Flexible payment/access model** (a product may represent a Class, a Subject, a Package or another Markaz-configured arrangement). MVP: **manual verification** — a Teacher may submit payment evidence/details; a Teacher does NOT verify payment by default; a Markaz Admin / future finance authority verifies; VERIFIED payment activates eligible enrollment/access. No pricing, gateway, provider, bank/mobile-money integration or revenue sharing. | Owner TO-BE approval (2026-10-19) |
| A108 | **Grace period: default 7 days.** ACTIVE → (access period expires) → GRACE → SUSPENDED if unpaid after grace; renewed/verified GRACE or SUSPENDED → ACTIVE. Grace extension by an assigned Teacher of the Class or a Markaz Admin, recording student/enrollment, graceUntil, reason, grantedBy, grantedAt; date chosen manually; no arbitrary maximum; audited. | Owner TO-BE approval (2026-10-19) |
| A109 | **Two capacities:** enrollment capacity and live concurrent student capacity. They count STUDENTS only (never Primary/Co/Substitute Teacher or Markaz Admin). A plan/package may define a maximum; a Class may use a value at or below it. **Exact numbers are NOT approved** (A33 unchanged): configurable fields/logic only. | Owner TO-BE approval (2026-10-19) |
| A110 | **Full class:** enrollment capacity reached → WAITLIST by default; a Markaz Admin may perform a controlled override recording actor, reason and time; capacity is never exceeded silently. Live capacity reached → the student is WAITING_FOR_SLOT and not counted as admitted until a slot is free. | Owner TO-BE approval (2026-10-19) |
| A111 | **Persistent LiveSession** belonging to one Markaz and one Class; scheduled and ad hoc sessions; states equivalent to SCHEDULED / WAITING / LIVE / ENDED / CANCELLED (no unnecessary states). | Owner TO-BE approval (2026-10-19) |
| A112 | **Scheduling:** scheduled is the default; Classes may have recurring schedules; timestamps stored in UTC; displayed/interpreted in the Markaz time zone (EAT is not hard-coded); scheduled start/end, actual start/end, cancellation (+ actor/reason). Student waiting access and authorized start both from 15 minutes before the scheduled start. | Owner TO-BE approval (2026-10-19) |
| A113 | **Start/end:** Primary, Co-Teacher, the assigned Substitute, Markaz Admin. **Cancel a scheduled session:** Primary Teacher and Markaz Admin only (not Co-Teacher/Substitute). Manual end is primary. Safety auto-close at scheduled end + 30 minutes if still live — deterministic service + safe "close stale sessions" entry point + tests; **no production scheduler**. | Owner TO-BE approval (2026-10-19) |
| A114 | **Ad hoc sessions** allowed with a configurable default duration (60 minutes), changeable by the Teacher when creating/starting; a default, not a commercial limit; same safety close. | Owner TO-BE approval (2026-10-19) |
| A115 | **Markaz Admin = operational, not teaching:** may start/end, remove participants, grant/revoke mic, perform operational overrides and view/manage attendance; does NOT automatically get whiteboard authoring, screen share as a Teacher, or the Primary/Co/Substitute role. | Owner TO-BE approval (2026-10-19) |
| A116 | **Co-Teacher** may teach, use the whiteboard, control student mic, manage attendance and take part in session operation; may NOT change Class configuration, replace the Primary, change plan/capacity or perform Markaz administration unless separately authorized. | Owner TO-BE approval (2026-10-19) |
| A117 | **Vendor-neutral live participation:** raise hand, grant mic, revoke mic, and only ONE student with speaking permission at a time — business state only, no LiveKit/Agora dependency. | Owner TO-BE approval (2026-10-19) |
| A118 | **Whiteboard permissions:** Teachers write; students cannot by default; a Teacher grants/revokes write to an individual student; private correction content never becomes public class content; the pilot public Supabase broadcast channel is not reused. | Owner TO-BE approval (2026-10-19) |
| A119 | **Screen share** allowed for Primary, Co-Teacher, Substitute; not for Student, Parent or Markaz Admin by default. Authorization model only. | Owner TO-BE approval (2026-10-19) |
| A120 | **Class chat** is public to the Class and persistent. After the session: enrolled students (per access rules), Primary, Co-Teachers, the Substitute where historically relevant, the Markaz Admin. Denied: parents, unrelated students, other Markaz, unrelated Teachers. Tenant + class + session scoped; authorship preserved. | Owner TO-BE approval (2026-10-19) |
| A121 | **Multiple devices:** one PRIMARY interactive device + a second VIEW-ONLY device; the second never publishes student mic, never obtains whiteboard write, never creates duplicate attendance duration or double-counts capacity. | Owner TO-BE approval (2026-10-19) |
| A122 | **Attendance:** automatic from join/leave/presence; manual correction by Primary, Co-Teacher, Markaz Admin (not automatically the Substitute), audited; LATE threshold = scheduled start + 15 min; ≥ 50 % of the session = PRESENT; otherwise ABSENT/LATE consistently; no extra grades; raw presence stored internally; a Parent sees PRESENT/LATE/ABSENT only, never raw join/leave timestamps. | Owner TO-BE approval (2026-10-19) |
| A123 | **Whole-session replay is Option C only.** Option C entitlement is checked (1) when a session begins in a recording-enabled mode and (2) again when recording starts. Ordinary non-recorded participation never requires Option C. Recordings link to the LiveSession; the existing recording foundation is extended, not rebuilt. Resolves OQ18. | Owner TO-BE approval (2026-10-19) |
| A124 | **Recording participants** come from Live Session attendance/presence (not a free-form teacher list once session integration exists); before finalization the list may be corrected by Primary, Co-Teacher or Markaz Admin, audited. | Owner TO-BE approval (2026-10-19) |
| A125 | **Consent at capture:** snapshot when recording starts for those present; a student joining later may still join/listen/participate, but their audio must not enter the recording until their consent check passes. Live participation never depends on recording consent. | Owner TO-BE approval (2026-10-19) |
| A126 | **Existing recording/media rules remain unchanged** (DOB verification, under-18 rule, adult self-consent, guardian consent, Markaz-specific offline consent, withdrawal, consent at capture, approval/rejection/revocation, student/parent access, Option C lifecycle, correction media, deletion lifecycle, append-only audit). | Owner TO-BE approval (2026-10-19) |
| A127 | **Parent and Live Class:** a Parent sees child attendance status and existing approved corrections/recordings per existing policy; does NOT join live automatically, see live or stored chat, see raw attendance timestamps, operate mic, write the whiteboard or manage sessions. No live-monitoring access. | Owner TO-BE approval (2026-10-19) |
| A128 | **RLS conservative:** sensitive/administrative Live Class tables may stay server-only; no broad Data API access for convenience; when uncertain, server-only and documented. | Owner TO-BE approval (2026-10-19) |
| A129 | **Audit** important Live Class actions (class, teacher assignment, capacity override, enrollment transitions, grace, sessions incl. safety close and substitute, attendance adjustment, mic, recording participant adjustment, payment submission/verification) without secrets, signed URLs, payment credentials or raw evidence. | Owner TO-BE approval (2026-10-19) |
| A130 | **Provider-neutral Live Class shell only** while the RTC vendor is unresolved (A35): may show status, teachers, presence/waiting room, raise hand, mic/whiteboard permission, chat and recording eligibility — no media transport, no LiveKit/Agora SDK, and the UI must not pretend audio works. | Owner TO-BE approval (2026-10-19) |

| A131 | **Markaz time zone must be chosen explicitly** during Markaz setup before scheduling is usable. No zone is invented and nothing is silently scheduled in UTC: scheduling fails closed until a valid IANA zone is configured; the UI states that setup is required. Resolves OQ54. | Owner decision (2026-10-19, final corrections) |
| A132 | **Attendance and punctuality are separate.** Attendance: PRESENT when attended ≥ 50 % of the session, otherwise ABSENT. Punctuality: ON_TIME when the first qualifying arrival is ≤ scheduled start + 15 min, LATE when later. PRESENT + LATE, PRESENT + ON_TIME and ABSENT + LATE are all possible; PRESENT never overwrites LATE. A parent may see attendance and punctuality status, never raw join/leave timestamps. Resolves OQ53; supersedes the interim single-status precedence. | Owner decision (2026-10-19, final corrections) |
| A133 | **SUSPENDED enrollment** keeps its enrollment/history but does NOT count against enrollment capacity; only access states that currently occupy an active seat count. Resolves OQ56 (seat part). | Owner decision (2026-10-19, final corrections) |
| A134 | **Waitlist admission is FIFO by default;** a Markaz Admin may override the order, recording actor, reason and time, audited; the queue is never reordered silently. Resolves OQ56 (waitlist part). | Owner decision (2026-10-19, final corrections) |
| A135 | **Payment required per Class** (`payment_required` true/false). False: access activates under the normal enrollment rules. True: a VERIFIED payment/access authorization is required before first active access. Not every class is paid; no pricing. Resolves OQ57 (payment part). | Owner decision (2026-10-19, final corrections) |
| A136 | **Finance authority:** final payment verification by the Markaz Admin or a Finance Officer / Accountant, implemented as the explicit, tenant-scoped capability `payment.verify`. A Teacher may submit evidence but never verifies by default and never receives `payment.verify` automatically. No broader finance powers. Resolves OQ57 (finance part). | Owner decision (2026-10-19, final corrections) |
| A137 | **Teacher detailed student access (A51) wired to classes** — not a new rule: only an ACTIVE Teacher of that Markaz, currently assigned as Primary or Co-Teacher to a class in which the student has active access (ACTIVE/GRACE). A Substitute gets no ongoing detailed access; Markaz Admins keep own-Markaz access; cross-tenant denied. Resolves OQ58. | Existing rule A51, implementation confirmed (2026-10-19) |
| A138 | **Student mic handoff:** granting Student B while Student A holds the mic automatically revokes A and grants B, keeping one-student-at-a-time; both transitions are audited. Business state only. Resolves OQ56 (mic part); supersedes the interim "refuse until revoked". | Owner decision (2026-10-19, final corrections) |
| A139 | **Plan capacity ceilings are set by a Super Admin** (confirmed). Exact capacity numbers remain unresolved; no Starter/Standard/Pro defaults. Resolves OQ55. | Owner decision (2026-10-19, final corrections) |

| A140 | **Finance Officer / Accountant is a real non-teaching Markaz role** (`FINANCE_OFFICER` tenant membership: tenant-scoped, ACTIVE/ENDED, invited by a Markaz Admin or Super Admin). **Teacher cannot verify payment.** Payment verification and rejection: ACTIVE Markaz Admin or ACTIVE Finance Officer of that Markaz only — never Primary/Co/Substitute Teacher, Student or Parent. Teachers (and Finance Officers, Markaz Admins) may submit payment evidence. `payment.verify` is no longer grantable to anyone. A Finance Officer gets only the finance data needed for verification — no class configuration, enrollment management (activation as a side effect of verification is allowed), grace, waitlist or capacity overrides, session control, attendance, mic, whiteboard, screen share, chat, corrections, recordings, roster or detailed student data. Supersedes the A136 implementation choice (explicit `payment.verify` grant to staff incl. Teachers). | Owner decision (2026-10-19, finance-role correction) |

### 1.11 Supersession record (2026-10-19, finance-role correction)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| A136 (implementation) | Finance authority = explicit `payment.verify` grant, holdable by a Markaz Admin or **Teacher**; a finance-only person needed a Teacher membership. | A140 | **Superseded:** dedicated `FINANCE_OFFICER` role; `payment.verify` removed from the grantable permissions; the DB enum value `PAYMENT_VERIFY` is legacy and refused by a CHECK. A136's statement "Markaz Admin or Finance Officer / Accountant verifies; a Teacher does not by default" stands, now strictly "a Teacher never verifies". |

### 1.10 Supersession record (2026-10-19, final Live Class corrections)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| Interim OQ53 | One attendance enum; ≥ 50 % PRESENT, else LATE (late arrival), else ABSENT. | A132 | **Superseded:** two dimensions (attendance PRESENT/ABSENT + punctuality ON_TIME/LATE). The `AttendanceStatus.LATE` enum value is kept only as a LEGACY label and refused by a DB CHECK. |
| Interim OQ54 | Markaz zone defaults to `UTC` until set. | A131 | **Superseded:** no default; `tenants.timezone` is nullable; scheduling fails closed; rows that only had the old default are cleared by migration. |
| Interim OQ56 | SUSPENDED keeps its seat; waitlist FIFO with no override; mic grant refused while held. | A133, A134, A138 | **Superseded:** SUSPENDED frees the seat; admin order override (audited); automatic audited handoff. |
| Interim OQ57 | Enrollment ACTIVE immediately; verification Markaz Admin only. | A135, A136 | **Superseded:** per-class `payment_required`; `payment.verify` finance authority. |
| A122 (attendance wording "otherwise ABSENT/LATE") | — | A132 | **Clarified.** |
| A107 ("Markaz Admin / future finance authority verifies") | — | A136 | **Completed.** |

### 1.9 Supersession and refinement record (2026-10-19, Live Class foundation)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| live-class.md "Permissions" (PROPOSED) | Only the class's teacher starts/ends, grants mic/whiteboard; attendance/chat visible to the teacher and Super Admin. | A113, A115–A120, A122 | **Superseded:** Primary/Co/Substitute/Markaz Admin split; Super Admin gets no Live Class power; chat/attendance visibility per A120/A122. |
| A13 / A24 + OQ18 | Lesson recording and replay; relation to Option C open. | A123 | **Resolved:** whole-session replay is Option C only; ordinary participation never needs it. |
| A15 / A33 | Capacity varies by plan; no numbers. | A109, A110 | **Refined:** two capacities, students only, plan ceiling + class value, waitlist/override; numbers still not approved. |
| A51 | Detailed student data only for "classes they teach" — classes did not exist. | A102–A106 | **Enabled:** classes now exist. The roster resolver (`NO_CLASSES_YET`) is deliberately left unchanged in this pass (no new detailed-data surface was added); see OQ58. |
| payments.md (2026-10-13) | No payment/entitlement tables at all. | A107 | **Refined:** a narrow manual submission → verification → access-period foundation only; the A34 concepts and all commercial terms stay undecided. |
| Interim (engineering, 2026-10-19) | — | — | **Interpretations made while implementing (owner to confirm, OQ53–OQ58):** attendance precedence; Markaz default time zone "UTC"; plan ceilings set by a Super Admin; SUSPENDED enrollments keep their seat; FIFO waitlist/slot promotion; a mic grant while another student holds it is refused (no auto-switch). |

### 1.8 Supersession and refinement record (2026-10-16)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| Interim (2026-10-15) | An admin who authored a recording may not review it. | A92 | **Superseded:** allowed. Deletion self-approval (A84) unchanged. |
| Interim (2026-10-15) | An admin may not verify a DOB they entered. | A93 | **Confirmed** as a decision, plus a DB CHECK. |
| Interim (2026-10-14) | Students get no full-recording access. | A94 | **Superseded:** own approved recordings under gates. |
| Interim (2026-10-14) | Parent visibility required the child's consent to be valid NOW. | A95 | **Superseded:** consent valid AT CAPTURE (the participant snapshot). |
| A90 | Request → enable only. | A96 | **Extended:** cancel, decline, disable. |
| Interim (2026-10-14) | Offline consent valid in the verifying Markaz only. | A97 | **Confirmed.** |
| A91 | 10 MB (unit to confirm). | A98 | **Confirmed:** 10,485,760 bytes. |

### 1.7 Supersession and refinement record (2026-10-15, media policy decisions)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| Interim (2026-10-14) | Age threshold unset → nobody recording-eligible. | A81 | **Superseded:** under 18 = minor. |
| Interim (2026-10-14) | A guardian or a Markaz Admin may record the DOB; recording = trusted. | A82 | **Superseded:** student or guardian enters; a Markaz Admin verifies; unverified = not eligible. Markaz Admins no longer enter DOBs. |
| Interim (2026-10-14) | Adults not eligible (adult consent undecided). | A83 | **Superseded:** adults consent for themselves (SELF_ONLINE). |
| Interim (2026-10-14) | Withdrawal: online by an ACTIVE guardian; offline by a Markaz Admin. | A83 | **Superseded:** adult withdraws own; for a minor an ACTIVE guardian withdraws (any of the minor's consents). Markaz Admins no longer withdraw. |
| A73 / interim | Admin self-approval undecided; refused. | A84 | **Decided:** refused; second admin required (also a DB CHECK). |
| A74 / interim | Requests only PENDING → APPROVED. | A85 | **Extended:** DECLINED and CANCELLED. |
| Interim | Abandoned-upload cleanup had no default age. | A86 | **Decided:** 7 days. |
| A69 / interim | No file-size limit. | A91 | **Extended:** 10 MB maximum. |
| A79 | No rejection workflow; REVOKED final. | A87 | **Extended:** REJECTED and resubmission after rejection or revocation. |
| Interim | No automatic promotion of an older clip. | A88 | **Confirmed** and extended with explicit selection. |
| OQ45 | Teacher consent; Option C enablement. | A89, A90 | **Resolved.** |

### 1.6 Supersession and refinement record (2026-10-14, recording & correction media)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| A17 (as amended by A41) | Private correction: student + teacher (+ ACTIVE parent). Markaz Admins excluded. | A66 | **Superseded in part:** a Markaz Admin of the correction's own Markaz may read; a Super Admin may read with a mandatory audit event; the authoring teacher only while ACTIVE. |
| OQ15 | Option B clip source and lifecycle. | A43 (2026-10-13) | Already resolved; the tracker row was stale and is now marked resolved. |
| OQ16 | Authorized deleter; deletion mechanics. | A73–A75 | **Resolved**, except whether an admin may approve their own request (new OQ36). |
| OQ17 | Consent for minors. | A70–A72 | **Resolved**, except the age threshold (OQ34) and the adult consent flow (OQ35). |
| OQ19 | Teacher departure. | A66 | **Resolved:** departed teacher loses access; media/history belongs to the Markaz. |
| OQ20 | Anchor removal for retained corrections. | A67, A76 | **Resolved:** historical snapshot; the correction is never deleted. |
| OQ23 | What makes a recording "approved". | A78, A79 | **Resolved.** |
| AS-IS audit finding M1 | Parent visibility ignored the link's Markaz. | A66 | **Confirmed intentional:** ACTIVE parent access spans all of the child's Markaz. |
| A31 | Recordings kept until an authorized user deletes them (mechanics open). | A73–A75 | **Refined:** mechanics and authority now defined. |

### 1.5 Supersession and refinement record (2026-10-13, fourth update)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| A58 + interim OQ31 | Markaz Admin may assign only `parent_link.verify`; the other four by Super Admin only (interim). | A62 | **Superseded:** Markaz Admins may assign all five to their own ACTIVE Teachers. |
| Interim OQ32 | Child proposal needs `parent_link.create` (plus the right to invite). | A63 | **Superseded and tightened:** needs BOTH explicit grants, `invitation.create` + `parent_link.create`, including for Markaz Admins. |
| Interim OQ33 | Self-request by Markaz code + student email. | A64 | **Extended:** Markaz code + email OR + student registration number. |
| Technical (not a business rule) | No student ID existed. | A64 | Added `memberships.registration_number` for STUDENT memberships: 8 characters from an unambiguous alphabet, random, assigned once by trigger, immutable, unique per Markaz. |
| Technical (security) | Invite flow used `shouldCreateUser: true`, which needs public sign-ups enabled. | A45 | **Changed:** OTP never creates accounts. Invited accounts are created server-side via the admin API after token validation, so **public sign-ups can stay disabled** in Supabase. |

### 1.4 Supersession and refinement record (2026-10-13, parent workflow / invitations)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| OQ14 | Who activates, creates and revokes links; who holds or assigns verify. | A55–A58 | **Resolved.** Nobody holds any explicit permission by default (unchanged). |
| OQ27 | Teacher invitations. | A59 | **Resolved.** |
| OQ28 | Invitation lifetime (7-day engineering default). | A60 | **Resolved** — 7 days is now a business rule. |
| OQ29 | Who creates/requests a parent link; parent invitations. | A56, A61 | **Resolved.** |
| OQ30 | Who assigns `parent_link.verify`. | A58 | **Resolved**; the interim "Super Admin only" rule is superseded. |
| A47 | One explicit permission (`parent_link.verify`). | A55–A59 | **Extended** to five: `parent_link.create/verify/activate/revoke`, `invitation.create`. |
| A40 / Phase 2A rows | Markaz Admin invites TEACHER/STUDENT. | A61 | **Extended:** Markaz Admins may also invite PARENT (by role, as A61 names them without requiring a grant). |
| Interim (engineering) | — | — | **Not yet decided, interim in code:** only a Super Admin may assign `parent_link.create`, `parent_link.activate`, `parent_link.revoke` and `invitation.create` (open question 31). Proposing a child in a parent invitation requires `parent_link.create` (open question 32). A parent self-request names the child by Markaz code + the child's email (open question 33). |

### 1.3 Supersession and refinement record (2026-10-13, Phase 1.5 / 2A)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| P10 (Proposed) | Standalone clip object; segment pointer as provenance only. | A53 | **Superseded — approved.** |
| OQ14 | Parent linking: verifier, VERIFIED semantics, write access. | A46–A48 | **Partially resolved:** verifier eligibility (MA/Teacher + explicit permission) and ACTIVE-only access decided. Still open: who moves VERIFIED → ACTIVE, who creates/requests a link, who revokes, and who holds or assigns `parent_link.verify`. |
| OQ22 | Auth method and sign-up flow. | A45 | **Resolved:** invite-first + email OTP / magic link. |
| OQ24 | Default UI language. | A49, A50 | **Resolved.** |
| OQ25 | Teacher roster visibility. | A51 | **Resolved.** The foundation's earlier deny-all rule for teachers (and its RLS test) is superseded; the test was rewritten to the new boundary. |
| OQ26 | Can a Markaz Admin appoint Markaz Admins? | A52 | **Resolved:** request only; Super Admin approves. |
| A26/A40 rows | Markaz Admin permissions. | A52 | **Refined:** "manage teachers/students" never includes granting MARKAZ_ADMIN directly. |

### 1.2 Supersession and refinement record (2026-10-13)

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| P1 (Proposed) | Next.js + TS + Supabase on Vercel. | A39 | **Superseded — approved, and extended with Prisma ORM.** |
| A17 (Approved) | A private correction is visible to "only that student + teacher". | A41 | **Superseded in part (explicit exception):** a Parent with an ACTIVE link to the student may also see that student's corrections. Teacher-private notes remain excluded from Parent view. No other party is added. |
| A26 (Approved) | Markaz Admin: broad operational authority inside own Markaz; exact rows open. | A40 | **Refined:** "full tenant administrator" for documented capabilities; the upper bound is unchanged. |
| P7 (Proposed, in part) | Parent linked *read-only*. | A41 | **Still not decided as such.** A41 defines what a Parent may *see*; no decision grants a Parent write access, and none is implemented. |
| P3 (Proposed) | Shared schema + `tenant_id` + RLS, with tenant/role claims **in the JWT**. | Foundation implementation | Shared schema + RLS **implemented**. The JWT-claims part was **not** adopted: RLS uses `SECURITY DEFINER` membership-lookup functions instead, so a revoked membership takes effect immediately rather than at token refresh. Revisit only if RLS performance requires it. |
| OQ15 | Option B clip source and lifecycle. | A43 | **Resolved** (hybrid source + durability rule). |

### 1.1 Supersession and refinement record (2026-10-05)

Historical entries are kept, not deleted. This table records which earlier entries the owner decisions of 2026-10-05 affect.

| Earlier entry | Earlier content (summary) | New decision | Relationship |
|---|---|---|---|
| P6 (Proposed) | Option B default, Option C optional paid add-on — *recommendation only*. | A29 | **Superseded** — the recommendation is now approved, with the qualifier that Option C *may* (not "will") be paid. |
| P4 (Proposed) | LiveKit recommended over Agora/Daily on cost-at-scale; Agora as fallback. | A35 | **Superseded in part** — the LiveKit-first preference no longer stands; LiveKit and Agora are equal pilot candidates pending a target-network pilot. P4's cost research remains valid as input to that pilot. Daily.co is not named in A35; its status is unchanged (evaluated, not a named pilot candidate). |
| P7 (Proposed) | Markaz Admin role + Parent/Guardian account type linked *read-only* to Students. | A26, A27 | **Superseded in part** — both roles now exist (approved). The P7 description of the Markaz Admin as narrow (roster/settings/billing) is replaced by A26's "broad operational authority within own Markaz". P7's "read-only" Parent qualifier is **not** confirmed or rejected by A27 — it stays proposed (open question 14). |
| P8 (Proposed) | Evaluate Supabase Storage vs R2/B2 once recording volume is material. | A38 | **Superseded for the current phase** — Supabase Storage is the approved current direction; the future re-evaluation trigger (real volume/cost data) is preserved. |
| A4 (Approved) | Eventual targets include Android and iOS apps. | A36 | **Refined, not superseded** — native apps remain eventual targets, just not MVP. |
| A15 (Approved) | Class capacity varies by plan. | A33 | **Refined, not superseded** — no concrete numbers until pilot/cost testing. |
| A21 (Approved) | Free/paid plans, monthly subscriptions, course payments, M-Pesa, Airtel Money; tuition emphasis. | A34 | **Refined, not superseded** — A34 adds the requirement that the commercial concepts stay distinct. |

## 2. Current authorization scope (as of 2026-10-19)

**Authorized (2026-10-19, tenth authorization):** LOCAL implementation of the dedicated Finance Officer role (A140), new additive migrations, tests, docs and ONE local commit. NOT authorized: applying migrations to real Supabase DEV, deploy, push, choosing an RTC vendor.

**Authorized (2026-10-19, ninth authorization):** LOCAL implementation of the final Live Class decision corrections (A131–A139), new additive migrations, tests, docs and ONE local commit. NOT authorized: applying migrations to real Supabase DEV, deploy, push, choosing an RTC vendor.

**Authorized (2026-10-19, eighth authorization):** LOCAL implementation of the approved Live Class capacity + class structure foundation (A101–A130): source code, Prisma schema, new ADDITIVE migrations, server authorization, RLS migration SQL, UI/pages/actions/services, tests, documentation, local checks, and ONE local commit. NOT authorized: applying migrations to the real Supabase DEV project, bucket changes, production resources, deploy, push, choosing an RTC vendor, LiveKit/Agora production integration, payment-gateway integration, production scheduled jobs. A DEV pre-apply plan is prepared in docs/testing/dev-supabase-verification.md and awaits owner approval.


**Authorized (2026-10-16, seventh authorization):** LOCAL implementation of A92–A98 and ONE local commit; read-only preflight of the Supabase DEVELOPMENT project. NOT authorized in that task: any write to the real Supabase project (migrations, bucket changes) — that needs a separate APPLY instruction after the gate report; production, deploy, push, RTC vendor choice, provider-specific recording, billing, scheduled jobs.


**Authorized (2026-10-15, sixth authorization):** LOCAL implementation of A81–A91 (new additive migrations, services, RLS, UI, tests, docs) and ONE local commit. NOT authorized: applying migrations or configuration to the real Supabase project, production, deploy, push, choosing the RTC vendor, provider-specific recording, payments/billing.


**Authorized (2026-10-14, fifth authorization):** LOCAL implementation of the recording & correction media decisions A66–A80 (schema, local migrations, RLS SQL, services, UI, tests, docs) and ONE local commit after all checks pass. NOT authorized: applying migrations to or changing the real Supabase development project without explicit owner approval, production, deploy, push, choosing the RTC vendor, provider-specific recording/egress, payments. (Earlier: the RTC pilot authorizations of 2026-10-13/14 — closed.)


**Authorized (2026-10-13, fourth authorization):** implementation of A62–A64; use of Supabase project `elimu-yenye-manufaa` **strictly as development** (migrations, Auth/RLS/Storage verification, dev-only data and dev URLs); one LOCAL baseline Git commit after verification. NOT authorized: production launch, real users, production data or domains, deploy, push, remote, RTC, payments. Supabase project `elimu-yenye-manufaa` is currently used as the development environment. It must not be treated as production until the project owner explicitly approves production readiness.

**Authorized (2026-10-13, third authorization):** local implementation of the parent-link workflow, explicit permissions, delegation, teacher and parent invitations, and the fixed 7-day expiry; **`git init` locally** (no commit, no remote, no push); verification against a **local or dedicated non-production development** Supabase only. Status: Git initialized, nothing committed. Dev Supabase verification **could not be performed** — no Docker/WSL on this machine and no dev project credentials provided (see PROGRESS.md).

**Authorized (2026-10-13, second authorization): LOCAL Phase 1.5 / 2A implementation** — email OTP / magic-link UI, invite-first onboarding and acceptance, explicit permission foundation (`parent_link.verify`), Parent–Student verification (PENDING → VERIFIED only), ACTIVE-only Parent authorization, localization (sw default, en, ar + RTL), teacher basic roster boundary, Markaz Admin appointment request/review, vendor-neutral standalone correction-audio data foundation and storage contract, local schema/migration/RLS files, tests and docs. Same local-only limits as below.

**Authorized (2026-10-13, first authorization): LOCAL Phase 1 foundation implementation** — Next.js/TypeScript project, Prisma setup, local/environment-safe Supabase integration structure, authentication architecture, profiles, Markaz/tenant model, tenant-scoped memberships, roles foundation, multi-Markaz Teacher support, Parent account type and Parent–Student link foundation, Student membership foundation, tenant isolation, RLS design/migration *files*, negative authorization tests, basic PWA foundation, documentation reconciliation, lint/typecheck/test setup. Installing packages locally, generating (not applying to any live DB) migrations, and running local tests/lint/typecheck/build are allowed.

**Still NOT authorized (as of 2026-10-14; corrected — this list was stale):** production database access; any production Supabase project; applying new migrations or bucket/settings changes to the development project without explicit owner approval; Vercel deployment; live domains; production Agora/LiveKit integration (the closed RTC pilot was separately authorized); Live Class; whiteboard; provider-specific recording capture/egress; payments/pricing; native apps; choosing a Qur'an source; adding a Git remote; pushing. (Git init, local commits and the correction-audio/recording-policy foundation were authorized later — see above. **2026-10-19:** the provider-neutral Live Class foundation was authorized LOCALLY by the eighth authorization; real media transport, whiteboard transport and RTC vendors remain unauthorized.)

Earlier scope (2026-09-30, Brief Part 15): documentation and analysis only. Kept for history.

This scope itself is **APPROVED** and stays in force until the project owner changes it here.

## 3. Proposed (engineering recommendations — NOT yet approved)

| # | Proposal | Detail | Status (2026-10-05) |
|---|---|---|---|
| P1 | Web stack: Next.js (App Router) + TypeScript + Supabase (Postgres, Auth, Storage, Realtime), hosted on Vercel. | [docs/system/technology-evaluation.md](docs/system/technology-evaluation.md) | **Superseded by A39 (2026-10-13)** — approved, with Prisma added. |
| P2 | Mobile: Expo (React Native + React Native Web) in a pnpm/Turborepo monorepo sharing business logic with the Next.js web app, rather than a fully separate native codebase. | [docs/system/technology-evaluation.md](docs/system/technology-evaluation.md) | Proposed (unchanged) — now applies to a post-MVP phase only (A36). |
| P3 | Multi-tenancy: shared Postgres schema, `tenant_id` column + Postgres Row Level Security, tenant/role claims embedded in the JWT. | [docs/system/tenancy.md](docs/system/tenancy.md) | Shared schema + RLS **implemented in the local foundation (2026-10-13)**; JWT-claims variant **not adopted** (see §1.2). |
| P4 | Real-time audio/screen-share: LiveKit (self-hosted or LiveKit Cloud) as the SFU, chosen over Agora/Daily primarily on cost-at-scale and open-source exit path. | [docs/system/technology-evaluation.md](docs/system/technology-evaluation.md) | **Superseded in part by A35** — no vendor preference stands; pilot required. |
| P5 | Whiteboard sync: custom operation-log protocol (not a general-purpose CRDT), riding on the same real-time transport as audio where practical. | [docs/features/whiteboard.md](docs/features/whiteboard.md) | Proposed (unchanged) |
| P6 | Private correction storage: Option B — structured annotations with timestamps + linked short audio segments — as the default; full-session recording (Option C) offered as an optional paid add-on, not the default. | [docs/features/student-corrections.md](docs/features/student-corrections.md) | **Superseded by A29** (approved). |
| P7 | Roles expanded with a distinct **Markaz Admin** role (institution-level, separate from Teacher) and a **Parent/Guardian** account type linked read-only to one or more Student accounts. | [docs/system/roles-permissions.md](docs/system/roles-permissions.md) | **Superseded in part by A26/A27** — roles approved; "read-only" Parent scope still proposed. |
| P8 | Recordings/media storage: evaluate Supabase Storage vs Cloudflare R2/Backblaze B2 for egress-cost reasons once recording volume is material. | [docs/system/technology-evaluation.md](docs/system/technology-evaluation.md) | **Superseded for current phase by A38.** |
| P9 | PDF rendering/annotation: Mozilla `pdf.js` with a custom annotation overlay layer, reusing the whiteboard sync protocol keyed to page number. | [docs/features/pdf-annotations.md](docs/features/pdf-annotations.md) | Proposed (unchanged) |
| P10 | Correction clip storage (technical evaluation for A43): every correction that has audio owns a **standalone clip object** in Supabase Storage. When the clip was derived from a full-session recording, the segment pointer (recording id + start/end offsets) is kept as **provenance metadata only**, never as the sole source. Reason: a pointer-only design violates the A43 durability rule unless recording deletion is restricted — and deletion mechanics are an open owner decision (OQ16). | [docs/features/student-corrections.md](docs/features/student-corrections.md) | **Superseded by A53 — APPROVED (2026-10-13).** Data foundation implemented (no media processing). |

## 4. Open questions requiring project owner decision

See the full list with context in [docs/roadmap/open-questions.md](docs/roadmap/open-questions.md). Headline items (original 2026-09-30 wording kept; status as of 2026-10-05 appended):

1. Exact Markaz administrator role and its permission boundaries vs. Super Admin and Teacher. — **Resolved in principle by A26**; exact permission rows still open (open question 13).
2. Parent account model: separate account type vs. a "linked viewer" relationship on a Student account; how parent-child linking is verified. — **Account model resolved by A27** (separate type); linking verification still open (open question 14).
3. Tenant ownership model: can a teacher belong to more than one Markaz? Who owns a student's data when a student studies under both an independent teacher and a Markaz? — **First part resolved by A28** (yes, tenant-scoped); second part still open.
4. Final correction-storage approach (A/B/C — see [docs/features/student-corrections.md](docs/features/student-corrections.md)). — **Resolved by A29** (B default, C optional add-on); clip/storage mechanics and C pricing still open.
5. Class-size limits per plan tier and how "plan" maps to a concrete participant cap and to RTC cost. — **Still open** (A33: numbers only after pilot/cost testing).
6. Relationship between monthly tuition, per-course payment, teacher-level subscription, and platform-level subscription (see [docs/features/payments.md](docs/features/payments.md)). — **Structure resolved by A34** (hybrid, five distinct concepts); prices, revenue sharing, durations and inter-concept rules still open.
7. Recording consent flow and retention period for lesson recordings. — **Resolved at business level by A30/A31**; deletion mechanics and authorized-deleter definition still open (open question 16).
8. Final RTC/whiteboard vendor selection (build vs buy) — see [docs/system/technology-evaluation.md](docs/system/technology-evaluation.md). — **Still open**; selection *process* approved by A35.
   - 2026-10-13: **Pilot prepared — owner decision pending.** Plan [docs/testing/rtc-pilot-plan.md](docs/testing/rtc-pilot-plan.md), harness `pilot/rtc/` (throwaway). No vendor selected; A35 unchanged.
   - 2026-10-14: **Real-device Wi-Fi test done (1 Android phone); pilot phase closed for now by the owner.** XPPen pending hardware; Agora co-host authentication deferred; hotspot/4G not run. Results: [docs/testing/rtc-pilot-results.md](docs/testing/rtc-pilot-results.md) §5. No vendor selected; A35 unchanged.
   - 2026-10-13: **Pilot run (automated, one PC) — owner decision pending.** Measured results: [docs/testing/rtc-pilot-results.md](docs/testing/rtc-pilot-results.md) §4. Phone/4G/XPPen tests not yet run. No vendor selected; A35 unchanged.
9. Whether native iOS/Android apps are needed at MVP or can wait behind PWA + mobile web. — **Resolved by A36** (not needed for MVP).

New owner questions surfaced while reconciling the 2026-10-05 decisions are listed as items 13–20 in [docs/roadmap/open-questions.md](docs/roadmap/open-questions.md).

2026-10-13: item 13 direction resolved by A40; item 14 scope resolved by A41/A42 (verifier still open); item 15 resolved by A43. Items raised during the foundation build are 21–26.

2026-10-13 (Phase 2A): items 22, 24, 25, 26 resolved; item 14 partially resolved (A46–A48). New items 27–30 were raised during the build.

2026-10-13 (parent workflow): items 14, 27, 28, 29, 30 resolved. Items 31–33 record interim engineering choices awaiting confirmation.

2026-10-13 (fourth update): items 31, 32, 33 resolved (A62, A63, A64).

2026-10-19 (final corrections): items 53–58 resolved by A131–A139. Still open: exact capacity numbers, RTC vendor, XPPen, scheduled-job authorization, broader commercial pricing/payment-gateway rules.

2026-10-19 (Live Class foundation): item 18 resolved by A123; items 5 and 13 refined (A109; A115–A116). New items 53–60 record implementation interpretations and what remains open (payments, capacity numbers, scheduler, RTC).

2026-10-16 (apply instruction): items 51, 52 resolved by A99, A100.

2026-10-16: items 41, 42, 46, 47, 48, 50 resolved by A92–A98; items 51–52 added.

2026-10-15 (media policy decisions): items 34, 35, 37, 38, 39, 43, 44, 45 and part of 36/40 resolved by A81–A91; items 46–50 added.

2026-10-14 (recording & correction media): items 15 (stale), 16, 17, 19, 20, 23 resolved by A66–A80. New items 34–45 record what those decisions leave open and the interim (fail-closed) behaviour in code.

## 5. Deferred

- AI-assisted grading (Part 7) — explicitly deferred past Live Class implementation.
- Full catalog of educational resource types (handwriting exercises, full multi-subject curriculum content) — deferred past MVP.
- Detailed pricing, commission %, and subscription limits — deferred until Part 8 open questions are resolved; nothing here should be invented. (Still deferred after A34: the hybrid *structure* is approved, but no prices, revenue sharing, subscription durations, or Option C add-on price exist.)
