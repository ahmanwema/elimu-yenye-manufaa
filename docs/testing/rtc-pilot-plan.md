# RTC + Whiteboard Pilot — Test Plan (Agora vs LiveKit)

Status: **PLAN — written before any test was run (2026-10-13).** Evidence-gathering only. It does **not** select a vendor: A35 stays in force (Agora vs LiveKit → real target-network pilot → comparison → owner decision). Pilot code lives in [`pilot/rtc/`](../../pilot/rtc/README.md), is throwaway, and is not part of the app.

## 0. Stale assumptions found in existing docs (audit, 2026-10-13)

| Where | Stale statement | Why stale / what changes |
|---|---|---|
| technology-evaluation.md §4 | Prices "approx … per public pricing comparisons"; LiveKit free tier "~1,000 agent-minutes" | Re-verified from official pricing pages 2026-10-13 (see results doc §Cost). LiveKit Build includes **5,000 WebRTC participant-minutes**; "agent minutes" are a different product. |
| technology-evaluation.md §4 | "LiveKit recommended … Agora is the fallback" | Superseded by A35 (equal candidates). Kept for history; the pilot must not inherit it. |
| technology-evaluation.md §4 | "LiveKit's data-channel can plausibly carry whiteboard sync" | Unverified, and it ignores A16: whiteboard writes must be authorized **server-side per operation**. Raw RTC data packets are not validated by our server. Tested in §5 here. |
| audio-recording.md (User journey 2) | "Teacher's mic audio is captured continuously by the RTC provider's recording/egress" | Conflicts with A29/A44: full-session recording is an optional add-on, not the default. Pilot evaluates egress only as a capability. |
| architecture.md §3.4 | Whiteboard over "RTC data channel or a WebSocket" | Correct to leave open. The pilot measures both options against A16. |
| live-class-acceptance.md exit criteria | Requires "one iOS device" | Still valid. iOS is **not available** for this pilot → marked future test (§2). |

## 1. Scope

**Evaluated:**
- teacher audio;
- students join muted;
- raise hand → teacher grants mic (one at a time) → revoke;
- join / leave / reconnect;
- participant state;
- network quality telemetry;
- whiteboard op transport (coupled vs independent);
- XPPen pointer events;
- **server-side enforcement** of mic control.

**Not evaluated (desk research only):** recording/egress (capabilities and cost from official docs), screen share, PDF, chat, attendance, video.

**Participants:** 1 teacher + 2–3 students per run (TEST SCENARIO ONLY; not plan capacity, A33).

## 2. Devices and browsers

| Role | Device | Browser | Status |
|---|---|---|---|
| Teacher | Windows laptop/desktop | Chrome (current) | To test (owner) |
| Teacher input | XPPen Deco 640 (with and without vendor driver) | Chrome | To test **if physically available** (§6) |
| Student 1 | Android phone (mid-range, record model) | Chrome | To test |
| Student 2 | Second Android phone (record model) | Chrome | To test if available |
| Student 3 | Any second laptop or phone | Chrome | Optional |
| Student | iPhone | Safari / installed PWA | **Not available — future test** |

Record the exact device model, OS version and browser version in the "Device" field of the pilot page.

## 3. Networks

Each is a **real** network unless marked simulated. Label every run in the pilot page.

| Label | Condition | How |
|---|---|---|
| wifi-strong | Good home/office Wi-Fi | Real |
| hotspot-average | Phone hotspot, typical signal | Real |
| 4g | Phones on their own 4G SIM | Real, but needs public reachability: see pilot README §Remote |
| weak-unstable | Edge of coverage / congested time of day | Real |
| interruption | Toggle airplane mode 10 s on one student mid-session | Real |
| network-switch | Student moves Wi-Fi → 4G during session | Real, if practical |
| sim-throttled | Chrome DevTools network throttling on the laptop | **Simulated**, for repeatability only. Never mixed with real results. |

## 4. Scenarios (identical for both providers)

Run every scenario **once with LiveKit and once with Agora, back-to-back, same devices, same place, same network, same people** (alternate which provider goes first between runs). Name runs `S<n>-<provider>-<run>`.

| ID | Duration | Actions (in order) |
|---|---|---|
| S1 Join & listen | 10 min | Teacher creates session, joins, speaks continuously (read text). 2–3 students join. Note join time and first audio. |
| S2 Mic flow | 10 min | Student 1 raises hand → grant → student speaks 1 min → revoke → student 2 same. Repeat ×3. |
| S3 Security | 5 min | Student presses **Force publish** without grant. Then a granted student enables **Ignore revoke** and the teacher revokes. Does the platform stop the audio? |
| S4 Interruption | 10 min | During speech, student goes airplane mode 10 s, then 30 s. Record reconnect success and time; check participant list consistency. |
| S5 Whiteboard | 10 min | Teacher draws continuously with each transport (Supabase Realtime, then LiveKit data). Press Ping ×10 three times. Page switch, clear. Repeat during S4-style interruption. |
| S6 Long session | 60 min | S1 + S2 + S5 combined; watch CPU/heap/battery on phones. |

### Manual measurements (SDKs do not expose these)

- **Mouth-to-ear latency (clap test):** place a third phone recording video so it captures the teacher clapping AND the student phone speaker. The frame distance between the clap and its playback gives latency. Do 5 claps per run; record the median.
- **Audio quality:** each listener scores 1–5 (5 = clear) per run; note dropouts.
- **CPU/battery:** Windows Task Manager (Chrome %); Android battery % start/end of S6.

## 5. Whiteboard transport question (A16)

Ops are operation-based (normalized points, pressure, page, seq, timestamp), never images.

| Option | What is measured | Policy check |
|---|---|---|
| A. RTC data channel (LiveKit only: Agora Web SDK 4.x documents no data-send API) | RTT (ping/pong), seq gaps, out-of-order, bytes, reconnect recovery | Can the server authorize **each** op (A16)? LiveKit data permission is per participant (all-or-nothing), and packets are not persisted for disconnected receivers. |
| B. Independent: Supabase Realtime broadcast | Same metrics | The pilot uses a public broadcast channel. Production would need private channels with authorization, or a server relay, to satisfy A16. |

## 6. XPPen Deco 640 checklist (owner, if hardware present)

Use the pilot whiteboard as teacher; each stroke logs pointerType, pressure, tilt, event rate.

1. Without the vendor driver (Windows Ink only): draw 5 long strokes and 20 short ones. Record `pointerType`, max pressure, events/sec.
2. With the official XPPen driver: repeat.
3. Pressure: light vs heavy strokes. Does `pressure` vary, or stay flat at 0.5/1.0?
4. Coordinate accuracy: trace the canvas corners, then draw a small circle. Any offset or lag?
5. Arabic: write a word with tashkīl (e.g. "بِسْمِ") and long joined script. Are diacritics legible on a student phone?
6. Rapid short strokes (dots/dashes): any missing ones on the student side?
7. Note any Chrome flags, driver settings ("Windows Ink" toggle) or driver crashes.

If the device is not available, mark every row **NOT TESTED**. No claim is made.

## 7. Metrics and where they come from

| Metric | LiveKit source | Agora source |
|---|---|---|
| Join time | `room.connect` duration | `client.join` duration |
| First audio | time to first `TrackSubscribed` | time to first `user-published` (audio) |
| RTT | ICE candidate-pair `currentRoundTripTime` | `getRTCStats().RTT` |
| Jitter / loss | inbound-rtp `jitter`, `packetsLost` | `getRemoteAudioStats()` `packetLossRate`, `end2EndDelay` |
| Bitrate / bandwidth | inbound/outbound bytes | `Send/RecvBitrate` |
| Quality | `ConnectionQualityChanged` | `network-quality` |
| Reconnects | `Reconnecting` → `Reconnected` | `connection-state-change` |
| Mic enforcement | permission change + `LocalTrackUnpublished` | observed in S3 |
| Whiteboard | ping/pong RTT, seq gaps, bytes | same |
| Device | `performance.memory` (Chrome), Network Information API | same |

The two SDKs report different numbers (e.g. Agora's `end2EndDelay` vs LiveKit's ICE RTT). Compare like with like only; manual clap-test latency is the common yardstick.

## 8. Pass / fail criteria

**Hard criteria (derived from approved principles):**
- Mic grant and revoke must be **enforceable server-side** (no frontend-only security). A provider fails S3 if a modified client keeps transmitting after revoke and the platform offers no server-side way to stop it without removing the student.
- Students must be able to join from Android Chrome (mobile web, A36).
- Tokens are issued only by our server, with roles decided server-side.

**Temporary test thresholds — NOT approved, for owner review (A33 forbids inventing capacity):**

| Criterion | Temporary threshold |
|---|---|
| Join success on wifi-strong / hotspot / 4g | ≥ 19 of 20 attempts per provider |
| Reconnect after a 10 s drop | succeeds automatically in ≥ 9 of 10 attempts |
| Audio quality on normal networks | median listener score ≥ 4 |
| Clap-test latency on 4G | reported as measured; the owner judges acceptability |
| Whiteboard | no lost ops on the reliable transport during non-interrupted runs |

**Not suitable if:** frequent join failures; audio unusable on normal target networks; unreliable reconnect; insecure mic control; unacceptable mobile-browser support; disproportionate operational complexity.

## 9. Evidence

- Raw: every pilot event is appended to `pilot/rtc/results/raw/<date>.jsonl` with provider, network, device, scenario, role and timestamp. No tokens or secrets.
- Summary: `npm run analyze` (in `pilot/rtc`) → `pilot/rtc/results/summary.md`.
- Manual: clap-test medians, quality scores, CPU/battery, XPPen observations → [rtc-pilot-results.md](rtc-pilot-results.md) §Manual.
- Raw files stay git-ignored. Only reviewed summaries are committed, and only with owner authorization.

## 10. Comparison method

1. Fill the results matrix with raw numbers per run, before any interpretation.
2. Compare only pairs run under the same conditions (§4).
3. Apply the hard criteria first, then the temporary thresholds.
4. Then weigh cost (official prices), recording/correction fit, security model and developer effort.
5. Write a technical recommendation with confidence and missing evidence. The **owner decides**.
