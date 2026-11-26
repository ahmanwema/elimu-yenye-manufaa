"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { activeNavKey, type NavItem, type NavKey } from "@/lib/navigation";

/**
 * The desktop icon rail and the phone bottom bar (ui-plan §2). Both are plain links; the
 * items are decided server-side from the person's roles and passed in, and only the active
 * highlight is computed here.
 */
export function AppNav({
  items,
  bottomItems,
  labels,
  ariaLabel,
}: {
  items: NavItem[];
  bottomItems: NavItem[];
  labels: Record<NavKey, string>;
  ariaLabel: string;
}) {
  const pathname = usePathname() ?? "";
  const active = activeNavKey(items, pathname);

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
        <ul>{items.map((item) => link(item, "rail-link"))}</ul>
      </nav>
      <nav aria-label={ariaLabel} className="bottom-nav">
        <ul>{bottomItems.map((item) => link(item, "bottom-link"))}</ul>
      </nav>
    </>
  );
}
