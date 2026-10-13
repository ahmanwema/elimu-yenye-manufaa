import { connectAgora } from "./providers/agora.js";
import { connectLiveKit } from "./providers/livekit.js";
import { deviceSample, log, setContext } from "./telemetry.js";
import { createWhiteboard } from "./whiteboard.js";

const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  const res = await fetch(`/api/${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

const config = await api("config");
log("pilot_loaded", { configured: config.configured, ua: navigator.userAgent });

let rtc = null;
let join = null;
let wb = null;
let disposeTransport = null;
let micOn = false;
let handUp = false;
let pollTimer = null;
let statsTimer = null;

function context() {
  setContext({
    provider: $("provider").value,
    network: $("network").value,
    device: $("device").value || null,
    scenario: $("scenario").value || null,
    role: join?.role ?? null,
    identity: join?.identity ?? null,
  });
}
for (const id of ["provider", "network", "device", "scenario"]) $(id).addEventListener("change", context);
context();

$("create").onclick = async () => {
  try {
    const { room } = await api("session", { code: $("code").value });
    $("room").value = room;
    log("session_created", { room });
  } catch (e) {
    log("error", { where: "create", error: e.message });
  }
};

$("join").onclick = async () => {
  const provider = $("provider").value;
  try {
    join = { ...(await api("join", { code: $("code").value, provider, room: $("room").value })), room: $("room").value };
    context();
    $("who").textContent = `Joined as ${join.identity} (${join.role}, decided by the server) via ${provider}`;
    const handlers = {
      onRemoteAudio: (from, el) => el && $("audio").append(el),
      onData: (payload, from) => wb?.receive(payload, from),
    };
    rtc = provider === "livekit" ? await connectLiveKit(join, handlers) : await connectAgora(join, handlers);
    if (join.role === "teacher") await rtc.setMic(true);
    wb = wb ?? createWhiteboard({ canvas: $("wb"), identity: join.identity, isTeacher: join.role === "teacher" });
    $("teacherBox").hidden = join.role !== "teacher";
    $("studentBox").hidden = join.role !== "student";
    $("leave").disabled = false;
    $("join").disabled = true;
    pollTimer = setInterval(poll, 1000);
    statsTimer = setInterval(sampleStats, 2000);
  } catch (e) {
    log("error", { where: "join", error: e.message });
  }
};

$("leave").onclick = async () => {
  clearInterval(pollTimer);
  clearInterval(statsTimer);
  disposeTransport?.();
  await rtc?.leave();
  log("left");
  rtc = null;
  $("join").disabled = false;
  $("leave").disabled = true;
};

async function sampleStats() {
  if (!rtc) return;
  try {
    log("stats", { connected: rtc.connected(), rtc: await rtc.stats(), wb: wb?.stats(), device: deviceSample() });
  } catch (e) {
    log("stats_error", { error: String(e?.message ?? e) });
  }
}

async function poll() {
  if (!join) return;
  let state;
  try {
    state = await api(`state?room=${encodeURIComponent(join.room)}&code=${encodeURIComponent($("code").value)}&provider=${join.provider}`);
  } catch {
    return; // network drop: next tick retries
  }
  if (join.role === "teacher") return renderHands(state);
  const granted = state.grants.includes(join.identity);
  if (granted && !micOn) {
    micOn = true;
    log("grant_observed");
    await rtc.setMic(true, state.agoraPublisherToken);
  } else if (!granted && micOn) {
    log("revoke_observed", { ignoring: $("ignoreRevoke").checked });
    if (!$("ignoreRevoke").checked) {
      micOn = false;
      await rtc.setMic(false);
    }
  }
  $("micState").textContent = `Mic: ${micOn ? "ON (granted)" : "off"}${$("ignoreRevoke").checked ? " — ignoring revoke (test)" : ""}`;
}

function renderHands(state) {
  const box = $("hands");
  const ids = new Set([...state.hands, ...state.grants]);
  box.replaceChildren(
    ...[...ids].map((id) => {
      const span = document.createElement("span");
      const granted = state.grants.includes(id);
      span.textContent = `${id}${state.hands.includes(id) ? " ✋" : ""} `;
      const b = document.createElement("button");
      b.textContent = granted ? "Revoke mic" : "Grant mic";
      b.onclick = async () => {
        const t0 = performance.now();
        const r = await api("mic", { code: $("code").value, room: join.room, provider: join.provider, identity: id, grant: !granted });
        log(granted ? "revoke_sent" : "grant_sent", { target: id, roundTripMs: Math.round(performance.now() - t0), serverEnforcement: r.serverEnforcement });
      };
      span.append(b);
      return span;
    }),
  );
  if (ids.size === 0) box.textContent = "No raised hands.";
}

$("hand").onclick = async () => {
  handUp = !handUp;
  await api("hand", { code: $("code").value, room: join.room, up: handUp });
  $("hand").textContent = handUp ? "Lower hand" : "Raise hand";
  log(handUp ? "hand_raised" : "hand_lowered");
};

// Security test: publish WITHOUT a grant. A secure setup must refuse this server-side.
$("force").onclick = async () => {
  log("force_publish_attempt");
  await rtc.setMic(true);
};

$("useTransport").onclick = async () => {
  disposeTransport?.();
  const kind = $("transport").value;
  try {
    disposeTransport = await wb.useTransport(kind, { rtc, config, room: join.room });
    setContext({ wbTransport: kind });
    log("wb_transport", { kind });
  } catch (e) {
    log("error", { where: "transport", kind, error: e.message });
  }
};
$("ping").onclick = () => {
  for (let i = 0; i < 10; i++) setTimeout(() => wb.ping(), i * 300);
};
$("clear").onclick = () => wb.clear();
$("undo").onclick = () => wb.undo();
$("eraser").onchange = (e) => wb.setEraser(e.target.checked);
// Read-only hooks for automated runs (no secrets): current board fingerprint and stats.
globalThis.__pilot = {
  wb: () => wb?.stats() ?? null,
  connected: () => rtc?.connected() ?? false,
  participants: () => rtc?.participants() ?? [],
  stats: () => rtc?.stats() ?? null,
  stopMic: () => rtc?.setMic(false),
  wbStrokes: () => wb?.strokesSummary() ?? [],
  joinInfo: () => (join ? { role: join.role, identity: join.identity, provider: join.provider, uid: join.uid ?? null } : null),
};
$("page").onchange = (e) => wb.setPage(Number(e.target.value));
