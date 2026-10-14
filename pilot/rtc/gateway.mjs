// THROWAWAY pilot gateway for real-device tests (Phase 2). Exposes ONLY:
//   - the built pilot page (dist/, from `npx vite build`), read-only;
//   - the pilot API (/api/<allow-listed endpoint>), proxied to server.mjs on 127.0.0.1.
// Nothing else on this PC is reachable through it: no Vite dev server, no source, no results,
// no env files, no directory listings.
//
// Listeners:
//   LAN    https://0.0.0.0:PILOT_LAN_PORT (default 5443) with a LOCAL self-signed certificate
//          from .certs/ (git-ignored; created with openssl, see README).
//   TUNNEL http://127.0.0.1:PILOT_TUNNEL_PORT (default 5480), loopback only, for a temporary
//          `cloudflared tunnel --url` (the tunnel provides the public HTTPS).
import http from "node:http";
import https from "node:https";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

const DIST = join(import.meta.dirname, "dist");
const API = { host: "127.0.0.1", port: Number(process.env.PILOT_PORT ?? 8787) };
const LAN_PORT = Number(process.env.PILOT_LAN_PORT ?? 5443);
const TUNNEL_PORT = Number(process.env.PILOT_TUNNEL_PORT ?? 5480);
const API_PATHS = new Set(["config", "session", "join", "hand", "mic", "state", "telemetry"]);
const MAX_BODY = 1_000_000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const baseHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "microphone=(self), camera=(), geolocation=()",
  "cache-control": "no-store",
};

function deny(res, status) {
  res.writeHead(status, { ...baseHeaders, "content-type": "text/plain" }).end(String(status));
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return deny(res, 405);
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  // No dotfiles, no traversal, nothing outside dist/.
  if (rel.split("/").some((part) => part.startsWith(".") || part === "")) return deny(res, 404);
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || !statSync(file).isFile()) return deny(res, 404);
  res.writeHead(200, { ...baseHeaders, "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(req.method === "HEAD" ? undefined : readFileSync(file));
}

function proxyApi(req, res, url, client) {
  const name = url.pathname.slice("/api/".length);
  if (!API_PATHS.has(name) || (req.method !== "GET" && req.method !== "POST")) return deny(res, 404);
  const headers = { "content-type": "application/json", "x-pilot-client": client };
  const upstream = http.request({ ...API, method: req.method, path: url.pathname + url.search, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, { ...baseHeaders, "content-type": "application/json" });
    up.pipe(res);
  });
  upstream.on("error", () => deny(res, 502));
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      req.destroy();
      upstream.destroy();
    }
  });
  req.pipe(upstream);
}

/** @param {"lan"|"tunnel"} via */
function handler(via) {
  return (req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://pilot");
    } catch {
      return deny(res, 400);
    }
    // Client identity for the wrong-code brake. Via the tunnel every request arrives from
    // cloudflared on loopback, so Cloudflare's header is used; on the LAN, the socket address.
    const client = via === "tunnel" ? `cf:${req.headers["cf-connecting-ip"] ?? "unknown"}` : `lan:${req.socket.remoteAddress}`;
    // Access log WITHOUT query strings (they carry pilot codes).
    res.on("finish", () => console.log(`[gateway:${via}] ${req.method} ${url.pathname} ${res.statusCode}`));
    if (url.pathname.startsWith("/api/")) return proxyApi(req, res, url, client);
    return serveStatic(req, res, url.pathname);
  };
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("[gateway] dist/ missing — run `npx vite build` first");
  process.exit(1);
}

const certDir = join(import.meta.dirname, ".certs");
if (existsSync(join(certDir, "lan-key.pem"))) {
  https
    .createServer({ key: readFileSync(join(certDir, "lan-key.pem")), cert: readFileSync(join(certDir, "lan-cert.pem")) }, handler("lan"))
    .listen(LAN_PORT, "0.0.0.0", () => console.log(`[gateway] LAN https on 0.0.0.0:${LAN_PORT}`));
} else {
  console.log("[gateway] no .certs/lan-key.pem — LAN listener disabled");
}
http.createServer(handler("tunnel")).listen(TUNNEL_PORT, "127.0.0.1", () => console.log(`[gateway] tunnel http on 127.0.0.1:${TUNNEL_PORT} (loopback only)`));
