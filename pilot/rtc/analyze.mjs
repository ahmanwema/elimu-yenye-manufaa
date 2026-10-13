// Summarizes raw pilot telemetry (results/raw/*.jsonl) into results/summary.md.
// Groups by provider × network × scenario. Reports only what was measured; missing → "—".
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const dir = "results/raw";
const events = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) =>
      readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    )
  : [];

const groups = new Map();
for (const e of events) {
  const key = `${e.provider ?? "?"} | ${e.network ?? "?"} | ${e.scenario ?? "?"}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(e);
}

const pct = (xs, p) => {
  if (!xs.length) return "—";
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const rows = [];
for (const [key, es] of [...groups].sort()) {
  const of = (t) => es.filter((e) => e.type === t);
  const joins = of("joined").map((e) => num(e.ms)).filter((x) => x != null);
  const firstAudio = of("first_remote_audio").map((e) => num(e.ms)).filter((x) => x != null);
  const reconnects = of("reconnected").map((e) => num(e.ms)).filter((x) => x != null);
  const stats = of("stats");
  const rtts = stats.map((e) => num(e.rtc?.rttMs)).filter((x) => x != null);
  const jitter = stats.flatMap((e) => (e.rtc?.inbound ?? []).map((i) => num(i.jitterMs))).filter((x) => x != null);
  const e2e = stats.flatMap((e) => (e.rtc?.inbound ?? []).map((i) => num(i.end2EndDelayMs))).filter((x) => x != null);
  const lossRate = stats.flatMap((e) => (e.rtc?.inbound ?? []).map((i) => num(i.packetLossRate))).filter((x) => x != null);
  const wbRtt = of("wb_rtt").map((e) => num(e.ms)).filter((x) => x != null);
  const lastWb = stats.map((e) => e.wb).filter(Boolean).at(-1);
  rows.push({
    key,
    devices: [...new Set(es.map((e) => e.device).filter(Boolean))].join(", ") || "—",
    joins: joins.length,
    joinFailed: of("join_failed").length,
    joinP50: pct(joins, 50),
    firstAudioP50: pct(firstAudio, 50),
    rttP50: pct(rtts, 50),
    rttP95: pct(rtts, 95),
    jitterP50: pct(jitter, 50),
    e2eP50: pct(e2e, 50),
    lossP50: pct(lossRate, 50),
    reconnects: reconnects.length,
    reconnectP50: pct(reconnects, 50),
    disconnects: of("disconnected").length,
    micErrors: of("mic_error").length,
    forceAttempts: of("force_publish_attempt").length,
    wbRttP50: pct(wbRtt, 50),
    wbRttP95: pct(wbRtt, 95),
    wbMissing: lastWb?.missing ?? "—",
    wbOutOfOrder: lastWb?.outOfOrder ?? "—",
  });
}

const header =
  "| Provider \\| network \\| scenario | Devices | Joins (failed) | Join p50 ms | First audio p50 ms | RTT p50/p95 ms | Jitter p50 ms | Agora e2e p50 ms | Agora loss p50 % | Reconnects (p50 ms) | Disconnects | Mic errors | Force-publish attempts | WB RTT p50/p95 ms | WB missing / out-of-order |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
const body = rows
  .map(
    (r) =>
      `| ${r.key} | ${r.devices} | ${r.joins} (${r.joinFailed}) | ${r.joinP50} | ${r.firstAudioP50} | ${r.rttP50}/${r.rttP95} | ${r.jitterP50} | ${r.e2eP50} | ${r.lossP50} | ${r.reconnects} (${r.reconnectP50}) | ${r.disconnects} | ${r.micErrors} | ${r.forceAttempts} | ${r.wbRttP50}/${r.wbRttP95} | ${r.wbMissing} / ${r.wbOutOfOrder} |`,
  )
  .join("\n");

const md = `# RTC pilot — measured results (generated)

Generated ${new Date().toISOString()} from ${events.length} raw events. Only measured values appear; "—" means not measured.
SDK-reported RTT is network round-trip, NOT mouth-to-ear latency (see the manual clap test in docs/testing/rtc-pilot-plan.md).

${rows.length ? header + "\n" + body : "_No pilot sessions recorded yet._"}
`;
writeFileSync("results/summary.md", md);
console.log(md);
