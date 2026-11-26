"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { activeNavKey, bottomNav, navForPath, type NavItem, type NavKey } from "@/lib/navigation";

/**
 * The desktop icon rail and the phone bottom bar (ui-plan §2). Both are plain links; the
 * items are decided server-side from the person's roles (one set per Markaz they belong to)
 * and passed in. Here we only pick the set for the Markaz in the URL and highlight the
 * current item.
 */
export function AppNav({
  items,
  byTenant,
  labels,
  ariaLabel,
}: {
  items: NavItem[];
  byTenant: Record<string, NavItem[]>;
  labels: Record<NavKey, string>;
  ariaLabel: string;
}) {
  const pathname = usePathname() ?? "";
  const current = navForPath(pathname, items, byTenant);
  const active = activeNavKey(current, pathname);

  const link = (item: NavItem, className: string) => (
    <li key={item.key}>
      <a href={item.href} className={className} aria-current={item.key === active ? "page" : undefined}>
        <Icon name={item.key} />
        <span>{labels[item.key]}</span>
      </a>
    </li>
  );

  return (
    <>
      <nav aria-label={ariaLabel} className="rail">
        <ul>{current.map((item) => link(item, "rail-link"))}</ul>
      </nav>
      <nav aria-label={ariaLabel} className="bottom-nav">
        <ul>{bottomNav(current).map((item) => link(item, "bottom-link"))}</ul>
      </nav>
    </>
  );
}
