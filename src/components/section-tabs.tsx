"use client";

import { useEffect, useState } from "react";

type Tab = { id: string; label: string };

/**
 * In-page tabs (ui-plan §3) built from the page's own sections: every `section[aria-labelledby]`
 * inside `#main` becomes a link to its heading. The page decides which sections exist (and so
 * what the person may see); this only adds a jump bar and highlights the section in view.
 * Without JavaScript nothing renders and the page reads top to bottom as before.
 */
export function SectionTabs({ label }: { label: string }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("#main section[aria-labelledby]"));
    const found = sections
      .map((s) => {
        const id = s.getAttribute("aria-labelledby") ?? "";
        const heading = id ? document.getElementById(id) : null;
        return heading ? { id, label: heading.textContent?.trim() ?? "", section: s } : null;
      })
      .filter((t): t is Tab & { section: HTMLElement } => t !== null && t.label !== "");
    // Reading the rendered DOM once after mount is the point of this component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs(found.map(({ id, label: l }) => ({ id, label: l })));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.getAttribute("aria-labelledby"));
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    found.forEach((t) => observer.observe(t.section));
    return () => observer.disconnect();
  }, []);

  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="section-tabs">
      <ul className="tabs">
        {tabs.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`} aria-current={active === t.id ? "page" : undefined}>
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
