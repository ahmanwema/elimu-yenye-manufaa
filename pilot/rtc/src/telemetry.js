// Pilot telemetry: every event carries the test context so results can be compared fairly.
// Batched to the pilot server (results/raw/*.jsonl). Contains NO secrets or tokens.

let context = {};
let queue = [];
let authCode = null; // sent with each batch (the server requires it); NEVER copied into events

export function setTelemetryAuth(code) {
  authCode = code || null;
}

export function setContext(next) {
  context = { ...context, ...next };
}

// Also kept on window for automated runs (read by automation/run.mjs). No secrets.
const all = (globalThis.__pilotEvents = []);

export function log(type, data = {}) {
  const event = { t: Date.now(), type, ...context, ...data };
  queue.push(event);
  all.push(event);
  const line = document.createElement("div");
  line.textContent = `${new Date(event.t).toISOString().slice(11, 23)} ${type} ${JSON.stringify(data)}`;
  const box = document.getElementById("log");
  box?.prepend(line);
  while (box && box.childElementCount > 200) box.lastChild.remove();
}

async function flush() {
  if (queue.length === 0 || !authCode) return; // held until a valid code has been used
  const events = queue.splice(0, 500);
  try {
    const res = await fetch("/api/telemetry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: authCode, events }) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    queue.unshift(...events); // keep for the next attempt (e.g. during a network drop)
  }
}
setInterval(flush, 5000);
addEventListener("pagehide", flush);

/** CPU/memory hints the browser exposes (Chrome only; absent elsewhere — never invented). */
export function deviceSample() {
  const m = performance.memory;
  return {
    heapUsedMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null,
    cores: navigator.hardwareConcurrency ?? null,
    connection: navigator.connection
      ? { effectiveType: navigator.connection.effectiveType, downlinkMbps: navigator.connection.downlink, rttMs: navigator.connection.rtt }
      : null,
  };
}
