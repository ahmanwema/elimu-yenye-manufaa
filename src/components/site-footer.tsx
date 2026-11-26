import { LOCALES, type Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";

/**
 * Site footer (ui-plan §4, F7). Static: no request data, so it prerenders with the layout.
 * Only pages that exist are linked (Terms and Privacy are drafts, A157).
 */
export function SiteFooter({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const f = dict.footer;
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <a className="brand" href={`/${locale}`}>
            <span className="brand-mark" aria-hidden="true" />
            <span>{dict.meta.title}</span>
          </a>
          <p className="muted">{f.tagline}</p>
          <p className="badge badge-muted">{f.earlyNote}</p>
        </div>
        <nav aria-label={f.platformHeading}>
          <h2 className="footer-heading">{f.platformHeading}</h2>
          <ul className="footer-links">
            <li>
              <a href={`/${locale}`}>{dict.nav.home}</a>
            </li>
            <li>
              <a href={`/${locale}/sign-in`}>{dict.nav.signIn}</a>
            </li>
            <li>
              <a href={`/${locale}/account`}>{dict.nav.account}</a>
            </li>
            <li>
              <a href={`/${locale}/terms`}>{dict.legal.termsTitle}</a>
            </li>
            <li>
              <a href={`/${locale}/privacy`}>{dict.legal.privacyTitle}</a>
            </li>
          </ul>
        </nav>
        <nav aria-label={f.languagesHeading}>
          <h2 className="footer-heading">{f.languagesHeading}</h2>
          <ul className="footer-links">
            {LOCALES.map((l) => (
              <li key={l}>
                <a href={`/${l}`} hrefLang={l} lang={l}>
                  {dict.languages[l]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="footer-rights muted">{f.rights}</p>
    </footer>
  );
}
