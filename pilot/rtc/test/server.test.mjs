// Pilot server security smoke test. Runs WITHOUT any provider credentials: it checks that
// roles come from the server, rooms are unguessable, and students cannot control mics.
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const PORT = 18787;
let proc;
const base = `http://127.0.0.1:${PORT}/api`;
const post = (path, body) =>
  fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  proc = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PILOT_PORT: String(PORT), PILOT_TEACHER_CODE: "t-code", PILOT_STUDENT_CODES: "s1,s2", LIVEKIT_URL: "", AGORA_APP_ID: "", NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk-test-value", PILOT_MAX_CODE_FAILURES: "6" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/config`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("pilot server did not start");
});
after(() => proc?.kill());

test("config exposes no secrets", async () => {
  const c = await (await fetch(`${base}/config`)).json();
  assert.equal(JSON.stringify(c).includes("secret"), false);
  assert.deepEqual(Object.keys(c.configured).sort(), ["agora", "livekit", "roster"]);
  // Phase 2 (public tunnel): only the "configured" flags are public — no URLs or keys.
  assert.deepEqual(Object.keys(c), ["configured"]);
  assert.equal(JSON.stringify(c).includes("pk-test-value"), false);
});

test("telemetry requires a valid pilot code", async () => {
  assert.equal((await post("telemetry", { events: [{ type: "x" }] })).status, 403);
  assert.equal((await post("telemetry", { code: "s1", events: "nope" })).status, 400);
});

test("unknown codes are refused; a student cannot create a session", async () => {
  assert.equal((await post("session", { code: "nope" })).status, 403);
  assert.equal((await post("session", { code: "s1" })).status, 403);
});

test("rooms are server-generated and unguessable; unknown rooms are refused", async () => {
  const { room } = await (await post("session", { code: "t-code" })).json();
  assert.match(room, /^pilot-[0-9a-f-]{36}$/);
  assert.equal((await post("hand", { code: "s1", room: "pilot-00000000-0000-0000-0000-000000000000", up: true })).status, 404);
});

test("only the teacher can grant/revoke a mic; the role is not taken from the client", async () => {
  const { room } = await (await post("session", { code: "t-code" })).json();
  const asStudent = await post("mic", { code: "s1", room, identity: "student-2", grant: true, role: "teacher" });
  assert.equal(asStudent.status, 403);
  const asTeacher = await post("mic", { code: "t-code", room, identity: "student-1", grant: true, provider: "none" });
  assert.equal(asTeacher.status, 200);
  const state = await (await fetch(`${base}/state?room=${room}&code=s2`)).json();
  assert.deepEqual(state.grants, ["student-1"]);
});

test("one student mic at a time", async () => {
  const { room } = await (await post("session", { code: "t-code" })).json();
  await post("mic", { code: "t-code", room, identity: "student-1", grant: true, provider: "none" });
  await post("mic", { code: "t-code", room, identity: "student-2", grant: true, provider: "none" });
  const state = await (await fetch(`${base}/state?room=${room}&code=t-code`)).json();
  assert.deepEqual(state.grants, ["student-2"]);
});

// Must stay LAST: it locks this test client out.
test("repeated wrong codes lock the client out, even for a valid code", async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await post("session", { code: `wrong-${i}` })).status);
  assert.ok(statuses.every((s) => s === 403 || s === 429)); // earlier tests already counted some
  assert.equal(statuses.at(-1), 429);
  assert.equal((await post("session", { code: "t-code" })).status, 429);
  // A different client (as identified by the gateway) is unaffected.
  const other = await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json", "x-pilot-client": "203.0.113.7" }, body: JSON.stringify({ code: "t-code" }) });
  assert.equal(other.status, 200);
});
