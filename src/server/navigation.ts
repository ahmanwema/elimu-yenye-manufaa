import type { Locale } from "@/i18n/config";
import type { NavItem } from "@/lib/navigation";
import { canVerifyPayment } from "@/server/authz/live-class";
import { hasActiveRole, type Actor } from "@/server/authz/policy";

// Role-aware app navigation (A153). Pure: takes the Actor, returns links. Showing a link is
// convenience only — every page still performs its own server-side authorization, so a
// hidden link never grants or denies anything.

function firstActiveTenant(actor: Actor, accepts: (tenantId: string) => boolean): string | null {
  for (const m of actor.memberships) {
    if (m.status === "ACTIVE" && accepts(m.tenantId)) return m.tenantId;
  }
  return null;
}

/** Links for a signed-in person, in display order. Signed-out visitors get none. */
export function buildNav(actor: Actor | null, locale: Locale): NavItem[] {
  if (!actor) return [];
  const base = `/${locale}`;
  const items: NavItem[] = [{ key: "home", href: base }];

  // Until a Markaz switcher exists (F5), a person in several Markaz gets the first one.
  const staffTenant = firstActiveTenant(
    actor,
    (t) => hasActiveRole(actor, t, "MARKAZ_ADMIN") || hasActiveRole(actor, t, "TEACHER"),
  );
  if (staffTenant) {
    const enc = encodeURIComponent(staffTenant);
    items.push({ key: "markaz", href: `${base}/markaz/${enc}` });
    items.push({ key: "classes", href: `${base}/markaz/${enc}/classes` });
  } else {
    // A student (F3) gets their classes too; the classes page shows them only their own.
    const studentTenant = firstActiveTenant(actor, (t) => hasActiveRole(actor, t, "STUDENT"));
    if (studentTenant) items.push({ key: "classes", href: `${base}/markaz/${encodeURIComponent(studentTenant)}/classes` });
  }

  const financeTenant = firstActiveTenant(actor, (t) => canVerifyPayment(actor, t));
  if (financeTenant) {
    items.push({ key: "payments", href: `${base}/markaz/${encodeURIComponent(financeTenant)}/finance` });
  }

  if (actor.isPlatformAdmin) items.push({ key: "platform", href: `${base}/platform` });
  items.push({ key: "account", href: `${base}/account` });
  return items;
}
