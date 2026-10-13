# Technology Evaluation

Status: **PROPOSED** — nothing in this document is an approved final stack. See [../../DECISIONS.md](../../DECISIONS.md). Owner decisions of 2026-10-05 that bind parts of this document: MVP platform (A36, §3), RTC selection process (A35, §4), current storage direction (A38, §8).

## 1. Framing

Hosting preference is fixed: Vercel + Supabase (**APPROVED** as a *preference*, per the brief). Everything else — framework, RTC provider, whiteboard sync approach, mobile strategy, storage for large media — is open for evaluation.

## 2. Web application framework

| Option | Pros | Cons |
|---|---|---|
| **Next.js + React + TypeScript** (PROPOSED) | First-class Vercel deployment; App Router gives server components + route handlers in one project; huge ecosystem for PDF/canvas/RTC libraries; easy PWA support via manifest + service worker. | React Server Components add complexity for a real-time, client-heavy whiteboard app; team must be disciplined about client/server boundaries. |
| SvelteKit | Smaller bundles, simpler reactivity model, good for canvas-heavy UI. | Smaller ecosystem for RTC/whiteboard libraries; less Vercel-native tooling than Next.js; harder to reuse logic with a React Native mobile app later. |
| Remix | Good data-loading model, deploys to Vercel. | Weaker PWA/offline story out of the box; smaller real-time/canvas ecosystem than React. |

**Decision (APPROVED 2026-10-13, A39):** Next.js + TypeScript, with **Prisma ORM** over Supabase PostgreSQL, Supabase Auth and Storage, PWA, and Vercel as the intended host. Installed in the local foundation: Next.js 16.4.0, React 19.3.0, TypeScript 5.9, Prisma 7.10.0 (pg driver adapter), @supabase/ssr 0.12.7, zod 4.6.7, Vitest 5.0.4, PGlite 0.5.9 (tests only).

**Original recommendation (PROPOSED, 2026-09-30):** Next.js + TypeScript. Primary reason is not Next.js itself but the React ecosystem it gives access to (canvas/whiteboard libraries, PDF.js wrappers, RTC SDKs are React-first) and code-sharing potential with an Expo mobile app.

## 3. Mobile strategy

| Option | Pros | Cons |
|---|---|---|
| **Expo (React Native) + React Native Web, monorepo with Next.js** (PROPOSED) | Shares business logic, API client, and validation schemas with web via shared packages; Expo Router matured into a full app framework by 2026; single team can maintain both. | Whiteboard canvas rendering (Skia/Canvas) still needs a platform-specific implementation seam between web `<canvas>` and RN Skia — cannot be 100% shared. |
| PWA-only, no native app initially | Fastest to ship; no app-store review cycles; works on the confirmed teacher setup (Windows Chrome) without any extra work. | No app-store presence; background push/microphone/notification behavior is more limited on iOS PWAs; some institutions/parents expect an app-store app for trust. |
| Fully separate native apps (Swift/Kotlin) | Best native performance and platform integration. | Triples UI implementation effort; no logic sharing; not justified before Live Class interaction model is validated. |

**Recommendation (PROPOSED):** Ship PWA + mobile web first (this is also required to validate the whiteboard/audio experience cheaply), add Expo-based Android/iOS apps once Live Class is validated, sharing logic through a monorepo rather than rewriting it. Full native (Swift/Kotlin) is not recommended unless a specific platform capability (e.g. background audio limitations of iOS Safari) forces it — flagged as an open question in [../roadmap/open-questions.md](../roadmap/open-questions.md).

**Decision (APPROVED 2026-10-05, A36 / BR-11):** MVP = PWA + mobile web first. Native Android and native iOS are not required for MVP and may remain future phases. The *technology* for any later native app (Expo per P2, or otherwise) is still only proposed.

## 4. Real-time audio / screen share (RTC)

Live teacher video is not required initially (per brief), which simplifies bandwidth needs, but audio + screen share + a synchronized whiteboard still requires a real SFU-based provider — plain WebRTC mesh does not scale past a handful of participants.

| Provider | Model | Approx. cost (2026 published pricing) | Notes |
|---|---|---|---|
| **LiveKit** (Cloud or self-hosted, open-source) | Open-source SFU; Cloud plans: free "Build" tier (~1,000 agent-minutes/mo), "Ship" ~$50/mo + $0.0005/participant-min overage, "Scale" ~$500/mo + $0.0004/min overage. | Lowest per-minute cost at scale of the three compared; **self-host exit path** exists if Cloud pricing becomes unfavorable — important for a cost-sensitive market. | Requires more integration work than a hosted-only SDK; strong data-channel support useful for carrying whiteboard ops alongside audio. |
| Daily.co | Hosted-only, $0.004/participant-min video, ~$0.00099/participant-min audio-only; ~10,000 free min/month. | Fast to integrate, good docs. | No self-host option; cost scales linearly and is materially higher than LiveKit at volume. |
| Agora | Hosted, ~$0.99/1,000 min audio, tiered subscriptions at volume (e.g. 400,000 min for ~$339.99/mo). | Mature, strong global (including African) network presence and reliability track record. | Pricing model is more complex (subscription tiers + overage); still costs more than LiveKit at comparable scale per public 2026 pricing comparisons. |

**Original recommendation (2026-09-30, PROPOSED; superseded in part by A35 on 2026-10-05 — kept for history):** LiveKit, primarily for cost-at-scale and because it is audio-only-first friendly (no video track to pay for by default, matching the "no teacher video required" requirement) and its data-channel can plausibly carry whiteboard sync traffic without standing up a second real-time service. Agora is the fallback if LiveKit's network performance proves insufficient in the target region during hardware/network testing (see [../testing/device-compatibility.md](../testing/device-compatibility.md)) — this must be validated with real network testing before being locked in, not assumed from marketing claims.

**Current status (APPROVED process, A35 / BR-10, 2026-10-05):** Agora and LiveKit are **both** pilot candidates. Neither is preferred or selected. The required sequence is:

```
Agora vs LiveKit
        ↓
real target-network pilot
        ↓
latency / reliability / cost comparison
        ↓
final project-owner decision (later)
```

The cost figures in the table above are inputs to that comparison, not a verdict. Daily.co is not named as a pilot candidate in A35; nothing has been decided about it beyond the 2026-09-30 evaluation. The pilot should also compare each candidate's recording/egress capability, because Option B clips and the Option C add-on depend on it ([../features/audio-recording.md](../features/audio-recording.md)). It should also compare per-room participant-limit configuration, because capacity is plan-based with numbers still undetermined (A33).

**2026-10-13 pilot preparation — read before using the table above:**
- The prices in the table were *approximate* (2026-09-30). Official figures re-verified on 2026-10-13 are in [../testing/rtc-pilot-results.md](../testing/rtc-pilot-results.md) §3. For example, LiveKit Build includes 5,000 participant-minutes, not "agent-minutes".
- Two security-relevant facts from official docs now drive the pilot:
  - LiveKit can revoke publishing server-side (`UpdateParticipant` auto-unpublishes).
  - Agora documents no selective server-side revoke, and its subscriber token restricts publishing only with co-host authentication enabled by Agora support.
- Pilot plan: [../testing/rtc-pilot-plan.md](../testing/rtc-pilot-plan.md). **No vendor selected — owner decision pending (A35).**

## 5. Whiteboard real-time sync

General-purpose CRDT libraries (e.g. Yjs) are built for text/structured documents; canvas/stroke data has different conflict semantics (strokes are mostly append-only, rarely truly concurrently edited at the same pixel). Precedent: tldraw deliberately does **not** use a CRDT for its sync engine — it uses a server-authoritative document with diff reconciliation, specifically because general CRDTs aren't a good fit for canvas data.

**Recommendation (PROPOSED):** an operation-log protocol — each stroke/erase/permission-grant is an ordered, timestamped operation broadcast to the room and appended to a per-document-page log; a compacted "snapshot" is produced periodically so late joiners don't have to replay the entire history. Full design in [../features/whiteboard.md](../features/whiteboard.md). Building this custom (rather than adopting tldraw's own sync engine wholesale) is justified because private per-student annotation layers and PDF-page-linked annotations are domain-specific requirements tldraw's generic sync doesn't natively model — but tldraw's client-side canvas rendering primitives may still be reused; this is a build-vs-adapt decision to revisit once the whiteboard spec is reviewed.

## 6. PDF rendering & annotation

**Recommendation (PROPOSED):** Mozilla `pdf.js` for rendering (mature, works in-browser without native dependencies, used by Chrome itself), with a custom annotation overlay layer (SVG or canvas) positioned relative to the rendered page and synced through the same operation-log protocol as the whiteboard, keyed by page number. See [../features/pdf-annotations.md](../features/pdf-annotations.md).

## 7. Database & multi-tenancy

**Recommendation (PROPOSED):** Supabase Postgres, shared schema, `tenant_id` + Row Level Security, tenant/role claims embedded in the JWT to avoid expensive per-row subqueries. Full detail in [database.md](database.md) and [tenancy.md](tenancy.md).

## 8. Storage for large media (recordings, audio submissions, PDFs)

| Option | Notes |
|---|---|
| Supabase Storage (S3-compatible, built in) | Simplest integration (same project, same auth); egress costs can become material once lesson recordings are stored at volume — needs real cost modeling before committing. |
| Cloudflare R2 / Backblaze B2 | Materially cheaper egress at scale; adds a second vendor and a second auth/permission model to keep in sync with Postgres RLS. |

**Recommendation (PROPOSED):** start with Supabase Storage for simplicity during Live Class MVP (low recording volume); revisit R2/B2 once recording volume and real egress costs are known. Flagged as a cost open question in [../roadmap/open-questions.md](../roadmap/open-questions.md).

**Decision (APPROVED 2026-10-05, A38 / BR-13):** Supabase Storage is the current storage direction. No migration to Cloudflare R2 or Backblaze B2 now; this may be reconsidered later based on real volume/cost data. Bucket layout, paths, and access policies for correction clips and recordings are not designed yet.

## 9. Explicitly not decided here

Final vendor selection for RTC, final decision on native mobile timing, and final storage vendor all require project-owner approval and, ideally, a short real-world pilot (see [../testing/device-compatibility.md](../testing/device-compatibility.md)) before being locked in.

2026-10-05 status: native timing for MVP is decided (A36) and the storage direction for the current phase is decided (A38). RTC vendor selection is still **not** decided; only its pilot process is approved (A35).
