"use client";

import { usePathname } from "next/navigation";
import { LOCALES, switchLocalePath, type Locale } from "@/i18n/config";

/**
 * Plain links to the same page in each language. Visiting a locale-prefixed page makes
 * the proxy remember that locale in a cookie, so the choice persists.
 */
export function LanguageSwitcher({
  current,
  label,
  names,
}: {
  current: Locale;
  label: string;
  names: Record<Locale, string>;
}) {
  const pathname = usePathname() ?? `/${current}`;
  return (
    <nav aria-label={label} className="language-switcher">
      <ul>
        {LOCALES.map((locale) => (
          <li key={locale}>
            <a
              href={switchLocalePath(pathname, locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? "true" : undefined}
            >
              {names[locale]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
