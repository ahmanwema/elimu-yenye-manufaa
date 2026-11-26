import type { Locale } from "@/i18n/config";
import type { NavItem } from "@/lib/navigation";
import { canVerifyPayment } from "@/server/authz/live-class";
import { hasActiveRole, type Actor } from "@/server/authz/policy";

// Role-aware app navigation (A153). Pure: takes the Actor, returns links. Showing a link is
// convenience only — every page still performs its own server-side authorization, so a
// hidden link never grants or denies anything.

function firstActiveTenant(actor: Actor, accepts: (tenantId: string) => boolean, preferred?: string): string | null {
  if (preferred && actor.memberships.some((m) => m.tenantId === preferred && m.status === "ACTIVE") && accepts(preferred)) return preferred;
  for (const m of actor.memberships) {
    if (m.status === "ACTIVE" && accepts(m.tenantId)) return m.tenantId;
  }
  return null;
}

/**
 * Links for a signed-in person, in display order. Signed-out visitors get none. `preferredTenant`
 * (the Markaz in the current URL) wins over the first membership when the person qualifies there.
 */
export function buildNav(actor: Actor | null, locale: Locale, preferredTenant?: string): NavItem[] {
  if (!actor) return [];
  const base = `/${locale}`;
  const items: NavItem[] = [{ key: "home", href: base }];

  // A person in several Markaz: the one in the URL when given (buildNavByTenant), else the first.
  const staffTenant = firstActiveTenant(
    actor,
    (t) => hasActiveRole(actor, t, "MARKAZ_ADMIN") || hasActiveRole(actor, t, "TEACHER"),
    preferredTenant,
  );
  if (staffTenant) {
    const enc = encodeURIComponent(staffTenant);
    items.push({ key: "markaz", href: `${base}/markaz/${enc}` });
    items.push({ key: "classes", href: `${base}/markaz/${enc}/classes` });
  } else {
    // A student (F3) gets their classes too; the classes page shows them only their own.
    const studentTenant = firstActiveTenant(actor, (t) => hasActiveRole(actor, t, "STUDENT"), preferredTenant);
    if (studentTenant) items.push({ key: "classes", href: `${base}/markaz/${encodeURIComponent(studentTenant)}/classes` });
  }

  const financeTenant = firstActiveTenant(actor, (t) => canVerifyPayment(actor, t), preferredTenant);
  if (financeTenant) {
    items.push({ key: "payments", href: `${base}/markaz/${encodeURIComponent(financeTenant)}/finance` });
  }

  if (actor.isPlatformAdmin) items.push({ key: "platform", href: `${base}/platform` });
  items.push({ key: "account", href: `${base}/account` });
  return items;
}

/** One navigation per Markaz the person belongs to, so the bar follows the Markaz in the URL (F5). */
export function buildNavByTenant(actor: Actor | null, locale: Locale): Record<string, NavItem[]> {
  if (!actor) return {};
  const ids = [...new Set(actor.memberships.filter((m) => m.status === "ACTIVE").map((m) => m.tenantId))];
  return Object.fromEntries(ids.map((id) => [id, buildNav(actor, locale, id)]));
}
