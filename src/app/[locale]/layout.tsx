import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { LOCALES, localeDirection } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import "../globals.css";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: { default: dict.meta.title, template: `%s · ${dict.meta.title}` },
    description: dict.meta.description,
    applicationName: dict.meta.title,
    appleWebApp: { capable: true, title: "Elimu", statusBarStyle: "black-translucent" },
    icons: { apple: "/icons/apple-touch-icon.png" },
    alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])) },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10151b",
};

// Root layout. lang/dir come from the [locale] segment: Kiswahili and English are LTR,
// Arabic is RTL. All layout CSS uses logical properties so it mirrors automatically.
export default async function LocaleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body>
        <a className="skip-link" href="#main">
          {dict.nav.skipToContent}
        </a>
        <header className="site-header">
          <a className="brand" href={`/${locale}`}>
            {dict.meta.title}
          </a>
          <nav aria-label={dict.nav.home} className="site-nav">
            <a href={`/${locale}`}>{dict.nav.home}</a>
            <a href={`/${locale}/account`}>{dict.nav.account}</a>
          </nav>
          {/* The switcher reads the current path (request data on dynamic routes), so it
              streams in; the fallback links to each language's home page. */}
          <Suspense
            fallback={
              <nav aria-label={dict.nav.language} className="language-switcher">
                <ul>
                  {LOCALES.map((l) => (
                    <li key={l}>
                      <a href={`/${l}`} hrefLang={l} lang={l} aria-current={l === locale ? "true" : undefined}>
                        {dict.languages[l]}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            }
          >
            <LanguageSwitcher current={locale} label={dict.nav.language} names={dict.languages} />
          </Suspense>
        </header>
        <main id="main" className="shell">
          {children}
        </main>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
