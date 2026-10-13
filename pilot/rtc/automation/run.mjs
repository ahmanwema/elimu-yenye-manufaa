// Automated, identical S1–S6 runs for ONE provider on THIS PC (real internet connection,
// installed Chrome, fake microphone tone). 1 teacher + 3 students as separate browser
// contexts. Drives the real pilot page; records observed behaviour only.
//
// Usage: node automation/run.mjs --provider livekit|agora [--s6-minutes 10]
// Never prints pilot codes or credentials.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter((a) => a.trim())
    .map((a) => a.trim().split(/\s+/))
    .map(([k, ...v]) => [k, v]),
);
const PROVIDER = args.provider?.[0];
const S6_MIN = Number(args["s6-minutes"]?.[0] ?? 10);
if (!["livekit", "agora"].includes(PROVIDER)) throw new Error("--provider livekit|agora");

const env = parseEnv(readFileSync(".env.local", "utf8"));
const TEACHER = env.PILOT_TEACHER_CODE.trim();
const STUDENTS = env.PILOT_STUDENT_CODES.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "https://localhost:5173";
const RUN_ID = `${PROVIDER}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { runId: RUN_ID, provider: PROVIDER, startedAt: new Date().toISOString(), environment: {}, scenarios: {} };
const say = (s) => console.log(`[${PROVIDER}] ${s}`);

// ---------------------------------------------------------------------------------------
const procs = [];
function start(cmd, argv) {
  const p = spawn(cmd, argv, { stdio: "ignore", shell: false });
  procs.push(p);
  return p;
}
async function waitFor(fn, timeoutMs, stepMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

start(process.execPath, ["--env-file=.env.local", "--env-file=../../.env.local", "server.mjs"]);
start(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "5173", "--strictPort"]);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-precise-memory-info",
  ],
});
result.environment = {
  chrome: browser.version(),
  os: `${process.platform} ${process.arch}`,
  machine: "single Windows PC (teacher + 3 students as separate Chrome contexts)",
  network: "this PC's real internet connection",
  audio: "Chrome fake microphone (synthetic tone)",
};

const people = {};
async function open(name, code) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ["microphone"], viewport: { width: 1000, height: 1800 } });
  const page = await context.newPage();
  await waitFor(async () => (await page.goto(BASE, { timeout: 5000 })).ok(), 30000, 1000);
  await page.selectOption("#provider", PROVIDER);
  await page.selectOption("#network", "automation-pc");
  await page.fill("#device", `PC Chrome ${browser.version()} headless (fake mic) — ${name}`);
  await page.fill("#code", code);
  for (const id of ["provider", "network", "device"]) await page.dispatchEvent(`#${id}`, "change");
  people[name] = { context, page, code };
  return people[name];
}
const events = (p) => p.page.evaluate(() => globalThis.__pilotEvents);
const hook = (p, fn) => p.page.evaluate((f) => globalThis.__pilot?.[f]?.(), fn);
const lastEvent = async (p, type, pred = () => true) => (await events(p)).filter((e) => e.type === type && pred(e)).at(-1) ?? null;
const scenario = async (label) => {
  for (const p of Object.values(people)) {
    await p.page.fill("#scenario", `${label}-auto`);
    await p.page.dispatchEvent("#scenario", "change");
  }
};
async function join(p) {
  const before = (await events(p)).length;
  const t0 = Date.now();
  await p.page.click("#join");
  const ev = await waitFor(async () => (await events(p)).slice(before).find((e) => e.type === "joined" || e.type === "join_failed" || e.type === "error"), 30000);
  return { ok: ev?.type === "joined", ms: ev?.ms ?? null, wallMs: Date.now() - t0, error: ev?.type !== "joined" ? (ev?.error ?? "timeout") : null };
}
async function leave(p) {
  await p.page.click("#leave");
  await sleep(1500);
}

// Remote-audio presence as seen by `viewer`, from source identity (LiveKit) or uid (Agora).
async function inboundFrom(viewer, source) {
  const s = await hook(viewer, "stats");
  return (s?.inbound ?? []).find((i) => String(i.from) === String(source)) ?? null;
}
async function audioFlowing(viewer, source, windowMs = 3000) {
  const a = await inboundFrom(viewer, source);
  if (PROVIDER === "agora") {
    await sleep(windowMs);
    const b = await inboundFrom(viewer, source);
    return Boolean(b && (b.receiveKbps ?? 0) > 0);
  }
  await sleep(windowMs);
  const b = await inboundFrom(viewer, source);
  return Boolean(a && b && (b.bytesReceived ?? 0) > (a.bytesReceived ?? 0));
}
const sourceId = async (p) => {
  const info = await hook(p, "joinInfo");
  return PROVIDER === "agora" ? String(info.uid) : info.identity;
};
async function raiseHand(S) {
  const label = (await S.page.textContent("#hand")) ?? "";
  if (label.includes("Lower")) await S.page.click("#hand"); // reset stale local state
  await S.page.click("#hand");
}
async function grantButton(identity) {
  return people.teacher.page.locator("#hands span", { hasText: identity }).locator("button");
}

try {
  // ======================================================================== S1
  await open("teacher", TEACHER);
  for (let i = 0; i < STUDENTS.length; i++) await open(`student-${i + 1}`, STUDENTS[i]);
  await scenario("S1");
  const T = people.teacher;
  await T.page.click("#create");
  const room = await waitFor(async () => {
    const v = await T.page.inputValue("#room");
    return v.startsWith("pilot-") ? v : null;
  }, 15000);
  if (!room) throw new Error("could not create pilot session");
  for (const name of Object.keys(people)) if (name !== "teacher") await people[name].page.fill("#room", room);

  const s1 = { joins: {} };
  s1.joins.teacher = await join(T);
  for (const name of ["student-1", "student-2", "student-3"]) s1.joins[name] = await join(people[name]);
  await sleep(4000);
  const teacherSrc = await sourceId(T);
  s1.firstAudioMs = {};
  for (const name of ["student-1", "student-2", "student-3"]) {
    s1.firstAudioMs[name] = (await lastEvent(people[name], "first_remote_audio"))?.ms ?? null;
  }
  s1.teacherAudioReachesStudents = {};
  for (const name of ["student-1", "student-2", "student-3"]) s1.teacherAudioReachesStudents[name] = await audioFlowing(people[name], teacherSrc);
  s1.participantsSeenByTeacher = (await hook(T, "participants"))?.length ?? null;
  // leave / rejoin student-3
  await leave(people["student-3"]);
  await sleep(2000);
  s1.participantsAfterLeave = (await hook(T, "participants"))?.length ?? null;
  s1.rejoin = await join(people["student-3"]);
  await sleep(4000);
  s1.participantsAfterRejoin = (await hook(T, "participants"))?.length ?? null;
  s1.audioAfterRejoin = await audioFlowing(people["student-3"], teacherSrc);
  result.scenarios.S1 = s1;
  say(`S1 joins ok=${Object.values(s1.joins).every((j) => j.ok)} participants=${s1.participantsSeenByTeacher}/${s1.participantsAfterLeave}/${s1.participantsAfterRejoin}`);

  // ======================================================================== S2
  await scenario("S2");
  const s2 = { cycles: [] };
  for (const name of ["student-1", "student-2", "student-1"]) {
    const S = people[name];
    const src = await sourceId(S);
    const cycle = { student: name };
    cycle.flowingBeforeGrant = await audioFlowing(T, src, 2000);
    await raiseHand(S); // raise
    await waitFor(async () => (await (await grantButton(name)).count()) > 0, 10000);
    const tGrant = Date.now();
    await (await grantButton(name)).click();
    cycle.grantToAudioMs = (await waitFor(async () => ((await audioFlowing(T, src, 500)) ? Date.now() - tGrant : null), 20000, 100)) ?? null;
    cycle.studentMicSet = (await lastEvent(S, "mic_set"))?.on ?? null;
    cycle.micErrors = (await events(S)).filter((e) => e.type === "mic_error").map((e) => e.error);
    await sleep(3000);
    const tRevoke = Date.now();
    await (await grantButton(name)).click(); // "Revoke mic"
    cycle.revokeToSilenceMs = (await waitFor(async () => (!(await audioFlowing(T, src, 500)) ? Date.now() - tRevoke : null), 20000, 100)) ?? null;
    if ((await S.page.textContent("#hand"))?.includes("Lower")) await S.page.click("#hand");
    s2.cycles.push(cycle);
    await sleep(1500);
  }
  result.scenarios.S2 = s2;
  say(`S2 grant→audio ms ${s2.cycles.map((c) => c.grantToAudioMs).join(",")} | revoke→silence ms ${s2.cycles.map((c) => c.revokeToSilenceMs).join(",")}`);

  // ======================================================================== S3
  await scenario("S3");
  const s3 = {};
  {
    // (a) force publish without any grant
    const S = people["student-3"];
    const src = await sourceId(S);
    const before = (await events(S)).length;
    await S.page.click("#force");
    await sleep(6000);
    const evs = (await events(S)).slice(before);
    s3.forcePublish = {
      clientResult: evs.find((e) => e.type === "mic_set") ? "client reported publish success" : evs.find((e) => e.type === "mic_error")?.error ?? "no event",
      teacherReceivesAudio: await audioFlowing(T, src, 3000),
    };
    // stop any forced stream before the next test
    await S.page.evaluate(() => globalThis.__pilot?.stopMic?.());
    await sleep(2000);
  }
  {
    // (b) granted student ignores revoke (simulated modified client)
    const S = people["student-1"];
    const src = await sourceId(S);
    await raiseHand(S);
    await waitFor(async () => (await (await grantButton("student-1")).count()) > 0, 10000);
    await (await grantButton("student-1")).click();
    const flowingAfterGrant = await waitFor(async () => audioFlowing(T, src, 500), 20000, 100);
    await S.page.check("#ignoreRevoke");
    await (await grantButton("student-1")).click(); // revoke
    await sleep(8000);
    const evs = await events(S);
    s3.ignoreRevoke = {
      flowingAfterGrant: Boolean(flowingAfterGrant),
      teacherStillReceivesAfter8s: await audioFlowing(T, src, 3000),
      serverUnpublishedTrack: evs.some((e) => e.type === "local_track_unpublished"),
      permissionChangedEvent: evs.filter((e) => e.type === "permissions_changed").map((e) => e.canPublish),
    };
    await S.page.uncheck("#ignoreRevoke");
  }
  result.scenarios.S3 = s3;
  say(`S3 force: ${s3.forcePublish.teacherReceivesAudio ? "UNAUTHORIZED AUDIO REACHED TEACHER" : "blocked"} | ignore-revoke: ${s3.ignoreRevoke.teacherStillReceivesAfter8s ? "STILL TRANSMITTING" : "stopped"}`);

  // ======================================================================== S4
  await scenario("S4");
  const s4 = { note: "SIMULATED interruption: Chrome offline emulation (blocks HTTP/WebSocket signalling; may not block UDP media)." };
  for (const seconds of [10, 30]) {
    const S = people["student-2"];
    const before = (await events(S)).length;
    await S.context.setOffline(true);
    await sleep(seconds * 1000);
    await S.context.setOffline(false);
    const tBack = Date.now();
    const recovered = await waitFor(async () => (await hook(S, "connected")) && (await audioFlowing(S, teacherSrc, 1000)), 60000, 500);
    const evs = (await events(S)).slice(before);
    s4[`drop${seconds}s`] = {
      recovered: Boolean(recovered),
      recoveryMsAfterRestore: recovered ? Date.now() - tBack : null,
      stateEvents: evs.filter((e) => ["connection_state", "reconnecting", "reconnected", "disconnected"].includes(e.type)).map((e) => `${e.type}${e.state ? ":" + e.state : ""}${e.ms != null ? `(${e.ms}ms)` : ""}`),
      teacherSeesParticipants: (await hook(T, "participants"))?.length ?? null,
    };
    await sleep(3000);
  }
  result.scenarios.S4 = s4;
  say(`S4 10s recovered=${s4.drop10s.recovered} (${s4.drop10s.recoveryMsAfterRestore}ms) 30s recovered=${s4.drop30s.recovered} (${s4.drop30s.recoveryMsAfterRestore}ms)`);

  // ======================================================================== S5
  await scenario("S5");
  const s5 = {};
  const transports = PROVIDER === "livekit" ? ["supabase-realtime", "livekit-data"] : ["supabase-realtime", "livekit-data"];
  await T.page.locator("#wb").scrollIntoViewIfNeeded();
  const box = await T.page.locator("#wb").boundingBox();
  const viewport = T.page.viewportSize();
  s5.canvasFullyVisible = box.y >= 0 && box.y + box.height <= viewport.height;
  async function strokeLine(x0, y0, x1, y1, steps) {
    await T.page.mouse.move(box.x + x0 * box.width, box.y + y0 * box.height);
    await T.page.mouse.down();
    for (let i = 1; i <= steps; i++) await T.page.mouse.move(box.x + (x0 + ((x1 - x0) * i) / steps) * box.width, box.y + (y0 + ((y1 - y0) * i) / steps) * box.height);
    await T.page.mouse.up();
  }
  const fingerprints = async () =>
    Object.fromEntries(await Promise.all(Object.entries(people).map(async ([n, p]) => [n, (await hook(p, "wb"))?.hash ?? null])));
  for (const kind of transports) {
    const t = {};
    for (const p of Object.values(people)) {
      await p.page.selectOption("#transport", kind);
      await p.page.click("#useTransport");
    }
    await sleep(3000);
    const setupErrors = (await Promise.all(Object.values(people).map((p) => events(p)))).flat().filter((e) => e.type === "error" && e.where === "transport").map((e) => e.error);
    if (setupErrors.length) {
      t.available = false;
      t.error = [...new Set(setupErrors)].join("; ");
      s5[kind] = t;
      continue;
    }
    t.available = true;
    await T.page.click("#clear");
    for (let i = 0; i < 20; i++) await strokeLine(0.05, 0.05 + i * 0.04, 0.9, 0.08 + i * 0.04, 30); // long strokes
    for (let i = 0; i < 30; i++) await strokeLine(0.1 + (i % 10) * 0.08, 0.85, 0.12 + (i % 10) * 0.08, 0.9, 2); // rapid short strokes
    await T.page.check("#eraser");
    await strokeLine(0.1, 0.1, 0.5, 0.5, 20);
    await T.page.uncheck("#eraser");
    await T.page.click("#undo");
    await T.page.click("#undo");
    for (let r = 0; r < 3; r++) {
      await T.page.click("#ping");
      await sleep(3500);
    }
    await sleep(3000);
    t.fingerprintsAfterDrawing = await fingerprints();
    t.consistentAfterDrawing = new Set(Object.values(t.fingerprintsAfterDrawing)).size === 1;
    if (!t.consistentAfterDrawing) {
      const ref = new Map((await hook(T, "wbStrokes")).map(([id, er, n]) => [id, `${er}:${n}`]));
      t.strokeDiff = {};
      for (const name of ["student-1", "student-2", "student-3"]) {
        const mine = new Map((await hook(people[name], "wbStrokes")).map(([id, er, n]) => [id, `${er}:${n}`]));
        t.strokeDiff[name] = {
          teacherStrokes: ref.size,
          studentStrokes: mine.size,
          missing: [...ref.keys()].filter((id) => !mine.has(id)),
          extra: [...mine.keys()].filter((id) => !ref.has(id)),
          differentPointCounts: [...ref].filter(([id, v]) => mine.has(id) && mine.get(id) !== v).map(([id, v]) => `${id} teacher=${v} student=${mine.get(id)}`),
        };
      }
    }
    const rtts = (await events(T)).filter((e) => e.type === "wb_rtt" && e.wbTransport === kind).map((e) => e.ms).sort((a, b) => a - b);
    t.rttMs = rtts.length ? { n: rtts.length, p50: rtts[Math.floor(rtts.length / 2)], p95: rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * 0.95))], max: rtts.at(-1) } : null;
    t.bytesSentByTeacher = (await hook(T, "wb"))?.bytesSent ?? null;
    t.strokesDrawn = (await events(T)).filter((e) => e.type === "stroke_end" && e.wbTransport === kind).length;
    t.receiverGaps = {};
    for (const name of ["student-1", "student-2", "student-3"]) {
      const w = await hook(people[name], "wb");
      t.receiverGaps[name] = { received: w?.received, missing: w?.missing, outOfOrder: w?.outOfOrder };
    }
    // Reconnect recovery: student-2 offline while the teacher keeps drawing.
    const S = people["student-2"];
    await S.context.setOffline(true);
    for (let i = 0; i < 5; i++) await strokeLine(0.2, 0.3 + i * 0.05, 0.7, 0.32 + i * 0.05, 15);
    await sleep(10000);
    await S.context.setOffline(false);
    await sleep(15000);
    const fp = await fingerprints();
    t.afterOfflineDrawing = { fingerprints: fp, student2MatchesTeacher: fp["student-2"] === fp.teacher };
    await T.page.click("#clear");
    await sleep(3000);
    const fpClear = await fingerprints();
    t.consistentAfterClear = new Set(Object.values(fpClear)).size === 1;
    s5[kind] = t;
    say(`S5 ${kind}: consistent=${t.consistentAfterDrawing} rtt p50=${t.rttMs?.p50} p95=${t.rttMs?.p95} offline-recovery=${t.afterOfflineDrawing.student2MatchesTeacher}`);
  }
  result.scenarios.S5 = s5;

  // ======================================================================== S6
  await scenario("S6");
  const s6 = { minutes: S6_MIN, note: `Sustained session shortened to ${S6_MIN} min (plan: 60 min) for the automated PC run.` };
  {
    const S = people["student-1"];
    await raiseHand(S);
    await waitFor(async () => (await (await grantButton("student-1")).count()) > 0, 10000);
    await (await grantButton("student-1")).click(); // two-way audio during S6
    const startCounts = Object.fromEntries(await Promise.all(Object.entries(people).map(async ([n, p]) => [n, (await events(p)).length])));
    const end = Date.now() + S6_MIN * 60 * 1000;
    let samples = 0;
    let flowingSamples = 0;
    while (Date.now() < end) {
      await strokeLine(0.3, 0.6, 0.6, 0.62, 10);
      const ok = (await Promise.all(["student-1", "student-2", "student-3"].map((n) => audioFlowing(people[n], teacherSrc, 1000)))).every(Boolean);
      samples++;
      if (ok) flowingSamples++;
      await sleep(10000);
    }
    s6.teacherAudioContinuity = `${flowingSamples}/${samples} samples with teacher audio flowing to all 3 students`;
    s6.perParticipant = {};
    for (const [n, p] of Object.entries(people)) {
      const evs = (await events(p)).slice(startCounts[n]);
      const mem = evs.filter((e) => e.type === "stats").map((e) => e.device?.heapUsedMB).filter((x) => x != null);
      s6.perParticipant[n] = {
        disconnects: evs.filter((e) => e.type === "disconnected").length,
        reconnects: evs.filter((e) => e.type === "reconnected" || (e.type === "connection_state" && /reconnect/i.test(e.state ?? ""))).length,
        errors: evs.filter((e) => /error|exception|failed/.test(e.type)).length,
        heapMB: mem.length ? { start: mem[0], end: mem.at(-1), max: Math.max(...mem) } : null,
      };
    }
    await (await grantButton("student-1")).click();
  }
  result.scenarios.S6 = s6;
  say(`S6 ${s6.teacherAudioContinuity}`);

  // ======================================================================== audio metrics summary
  const metric = { rttMs: [], jitterMs: [], e2eMs: [], lossRate: [], packetsLost: 0, packetsReceived: 0, recvKbps: [] };
  for (const name of ["student-1", "student-2", "student-3"]) {
    for (const e of (await events(people[name])).filter((x) => x.type === "stats" && x.rtc)) {
      if (e.rtc.rttMs != null) metric.rttMs.push(e.rtc.rttMs);
      for (const i of e.rtc.inbound ?? []) {
        if (String(i.from) !== String(teacherSrc)) continue;
        if (i.jitterMs != null) metric.jitterMs.push(i.jitterMs);
        if (i.end2EndDelayMs != null) metric.e2eMs.push(i.end2EndDelayMs);
        if (i.packetLossRate != null) metric.lossRate.push(i.packetLossRate);
        if (i.receiveKbps != null) metric.recvKbps.push(i.receiveKbps);
      }
    }
    const last = (await hook(people[name], "stats"))?.inbound?.find((i) => String(i.from) === String(teacherSrc));
    if (last?.packetsReceived != null) {
      metric.packetsLost += last.packetsLost ?? 0;
      metric.packetsReceived += last.packetsReceived;
    }
  }
  const q = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return { n: s.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s.at(-1) };
  };
  result.audioMetrics = {
    rttMs: q(metric.rttMs),
    jitterMs: q(metric.jitterMs),
    agoraEnd2EndDelayMs: q(metric.e2eMs),
    agoraPacketLossRate: q(metric.lossRate),
    agoraReceiveKbps: q(metric.recvKbps),
    livekitPacketLoss: metric.packetsReceived ? { lost: metric.packetsLost, received: metric.packetsReceived } : null,
  };
  result.browserErrors = {};
  for (const [n, p] of Object.entries(people)) {
    result.browserErrors[n] = [...new Set((await events(p)).filter((e) => /error|exception|failed/.test(e.type)).map((e) => `${e.type}: ${e.error ?? e.msg ?? ""}`.slice(0, 160)))];
  }
} catch (e) {
  result.fatal = String(e?.message ?? e);
  say(`FATAL ${result.fatal}`);
} finally {
  result.finishedAt = new Date().toISOString();
  mkdirSync("results/auto", { recursive: true });
  writeFileSync(`results/auto/${RUN_ID}.json`, JSON.stringify(result, null, 2));
  // Full per-participant event logs for evidence (no secrets: codes are never logged).
  mkdirSync(`results/raw/auto-${RUN_ID}`, { recursive: true });
  for (const [n, p] of Object.entries(people)) {
    try {
      writeFileSync(`results/raw/auto-${RUN_ID}/${n}.json`, JSON.stringify(await events(p)));
      await p.page.click("#leave").catch(() => {});
    } catch {}
  }
  await sleep(2000);
  await browser.close();
  for (const p of procs) p.kill();
  say(`saved results/auto/${RUN_ID}.json`);
}
