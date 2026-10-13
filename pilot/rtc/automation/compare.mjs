// Aggregates FULL automated runs (S6 ≥ 5 min; trial runs excluded) into
// results/automated-comparison.md. Raw values only — no interpretation here.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const runs = readdirSync("results/auto")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`results/auto/${f}`, "utf8")))
  .filter((r) => (r.scenarios?.S6?.minutes ?? 0) >= 5)
  .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

const by = (p) => runs.filter((r) => r.provider === p);
const fmt = (v) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const cell = (p, fn) => by(p).map((r) => fmt(fn(r))).join(" / ") || "not run";
const q = (o) => (o ? `p50 ${o.p50} · p95 ${o.p95} · max ${o.max} (n=${o.n})` : null);

const rows = [
  ["Runs (start time UTC)", (r) => r.startedAt.slice(11, 19)],
  ["Fatal error", (r) => r.fatal ?? "none"],
  ["S1 all 4 joined", (r) => Object.values(r.scenarios.S1?.joins ?? {}).every((j) => j.ok)],
  ["S1 join ms (teacher, s1, s2, s3)", (r) => Object.values(r.scenarios.S1?.joins ?? {}).map((j) => j.ms).join(",")],
  ["S1 first audio ms (s1, s2, s3)", (r) => Object.values(r.scenarios.S1?.firstAudioMs ?? {}).join(",")],
  ["S1 teacher audio reaches all students", (r) => Object.values(r.scenarios.S1?.teacherAudioReachesStudents ?? {}).every(Boolean)],
  ["S1 participants seen by teacher (joined / after leave / after rejoin)", (r) => `${r.scenarios.S1?.participantsSeenByTeacher}/${r.scenarios.S1?.participantsAfterLeave}/${r.scenarios.S1?.participantsAfterRejoin}`],
  ["S1 rejoin ok / audio after rejoin", (r) => `${r.scenarios.S1?.rejoin?.ok} / ${r.scenarios.S1?.audioAfterRejoin}`],
  ["S2 grant → audio at teacher, ms (3 cycles; incl. 1 s app poll)", (r) => r.scenarios.S2?.cycles?.map((c) => c.grantToAudioMs).join(",")],
  ["S2 revoke → silence at teacher, ms", (r) => r.scenarios.S2?.cycles?.map((c) => c.revokeToSilenceMs).join(",")],
  ["S2 publish errors", (r) => r.scenarios.S2?.cycles?.flatMap((c) => c.micErrors).length],
  ["S3 force publish (no grant): audio reached teacher?", (r) => r.scenarios.S3?.forcePublish?.teacherReceivesAudio],
  ["S3 force publish: client-side result", (r) => r.scenarios.S3?.forcePublish?.clientResult],
  ["S3 ignore-revoke: still transmitting after 8 s?", (r) => r.scenarios.S3?.ignoreRevoke?.teacherStillReceivesAfter8s],
  ["S3 ignore-revoke: server unpublished the track?", (r) => r.scenarios.S3?.ignoreRevoke?.serverUnpublishedTrack],
  ["S4 10 s drop: recovered / ms after restore (SIMULATED)", (r) => `${r.scenarios.S4?.drop10s?.recovered} / ${r.scenarios.S4?.drop10s?.recoveryMsAfterRestore}`],
  ["S4 30 s drop: recovered / ms after restore (SIMULATED)", (r) => `${r.scenarios.S4?.drop30s?.recovered} / ${r.scenarios.S4?.drop30s?.recoveryMsAfterRestore}`],
  ["S5 Supabase Realtime: available", (r) => r.scenarios.S5?.["supabase-realtime"]?.available],
  ["S5 Supabase: strokes drawn by teacher", (r) => r.scenarios.S5?.["supabase-realtime"]?.strokesDrawn],
  ["S5 Supabase: boards identical after drawing (order-sensitive)", (r) => r.scenarios.S5?.["supabase-realtime"]?.consistentAfterDrawing],
  ["S5 Supabase: receiver missing / out-of-order (s1,s2,s3)", (r) => Object.values(r.scenarios.S5?.["supabase-realtime"]?.receiverGaps ?? {}).map((g) => `${g.missing}/${g.outOfOrder}`).join(" ")],
  ["S5 Supabase: ping RTT ms", (r) => q(r.scenarios.S5?.["supabase-realtime"]?.rttMs)],
  ["S5 Supabase: bytes sent by teacher", (r) => r.scenarios.S5?.["supabase-realtime"]?.bytesSentByTeacher],
  ["S5 Supabase: student back after 10 s offline matches teacher?", (r) => r.scenarios.S5?.["supabase-realtime"]?.afterOfflineDrawing?.student2MatchesTeacher],
  ["S5 Supabase: identical after Clear", (r) => r.scenarios.S5?.["supabase-realtime"]?.consistentAfterClear],
  ["S5 LiveKit data: available", (r) => r.scenarios.S5?.["livekit-data"]?.available ?? false],
  ["S5 LiveKit data: unavailable reason", (r) => r.scenarios.S5?.["livekit-data"]?.error ?? "—"],
  ["S5 LiveKit data: boards identical after drawing", (r) => r.scenarios.S5?.["livekit-data"]?.consistentAfterDrawing],
  ["S5 LiveKit data: receiver missing / out-of-order", (r) => Object.values(r.scenarios.S5?.["livekit-data"]?.receiverGaps ?? {}).map((g) => `${g.missing}/${g.outOfOrder}`).join(" ")],
  ["S5 LiveKit data: ping RTT ms", (r) => q(r.scenarios.S5?.["livekit-data"]?.rttMs)],
  ["S5 LiveKit data: student back after 10 s offline matches teacher?", (r) => r.scenarios.S5?.["livekit-data"]?.afterOfflineDrawing?.student2MatchesTeacher],
  ["S6 teacher audio continuity", (r) => r.scenarios.S6?.teacherAudioContinuity],
  ["S6 disconnects / reconnects / errors (all 4)", (r) => Object.values(r.scenarios.S6?.perParticipant ?? {}).map((p) => `${p.disconnects}/${p.reconnects}/${p.errors}`).join(" ")],
  ["S6 JS heap MB start→end (student-1)", (r) => { const h = r.scenarios.S6?.perParticipant?.["student-1"]?.heapMB; return h ? `${h.start}→${h.end} (max ${h.max})` : null; }],
  ["RTT ms (SDK, students)", (r) => q(r.audioMetrics?.rttMs)],
  ["Jitter ms (LiveKit inbound)", (r) => q(r.audioMetrics?.jitterMs)],
  ["Agora end2EndDelay ms", (r) => q(r.audioMetrics?.agoraEnd2EndDelayMs)],
  ["Agora packet loss rate", (r) => q(r.audioMetrics?.agoraPacketLossRate)],
  ["Agora receive kbps", (r) => q(r.audioMetrics?.agoraReceiveKbps)],
  ["LiveKit packets lost / received (teacher stream, 3 students)", (r) => r.audioMetrics?.livekitPacketLoss && `${r.audioMetrics.livekitPacketLoss.lost} / ${r.audioMetrics.livekitPacketLoss.received}`],
  ["Distinct browser errors (all participants)", (r) => Object.values(r.browserErrors ?? {}).flat().length],
];

const env = runs[0]?.environment ?? {};
const md = `# RTC pilot — automated comparison (generated)

Generated ${new Date().toISOString()} from ${runs.length} full runs (trial runs excluded). Values per run are separated by " / " in chronological order.

**Conditions (identical for both providers):** ${env.machine ?? "—"}; ${env.network ?? "—"}; Chrome ${env.chrome ?? "—"}; ${env.audio ?? "—"}.
**Not represented:** phones, 4G/hotspot, XPPen, real voices, clap-test latency. S4 interruptions are SIMULATED (Chrome offline emulation).

| Measure | Agora | LiveKit |
|---|---|---|
${rows.map(([label, fn]) => `| ${label} | ${cell("agora", fn)} | ${cell("livekit", fn)} |`).join("\n")}
`;
writeFileSync("results/automated-comparison.md", md);
console.log(md);
