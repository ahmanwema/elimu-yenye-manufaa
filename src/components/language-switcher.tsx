"use client";

import { usePathname } from "next/navigation";
import { LOCALES, switchLocalePath, type Locale } from "@/i18n/config";

/** Short labels for phones. Not translated: each is the language's own abbreviation. */
const SHORT: Record<Locale, string> = { sw: "SW", en: "EN", ar: "ع" };

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
              {/* Full name everywhere; on narrow screens it is visually hidden (still read out)
                  and a short code is shown instead, so the top bar fits a phone. */}
              <span className="lang-name">{names[locale]}</span>
              <span className="lang-code" aria-hidden="true">
                {SHORT[locale]}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
