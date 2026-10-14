# RTC Pilot (THROWAWAY) — Agora vs LiveKit + whiteboard transport

Evidence-gathering only. **Not** the Elimu app, **not** production architecture, and no vendor is chosen here (A35). Delete this folder to remove the pilot completely. It has its own `package.json` and `node_modules`, and is excluded from the app's lint, typecheck, tests and build.

Plan: [docs/testing/rtc-pilot-plan.md](../../docs/testing/rtc-pilot-plan.md) · Results: [docs/testing/rtc-pilot-results.md](../../docs/testing/rtc-pilot-results.md)

## What it does

- A small token server (`server.mjs`) issues LiveKit/Agora tokens. **Roles come from pilot codes in `.env.local` on the server**, never from the browser. Room ids are random (`pilot-<uuid>`).
- One page (`index.html`) runs the same scenario on either provider:
  - teacher audio;
  - students join muted;
  - raise hand → grant → revoke (one mic at a time);
  - reconnect telemetry;
  - a whiteboard sent over Supabase Realtime (independent) or the LiveKit data channel (coupled).
- Security tests:
  - **Force publish** (a student without a grant tries to transmit);
  - **Ignore revoke** (simulates a modified client).
- Telemetry goes to `results/raw/*.jsonl` (git-ignored, no secrets). `npm run analyze` writes `results/summary.md`.

## Setup — owner steps (development / free-tier accounts only, never production)

### LiveKit Cloud
1. Sign up at cloud.livekit.io and create a project, e.g. `elimu-pilot`, on the free **Build** plan.
2. Settings → Keys → create an API key. Note the **WebSocket URL** (`wss://…livekit.cloud`), **API Key** and **API Secret**.

### Agora
1. Sign up at console.agora.io and create a project, e.g. `elimu-pilot`, with authentication **"Secured mode: APP ID + Token"**.
2. Note the **App ID** and the **Primary Certificate**.
3. Optional but important for the security test: ask Agora support whether **co-host authentication** can be enabled for the project. Without it, Agora documents that a subscriber token can still publish.

### Local configuration (never paste values into chat)
1. Copy `.env.example` to **`pilot/rtc/.env.local`** (git-ignored) and fill in the values.
2. Choose your own `PILOT_TEACHER_CODE` and `PILOT_STUDENT_CODES`.
3. The Supabase URL and publishable key for the whiteboard transport are read from the app's `.env.local` (development project only).

## Run (Windows laptop = teacher)

```bash
cd pilot/rtc
npm run server        # terminal 1: token server on :8787
npm run client        # terminal 2: https://<laptop-ip>:5173 (self-signed certificate)
```

- **Teacher (laptop Chrome):** open `https://localhost:5173`, enter the teacher code, press **Create session**, then share the room id.
- **Students (phones on the same Wi-Fi):** open `https://<laptop-ip>:5173`, accept the certificate warning, enter a student code and the room id, then join.
- **Before each run,** fill in Provider, Network, Device and Scenario.

### Remote / 4G testing
Phones on 4G cannot reach a laptop on Wi-Fi. That needs a temporary HTTPS tunnel to the laptop (for example Cloudflare's `cloudflared tunnel --url https://localhost:5173`, a single downloaded program). **This is an owner decision**, because it exposes the pilot publicly for the duration of the test. Use only throwaway pilot codes.

## Real-device access (Phase 2): hardened gateway

Use this instead of the Vite dev server whenever phones connect.

1. **Build:** `npx vite build` (writes `dist/`).
2. **Certificate:** create a local dev certificate, git-ignored and valid 7 days:
   ```bash
   mkdir -p .certs && MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
     -keyout .certs/lan-key.pem -out .certs/lan-cert.pem -subj "/CN=elimu-rtc-pilot-LOCAL-DEV" \
     -addext "subjectAltName=IP:<PC-LAN-IP>,DNS:localhost,IP:127.0.0.1"
   ```
3. **Run:** `npm run server` (token server, 127.0.0.1:8787 only) and `node gateway.mjs`.
   - LAN: `https://<PC-LAN-IP>:5443`.
   - Tunnel: `http://127.0.0.1:5480`, loopback only.
4. **What the gateway exposes:** only `dist/` and the 7 pilot API endpoints. Every endpoint except `/api/config` (configured flags only) needs a pilot code, and wrong codes are rate-limited.
5. **Stop it** after testing, and confirm the ports are closed.

Owner runbook: [docs/testing/rtc-phase2-runbook.md](../../docs/testing/rtc-phase2-runbook.md). A public tunnel (`cloudflared tunnel --url http://127.0.0.1:5480`) is an owner decision each time. As of 2026-10-14 it has never been opened.

## Automated side-by-side run (one PC)

`node automation/run.mjs --provider livekit|agora [--s6-minutes 10]`
- Starts the token server and the page itself.
- Drives the real page in your installed Chrome (headless, fake microphone tone) as 1 teacher + 3 students, through S1–S6.
- Saves `results/auto/<run>.json` (summary) and `results/raw/auto-<run>/` (full event logs, git-ignored).

`node automation/compare.mjs` builds `results/automated-comparison.md` from full runs.

The automated run uses this PC's real connection. It does **not** replace the phone, 4G and XPPen tests in the plan. S4 interruptions in it are simulated (Chrome offline emulation).

## Tests

`npm test` runs the token-server security checks without any provider credentials:
- roles are taken from the server;
- rooms are unguessable;
- students cannot create sessions or control mics;
- one mic at a time.
