"use client";

import { useSyncExternalStore } from "react";

// Light / dark toggle (A156). The choice lives only in this browser (localStorage) and on
// <html data-theme>; nothing is sent to the server. With no saved choice the system
// preference applies. THEME_BOOT_SCRIPT (in the layout <head>) applies a saved choice before
// first paint, so the page never flashes the wrong theme.

import { THEME_STORAGE_KEY } from "@/lib/theme";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", onChange);
  window.addEventListener("themechange", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("themechange", onChange);
  };
}

export function ThemeToggle({ toLight, toDark }: { toLight: string; toDark: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => null);

  const toggle = () => {
    const next: Theme = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    window.dispatchEvent(new Event("themechange"));
  };

  // Before hydration the theme is unknown; the button still works and shows a neutral icon.
  const label = theme === "light" ? toDark : toLight;
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {theme === "light" ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
