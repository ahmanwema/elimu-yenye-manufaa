// Elimu Yenye Manufaa — minimal service worker (Phase 1 foundation).
//
// Policy (docs/system/pwa.md):
//   - Only the static offline page and the placeholder icons are cached.
//   - Navigations go to the network; the offline page is shown only if the network fails.
//   - Nothing else is intercepted. Authenticated pages, API responses, Server Actions,
//     media and any private data are NEVER cached by this worker.

const CACHE = "elimu-shell-v2";
const LOCALES = ["sw", "en", "ar"];
const DEFAULT_LOCALE = "sw";
const PRECACHE = [...LOCALES.map((l) => `/${l}/offline`), "/icons/icon-192.png", "/icons/icon-512.png"];

// Offline page in the language of the page being visited (Kiswahili by default).
function offlinePathFor(url) {
  const first = new URL(url).pathname.split("/")[1];
  return `/${LOCALES.includes(first) ? first : DEFAULT_LOCALE}/offline`;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(async () => (await caches.match(offlinePathFor(request.url))) ?? Response.error()),
  );
});
