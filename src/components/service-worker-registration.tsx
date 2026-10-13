"use client";

import { useEffect } from "react";

// Registers the minimal service worker in production builds only, so local
// development never serves stale assets.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installability is an enhancement; the site works without a service worker.
    });
  }, []);
  return null;
}
