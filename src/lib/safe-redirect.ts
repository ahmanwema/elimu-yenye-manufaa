// Post-sign-in redirect targets come from the URL and are untrusted. Only same-origin
// relative paths are allowed; anything else falls back. Parsing with the WHATWG URL
// parser (rather than string checks alone) catches tricks like "/\evil.com",
// "//evil.com", "/%09/evil.com" and "javascript:".

const BASE = "http://local.invalid";

export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters and whitespace have no place in a path we generated ourselves.
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
