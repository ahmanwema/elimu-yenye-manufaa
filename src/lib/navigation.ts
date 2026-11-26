// Client-safe navigation helpers (no server imports). The links themselves are built
// server-side from the Actor in src/server/navigation.ts.

export const NAV_KEYS = ["home", "markaz", "classes", "payments", "platform", "account"] as const;
export type NavKey = (typeof NAV_KEYS)[number];

export type NavItem = { key: NavKey; href: string };

/** The bottom bar on phones holds at most this many items. */
export const BOTTOM_NAV_MAX = 5;

/**
 * The phone bar: everything when it fits. Otherwise "home" goes first (the wordmark in the
 * top bar links home), then items are cut from the middle so "account" always stays last.
 */
export function bottomNav(items: readonly NavItem[]): NavItem[] {
  let list = items.length > BOTTOM_NAV_MAX ? items.filter((i) => i.key !== "home") : [...items];
  if (list.length > BOTTOM_NAV_MAX) {
    const last = list[list.length - 1];
    list = [...list.slice(0, BOTTOM_NAV_MAX - 1), last];
  }
  return list;
}

/**
 * Which item is current. "home" matches only its exact path; every other item matches its
 * path or a "/"-bounded sub-path, and the longest match wins, so /markaz/x/classes/y selects
 * "classes", not "markaz".
 */
export function activeNavKey(items: readonly NavItem[], pathname: string): NavKey | null {
  let best: NavItem | null = null;
  for (const item of items) {
    const matches =
      pathname === item.href || (item.key !== "home" && pathname.startsWith(`${item.href}/`));
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** The Markaz id in a /{locale}/markaz/{id}/… path, if any. */
export function tenantFromPath(pathname: string): string | null {
  const match = /^\/[^/]+\/markaz\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // malformed escape in a typed URL
  }
}

/** The navigation for the current path: that Markaz's links when the person has some there. */
export function navForPath(pathname: string, fallback: NavItem[], byTenant: Record<string, NavItem[]>): NavItem[] {
  const tenant = tenantFromPath(pathname);
  return tenant && Object.hasOwn(byTenant, tenant) ? byTenant[tenant] : fallback;
}
