// THROWAWAY pilot server: token issuance + minimal session control + telemetry sink.
// Not production code. Mirrors the project's principle that ROLES ARE DECIDED ON THE
// SERVER (here: from pilot codes in pilot/rtc/.env.local), never by the client.
//
// Endpoints (JSON, same-origin via the Vite proxy at /api):
//   GET  /api/config                    → which providers are configured (no secrets)
//   POST /api/session   {code}          → teacher creates a fresh pilot room id
//   POST /api/join      {code, provider, room} → role + provider token (server-chosen role)
//   POST /api/hand      {code, room, up}        → student raises/lowers hand
//   POST /api/mic       {code, room, provider, identity, grant} → teacher grants/revokes mic
//   GET  /api/state?room=&code=         → hands + grants (polled by clients)
//   POST /api/telemetry {events:[...]}  → appended to results/raw/<date>.jsonl
import http from "node:http";
import { randomUUID, randomInt } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import agoraToken from "agora-token";

const { RtcTokenBuilder, RtcRole } = agoraToken;
const PORT = Number(process.env.PILOT_PORT ?? 8787);
const env = (k) => (process.env[k] ?? "").trim();

const TEACHER = env("PILOT_TEACHER_CODE");
const STUDENTS = env("PILOT_STUDENT_CODES").split(",").map((s) => s.trim()).filter(Boolean);
const lk = { url: env("LIVEKIT_URL"), key: env("LIVEKIT_API_KEY"), secret: env("LIVEKIT_API_SECRET") };
const ag = { appId: env("AGORA_APP_ID"), cert: env("AGORA_APP_CERTIFICATE") };
const configured = {
  livekit: Boolean(lk.url && lk.key && lk.secret),
  agora: Boolean(ag.appId && ag.cert),
  roster: Boolean(TEACHER && STUDENTS.length),
};
const TOKEN_TTL_SECONDS = 60 * 60; // pilot sessions are ≤ 1 h

/** Server-side identity: the client sends only its code. */
function whoIs(code) {
  if (!code) return null;
  if (code === TEACHER) return { role: "teacher", identity: "teacher" };
  const i = STUDENTS.indexOf(code);
  return i >= 0 ? { role: "student", identity: `student-${i + 1}` } : null;
}

// In-memory pilot state per room (deliberately not persisted).
const rooms = new Map(); // room → { hands:Set, grants:Set, agoraUids:Map }
const ROOM_RE = /^pilot-[0-9a-f-]{36}$/;
const roomState = (room) => rooms.get(room);

async function liveKitToken(room, who) {
  const at = new AccessToken(lk.key, lk.secret, { identity: who.identity, name: who.identity, ttl: TOKEN_TTL_SECONDS });
  at.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    // Teacher publishes from the start. Students join WITHOUT publish rights; the server
    // grants/revokes them later with UpdateParticipant (server-enforced).
    canPublish: who.role === "teacher",
    canPublishSources: who.role === "teacher" ? undefined : [TrackSource.MICROPHONE],
    // Data is allowed for both so whiteboard ping/pong RTT can be measured in the pilot.
    // Finding to record: LiveKit data permission is all-or-nothing per participant.
    canPublishData: true,
  });
  return at.toJwt();
}

function agoraUid(state, identity) {
  if (!state.agoraUids.has(identity)) state.agoraUids.set(identity, randomInt(1, 2 ** 31));
  return state.agoraUids.get(identity);
}

function agoraTokenFor(room, uid, publisher) {
  // NOTE (official agora-token docs): RtcRole.SUBSCRIBER only restricts publishing if Agora
  // support has enabled co-host authentication; otherwise it equals PUBLISHER. The pilot
  // records which behaviour the test project actually shows.
  return RtcTokenBuilder.buildTokenWithUid(
    ag.appId, ag.cert, room, uid,
    publisher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    TOKEN_TTL_SECONDS, TOKEN_TTL_SECONDS,
  );
}

const lkService = () => new RoomServiceClient(lk.url.replace(/^wss?:/, "https:"), lk.key, lk.secret);

async function handle(req, res, body) {
  const url = new URL(req.url, "http://pilot");
  const send = (status, data) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };

  if (req.method === "GET" && url.pathname === "/api/config") {
    return send(200, {
      configured,
      livekitUrl: configured.livekit ? lk.url : null, // public WebSocket URL, not a secret
      agoraAppId: configured.agora ? ag.appId : null, // App ID is public by design
      supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL") || null,
      supabasePublishableKey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || null,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/telemetry") {
    if (!Array.isArray(body?.events) || body.events.length > 500) return send(400, { error: "bad batch" });
    mkdirSync("results/raw", { recursive: true });
    const file = `results/raw/${new Date().toISOString().slice(0, 10)}.jsonl`;
    const serverTime = Date.now();
    appendFileSync(file, body.events.map((e) => JSON.stringify({ ...e, serverTime })).join("\n") + "\n");
    return send(200, { ok: true });
  }

  const who = whoIs(body?.code ?? url.searchParams.get("code"));
  if (!who) return send(403, { error: "unknown pilot code" });

  if (req.method === "POST" && url.pathname === "/api/session") {
    if (who.role !== "teacher") return send(403, { error: "teacher only" });
    const room = `pilot-${randomUUID()}`; // unguessable, server-generated
    rooms.set(room, { hands: new Set(), grants: new Set(), agoraUids: new Map() });
    return send(200, { room });
  }

  const room = body?.room ?? url.searchParams.get("room");
  if (!ROOM_RE.test(room ?? "") || !roomState(room)) return send(404, { error: "no such pilot room" });
  const state = roomState(room);

  if (req.method === "POST" && url.pathname === "/api/join") {
    const provider = body.provider;
    if (provider === "livekit" && configured.livekit) {
      return send(200, { ...who, provider, url: lk.url, token: await liveKitToken(room, who) });
    }
    if (provider === "agora" && configured.agora) {
      const uid = agoraUid(state, who.identity);
      const publisher = who.role === "teacher" || state.grants.has(who.identity);
      return send(200, { ...who, provider, appId: ag.appId, uid, token: agoraTokenFor(room, uid, publisher) });
    }
    return send(400, { error: `provider ${provider} not configured` });
  }

  if (req.method === "POST" && url.pathname === "/api/hand") {
    if (who.role !== "student") return send(403, { error: "students only" });
    if (body.up) state.hands.add(who.identity);
    else state.hands.delete(who.identity);
    return send(200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/mic") {
    if (who.role !== "teacher") return send(403, { error: "only the teacher can grant/revoke" });
    const target = String(body.identity ?? "");
    if (!/^student-\d+$/.test(target)) return send(400, { error: "bad identity" });
    const grant = Boolean(body.grant);
    const t0 = Date.now();
    if (grant) {
      // Pilot model: one student mic at a time.
      for (const other of state.grants) if (other !== target) await revoke(other);
      state.grants.add(target);
      state.hands.delete(target);
    } else {
      await revoke(target);
    }
    let serverEnforcement = "none";
    if (body.provider === "livekit" && configured.livekit) {
      // Server-enforced: revoking canPublish auto-unpublishes the student's tracks.
      await lkService().updateParticipant(room, target, {
        permission: { canPublish: grant, canSubscribe: true, canPublishData: true, canPublishSources: [TrackSource.MICROPHONE] },
      });
      serverEnforcement = "livekit:updateParticipant";
    }
    async function revoke(identity) {
      state.grants.delete(identity);
      if (body.provider === "livekit" && configured.livekit && identity !== target) {
        await lkService().updateParticipant(room, identity, {
          permission: { canPublish: false, canSubscribe: true, canPublishData: true, canPublishSources: [TrackSource.MICROPHONE] },
        });
      }
    }
    return send(200, { ok: true, grant, target, serverEnforcement, serverMs: Date.now() - t0 });
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const payload = { hands: [...state.hands], grants: [...state.grants] };
    // A granted student on Agora fetches a fresh PUBLISHER token here (client-cooperative model).
    if (who.role === "student" && state.grants.has(who.identity) && configured.agora && url.searchParams.get("provider") === "agora") {
      payload.agoraPublisherToken = agoraTokenFor(room, agoraUid(state, who.identity), true);
    }
    return send(200, payload);
  }

  return send(404, { error: "not found" });
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on("end", async () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        res.writeHead(400).end();
        return;
      }
      try {
        await handle(req, res, body);
      } catch (e) {
        console.error("[pilot]", e?.message ?? e);
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "server error" }));
      }
    });
  })
  .listen(PORT, () => {
    console.log(`[pilot] token server on :${PORT} — configured: ${JSON.stringify(configured)}`);
  });
