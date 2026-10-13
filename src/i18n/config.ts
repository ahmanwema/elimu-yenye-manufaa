// Locale configuration (A49/A50). Pure — safe to import from the proxy, server and tests.

export const LOCALES = ["sw", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/** Kiswahili is the default UI language. */
export const DEFAULT_LOCALE: Locale = "sw";

/** Remembers the chosen language in the browser (set by the proxy). */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const RTL_LOCALES: readonly Locale[] = ["ar"];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Any unknown or missing value falls back to Kiswahili. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeDirection(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

/** The locale prefix of a pathname, if any ("/ar/account" → "ar"). */
export function localeFromPathname(pathname: string): Locale | null {
  const first = pathname.split("/")[1];
  return isLocale(first) ? first : null;
}

/** Same page in another language ("/en/account" → "/ar/account"). */
export function switchLocalePath(pathname: string, target: Locale): string {
  const current = localeFromPathname(pathname);
  const rest = current ? pathname.slice(current.length + 1) : pathname;
  return `/${target}${rest === "" ? "" : rest.startsWith("/") ? rest : `/${rest}`}`;
}

/**
 * Proxy decision for a request path. Returns the redirect target when the path has no
 * locale prefix (using the remembered locale, else Kiswahili), or null to continue.
 */
export function localeRedirectTarget(pathname: string, search: string, cookieValue: string | undefined): string | null {
  if (localeFromPathname(pathname)) return null;
  const locale = resolveLocale(cookieValue);
  const path = pathname === "/" ? "" : pathname;
  return `/${locale}${path}${search}`;
}
