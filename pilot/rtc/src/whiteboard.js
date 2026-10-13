// Operation-based whiteboard for the pilot (no image streaming). Ops are sent over one of:
//   "livekit-data"      — LiveKit data packets (reliable, topic "wb")      [coupled to RTC]
//   "supabase-realtime" — Supabase Realtime broadcast on a pilot channel    [independent]
// Ops: pts (part of stroke id, optional eraser), undo (stroke id), clear, page, ping/pong.
// Measures: ordering (seq gaps), loss, ping/pong RTT, bytes sent, and a STATE FINGERPRINT
// (hash of the stroke list) so sender and receivers can be compared for consistency.
import { createClient } from "@supabase/supabase-js";
import { log } from "./telemetry.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function createWhiteboard({ canvas, identity, isTeacher }) {
  const ctx = canvas.getContext("2d");
  let send = null;
  let seq = 0;
  let bytesSent = 0;
  let strokeCounter = 0;
  const lastSeq = new Map(); // sender → last seq seen
  const gaps = { outOfOrder: 0, missing: 0, received: 0 };
  const pings = new Map(); // id → sentAt
  let page = 1;
  // Board state: ordered strokes; each stroke = { id, er, pts: [[x,y,p], ...] }
  const strokes = new Map();
  let eraser = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * devicePixelRatio);
    canvas.height = Math.max(1, r.height * devicePixelRatio);
    redraw();
  }

  function paintSegment(pts, er) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = er ? "destination-out" : "source-over";
    ctx.strokeStyle = "#4fb3a5";
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1, p] = pts[i];
      ctx.lineWidth = Math.max(1, (er ? 4 : 1) * (p || 0.5) * 6 * devicePixelRatio);
      ctx.beginPath();
      ctx.moveTo(x0 * w, y0 * h);
      ctx.lineTo(x1 * w, y1 * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes.values()) paintSegment(s.pts, s.er);
  }

  /** Applies an op to local state (used for both local and remote ops). */
  function apply(op) {
    if (op.k === "clear") {
      strokes.clear();
      return redraw();
    }
    if (op.k === "undo") {
      strokes.delete(op.id);
      return redraw();
    }
    if (op.k === "pts" && op.pts?.length) {
      const s = strokes.get(op.id) ?? { id: op.id, er: Boolean(op.er), pts: [] };
      const prevLast = s.pts.at(-1);
      s.pts.push(...op.pts);
      strokes.set(op.id, s);
      paintSegment(prevLast ? [prevLast, ...op.pts] : op.pts, s.er);
    }
  }

  /** Deterministic, ORDER-SENSITIVE fingerprint: stroke order, ids, eraser flags and every point. */
  function fingerprint() {
    const text = [...strokes.values()].map((s) => `${s.id}:${s.er ? 1 : 0}:${s.pts.map((p) => p.join(",")).join(";")}`).join("|");
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return { hash: h.toString(16), strokes: strokes.size, points: [...strokes.values()].reduce((n, s) => n + s.pts.length, 0) };
  }

  function emit(op) {
    if (!send) return;
    const msg = { ...op, s: identity, q: ++seq, at: Date.now(), page };
    const bytes = enc.encode(JSON.stringify(msg));
    bytesSent += bytes.byteLength;
    Promise.resolve(send(bytes, msg)).catch((e) => log("wb_send_error", { error: String(e?.message ?? e) }));
  }

  function receive(bytesOrObj, from) {
    const msg = bytesOrObj instanceof Uint8Array ? JSON.parse(dec.decode(bytesOrObj)) : bytesOrObj;
    gaps.received++;
    const prev = lastSeq.get(msg.s) ?? 0;
    if (msg.q <= prev) gaps.outOfOrder++;
    else if (msg.q > prev + 1) gaps.missing += msg.q - prev - 1;
    lastSeq.set(msg.s, Math.max(prev, msg.q));
    if (msg.k === "ping" && !isTeacher) return emit({ k: "pong", id: msg.id, to: msg.s });
    if (msg.k === "pong") {
      if (msg.to === identity && pings.has(msg.id)) log("wb_rtt", { ms: Date.now() - pings.get(msg.id), from: msg.s ?? from });
      return;
    }
    if (msg.k === "page") return;
    apply(msg);
  }

  // --- pointer capture (teacher) with XPPen-relevant details -------------------------
  let stroke = null;
  let pointerStats = null;
  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4), +(e.pressure ?? 0).toFixed(3)];
  };
  const flush = (final) => {
    if (!stroke || stroke.pending.length === 0) return;
    const keep = final ? 0 : 1;
    const chunk = stroke.pending.splice(0, stroke.pending.length - keep);
    if (!chunk.length) return;
    const op = { k: "pts", id: stroke.id, er: eraser || undefined, pts: chunk };
    apply(op);
    emit(op);
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!isTeacher) return;
    canvas.setPointerCapture(e.pointerId);
    stroke = { id: `${identity}-${++strokeCounter}`, pending: [norm(e)] };
    pointerStats = { events: 1, pen: e.pointerType === "pen" ? 1 : 0, withPressure: 0, maxPressure: 0, minPressure: 1, coalesced: 0, startedAt: performance.now() };
    log("pointer_down", { pointerType: e.pointerType, pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY, width: e.width, eraser });
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!stroke) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    pointerStats.coalesced += events.length;
    for (const ev of events) {
      pointerStats.events++;
      if (ev.pointerType === "pen") pointerStats.pen++;
      if (ev.pressure > 0 && ev.pressure !== 0.5) pointerStats.withPressure++;
      pointerStats.maxPressure = Math.max(pointerStats.maxPressure, ev.pressure);
      if (ev.pressure > 0) pointerStats.minPressure = Math.min(pointerStats.minPressure, ev.pressure);
      stroke.pending.push(norm(ev));
    }
    if (stroke.pending.length >= 8) flush(false);
  });
  const end = () => {
    if (!stroke) return;
    flush(true);
    const ms = performance.now() - pointerStats.startedAt;
    log("stroke_end", { ...pointerStats, durationMs: Math.round(ms), eventsPerSec: ms > 0 ? Math.round((pointerStats.events / ms) * 1000) : null });
    stroke = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  resize();
  addEventListener("resize", resize);

  return {
    receive,
    fingerprint,
    /** Per-stroke summary for diagnosing mismatches (ids + point counts; no content). */
    strokesSummary: () => [...strokes.values()].map((s) => [s.id, s.er ? 1 : 0, s.pts.length]),
    stats: () => ({ ...gaps, bytesSent, ...fingerprint() }),
    setEraser(on) {
      eraser = on;
    },
    undo() {
      const last = [...strokes.keys()].filter((id) => id.startsWith(`${identity}-`)).at(-1);
      if (!last) return;
      const op = { k: "undo", id: last };
      apply(op);
      emit(op);
    },
    clear() {
      apply({ k: "clear" });
      emit({ k: "clear" });
    },
    setPage(n) {
      page = n;
      emit({ k: "page", n });
    },
    ping() {
      const id = Math.random().toString(36).slice(2);
      pings.set(id, Date.now());
      emit({ k: "ping", id });
    },
    /** Attach a transport. Returns a disposer. */
    async useTransport(kind, { rtc, config, room }) {
      // Counters are per transport, so results never mix two transports.
      lastSeq.clear();
      seq = 0;
      bytesSent = 0;
      gaps.outOfOrder = 0;
      gaps.missing = 0;
      gaps.received = 0;
      if (kind === "livekit-data") {
        if (!rtc?.sendData) throw new Error("this provider has no data channel in the browser SDK");
        send = (bytes) => rtc.sendData(bytes);
        return () => (send = null);
      }
      if (kind === "supabase-realtime") {
        const sb = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false } });
        const channel = sb.channel(`pilot-wb-${room}`, { config: { broadcast: { self: false, ack: false } } });
        channel.on("broadcast", { event: "op" }, ({ payload }) => receive(payload, payload.s));
        await new Promise((resolve, reject) => {
          channel.subscribe((status) => {
            log("wb_transport_status", { kind, status });
            if (status === "SUBSCRIBED") resolve();
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
          });
        });
        send = (_bytes, msg) => channel.send({ type: "broadcast", event: "op", payload: msg });
        return () => {
          send = null;
          sb.removeChannel(channel);
        };
      }
      throw new Error(`unknown transport ${kind}`);
    },
  };
}
