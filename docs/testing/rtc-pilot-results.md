# RTC + Whiteboard Pilot — Results (Agora vs LiveKit)

Status (2026-10-13): **desk research complete; automated one-PC pilot RUN (2 full runs per provider). Phone, 4G/hotspot and XPPen tests NOT YET RUN.** Measured results are in §4, kept separate from the documentation findings in §1. **Final vendor: owner decision pending (A35).** Whiteboard transport: not decided.

Plan: [rtc-pilot-plan.md](rtc-pilot-plan.md).

## 1. Verified capability findings (official docs, 2026-10-13)

| Topic | LiveKit | Agora | Source |
|---|---|---|---|
| Server-side mic revoke | `UpdateParticipant` permissions; "When you revoke the `CanPublish` permission from a participant, all tracks they've published are automatically unpublished." | Channel-management docs: the server can only *ask* the client to `muteLocalAudioStream` / `setClientRole`, or remove the user entirely (kicking rule). No documented way to selectively revoke publishing while keeping the user in the channel. | livekit docs "Managing participants"; Agora "Ban user privileges" best practice |
| Token roles | JWT grants per participant (`canPublish`, `canPublishSources`, `canPublishData`, `canSubscribe`), short TTL | `agora-token` (official) docs: "Role_Subscriber still has the same privileges as Role_Publisher" **unless Agora support enables co-host authentication**. Per-privilege expiry (publish audio etc.) also requires it. | `agora-token` 2.0.7 type docs |
| Browser data channel | Data packets: reliable (ordered, retransmitted, ≤15 KiB, best-effort, not delivered to temporarily disconnected receivers) and lossy; plus text/byte streams and RPC | Web SDK 4.x reference lists a `stream-message` receive event but no send API. Messaging is a separate product (Signaling / RTM). | livekit docs "Data packets"; Agora Web 4.x `IAgoraRTCClient` reference |
| Network telemetry in browser | WebRTC stats per track, connection-quality events | `getRTCStats`, `getRemoteAudioStats` (incl. `end2EndDelay`, `packetLossRate`), `network-quality` every 2 s | SDK references |
| Audio-only recording | Egress `audio_only` (template) or MediaSource audio, including per-participant audio | Cloud Recording audio-only; **individual mode** = separate file per UID | livekit egress overview; Agora Cloud Recording docs |
| Start/stop via API | `StartEgress` / stop at any time; auto-egress optional | REST acquire / start / stop | same |
| Storage destination | S3 and any S3-compatible store (`force_path_style`), GCS, Azure, AliOSS | Third-party vendors incl. Amazon S3, Azure, Google Cloud and others | livekit egress outputs; Agora Cloud Recording overview |
| Self-host exit path | Open-source server (self-host possible) | Hosted only | — |

**Not verified (must be tested or confirmed with the vendor):**
- whether Agora accepts a custom S3 endpoint such as Supabase Storage's S3 API;
- egress/recording start-up latency for short clips on either provider;
- whether Agora's publish-privilege expiry stops an already-flowing stream after co-host authentication is enabled.

## 2. Correction-audio fit (A29/A43/A53)

| Path | LiveKit | Agora |
|---|---|---|
| Option B, no full recording: short clip of the student's recitation | (a) Server: per-participant audio egress started on demand (start latency unverified, so the start of the mistake may be missed). (b) **Vendor-neutral**: the teacher's browser keeps a short rolling buffer of the received student track (MediaRecorder) and uploads a clip on "correction" → standalone object (A53). | (a) Cloud Recording individual mode per UID on demand (same latency caveat). (b) Same vendor-neutral client buffer (remote track → MediaStreamTrack). |
| Option C, full session exists: extract a segment | Per-participant or composite audio file + timestamps → server-side copy of the segment (worker deferred) | Individual-mode files per UID + timestamps → same |

Both providers allow Option B without forcing full-session recording if the client-side rolling-buffer approach is used. That approach is vendor-neutral and works the same on either. Consent (A30) and the recording notice still apply. **Not decided here.**

## 3. Cost model (official list prices only, 2026-10-13; excludes taxes and support)

**LiveKit Cloud** (livekit.com/pricing):

| Plan | Price | Included participant-minutes | Overage | Included data transfer | Concurrent connections |
|---|---|---|---|---|---|
| Build | $0/mo | 5,000 | $0.0005/min | 50 GB, then $0.12/GB | 100 |
| Ship | from $50/mo | 150,000 | $0.0005/min | 250 GB | 1,000 |
| Scale | from $500/mo | 1.5M | $0.0004/min | 3 TB, then $0.10/GB | 5,000 |

Audio egress: Build/Ship $0.005/min (60 / 600 min included); Scale $0.004/min (8,000 included).

**Agora** (agora.io/en/pricing; docs pricing):
- Audio: $0.99 per 1,000 minutes.
- Broadcast-streaming audience audio: $0.59 per 1,000 minutes. Whether that rate applies to the interactive "live" audience used in the pilot must be confirmed with Agora.
- First 10,000 minutes free each month.
- Cloud Recording from $0.99 per 1,000 minutes.
- Signaling from $0.0015 per 1,000 messages (1M free each month).
- Agora counts usage time even for users who are not actively subscribing.

**Per-session RTC usage cost at list price** (TEST SCENARIOS ONLY — not plan capacity, A33; participant-minutes = people × 60):

| Scenario | Participant-min | LiveKit (overage rate) | Agora ($0.99/1k) | Notes |
|---|---:|---:|---:|---|
| A: 1 + 3, 60 min | 240 | $0.12 | $0.24 | Both inside the free monthly quotas for small pilots |
| B: 1 + 10, 60 min | 660 | $0.33 | $0.65 | |
| C: 1 + 25, 60 min | 1,560 | $0.78 | $1.54 | LiveKit Build caps at 100 concurrent connections |

How far the free quotas go:
- LiveKit Build: ~20 × scenario A per month, or ~3 × scenario C.
- Agora: ~41 × A, or ~6 × C.

Excluded, because they are not yet measured or depend on volume:
- **Bandwidth:** LiveKit data transfer depends on the real audio bitrate, which the pilot records.
- Storage and egress for recordings.
- Engineering and operating effort.

## 4. Measured results — automated one-PC run (2026-10-13)

**Conditions, identical for both providers:**
- one Windows 11 PC on its **REAL NETWORK** (home internet);
- Chrome 155, headless;
- 1 teacher + 3 students as separate browser contexts;
- Chrome fake microphone (a synthetic tone, not a voice).

**Run order:** runs alternated LiveKit → Agora → Agora → LiveKit (19:44–20:42 UTC), with S6 = 10 min each. Trial runs with a 1-minute S6 are excluded.

**Interruptions are SIMULATED/THROTTLED:** S4 and the S5 offline step use Chrome offline emulation. This blocks HTTP/WebSocket signalling, but **it may not block UDP media or data**. In the LiveKit runs only the signalling connection reconnected.

**Not represented:** phones, 4G/hotspot, XPPen, real voices, and clap-test latency.

**Generated files:**
- Full table: [pilot/rtc/results/automated-comparison.md](../../pilot/rtc/results/automated-comparison.md).
- Per-run summaries: `pilot/rtc/results/auto/*.json`.
- Raw event logs stay local in `results/raw/`, which is git-ignored.

| Scenario | Agora (run 1 / run 2) | LiveKit (run 1 / run 2) |
|---|---|---|
| S1 join ms (teacher, s1, s2, s3) | 4007,4773,2629,1738 / 1776,1725,1518,1538 | 960,774,811,822 / 2396,1630,1928,809 |
| S1 first audio ms (s1–s3) | 6134,2912,2092 / 1969,1780,1765 | 774,811,822 / 1630,1928,809 |
| S1 participants visible to teacher | 0 (audience members are invisible in "live" mode) | 3 → 2 after leave → 3 after rejoin |
| S2 grant → audio at teacher, ms (includes ≤1 s app poll) | 3579,2365,4183 / 3770,3574,2966 | 1766,1741,1768 / 1784,1762,1775 |
| S2 revoke → silence, ms | 2354,2374,2369 / 1149,1158,1758 | 1181,540,554 / 543,638,548 |
| S2 client publish errors | 0 / 0 | 1 + 2 "insufficient permissions" per run: the first publish attempt raced the server permission update; publishing then succeeded on the permission event |
| S3 force publish without grant | **audio reached the teacher** (both runs) | **blocked**: "insufficient permissions" (both runs) |
| S3 ignore-revoke (modified client) | **still transmitting after 8 s**; no server action (both runs) | **server unpublished the track** (both runs) |
| S4 10 s drop: recovered, ms after restore (SIMULATED) | yes, 2562 / yes, 4084 | yes, 1040 / yes, 1047 |
| S4 30 s drop (SIMULATED) | yes, 32862 / yes, 2574 | yes, 4084 / yes, 4079 |
| S6 teacher audio reached all 3 students (10 s samples) | **2/54** / 54/54 | 54/54 / 54/54 |
| S6 disconnects / errors | 0 / 0 | 0 / one participant logged 1 error in run 2 |
| S6 JS heap, student-1 | 33→30 / 31→30 MB | 30→29 / 30→29 MB |

**Agora run 1, S6 = 2/54.** This was a real observation, not a counting artifact:
- The teacher kept sending about 34 kbps.
- From S4 onward, all three students received ~0 kbps from the teacher.
- Every ~15 s they got repeated `user-unpublished` events for the teacher, and loss was ~7 % during S4.
- It **did not recur** in Agora run 2.
- Cause not determined. It may be a network episode during that run. Treat it as one unexplained reliability event in two runs, which needs re-testing on real devices.

**Audio metrics** (students' view; each SDK reports different fields, so most cannot be compared directly; values are run 1 · run 2):

| Metric | Agora | LiveKit |
|---|---|---|
| RTT ms p50 / p95 | 226 / 412 · 188 / 218 (SDK getRTCStats) | 100 / 715 · 100 / 947 (WebRTC candidate pair) |
| Jitter ms p50 / p95 | not exposed in the same form | 9 / 34 · 7 / 31 |
| End-to-end delay ms p50 / p95 | 414 / 1369 · 409 / 739 (SDK `end2EndDelay`) | not exposed |
| Packet loss | SDK rate p95 0.10 % · 0.17 % (some samples are negative, an SDK quirk) | 646 of 127,412 · 413 of 129,089 packets (≈0.5 % · 0.3 %) |
| Receive bitrate | ~24–25 kbps typical | not sampled as bitrate |

RTT maxima of 10–15 s occur during the simulated offline periods. CPU % was not measured. The per-tab JS heap was steady.

**Whiteboard (S5) — Supabase Realtime vs LiveKit data:**
- The teacher drew 51 strokes: long strokes, 30 rapid strokes, eraser strokes, 2 undos, then Clear.
- Supabase Realtime was tested under both providers, and the results matched.
- LiveKit data is not available on Agora: the Agora Web SDK has no data-send API.

| Measure | Supabase Realtime (4 runs) | LiveKit data (2 runs) |
|---|---|---|
| All strokes delivered (by id and point count) | yes, 49/49 on every student | yes |
| Same drawing **order** on every board | **no**: 0–4 out-of-order messages per student. This changes z-order, which is visible where eraser strokes overlap ink | yes, 0 out-of-order |
| Ping RTT ms p50 / p95 | 588–670 / 708–1342 | 223–225 / 302–438 |
| Bytes sent by teacher | ~27.2 KB | — |
| After a 10 s student offline period | board did not match the teacher. The comparison is **confounded**: the order-sensitive fingerprint already differed before the offline step, and the pilot has no history replay | matched the teacher, **but not proven**: only signalling dropped, so data probably kept flowing |
| Identical after Clear | yes | yes |

**Not decided:** the final whiteboard transport.

## 5. Not yet tested (evidence gaps)

| Test | Status |
|---|---|
| Phones (Android/iPhone) on real Wi-Fi / 4G / hotspot, target region | not run |
| Real network loss (airplane mode, cable pull) instead of emulation | not run |
| Clap-test latency, listener scores, battery, CPU % | not run |
| S6 at 60 min | not run (10 min automated only) |
| XPPen Deco 640 checklist (Windows) | **not run — no physical test performed** |
| Agora with co-host authentication enabled (support request) | not run |
| Recording/egress latency on either provider | not run |

Generated per-run numbers for manual runs: `pilot/rtc/results/summary.md` (`npm run analyze`).
