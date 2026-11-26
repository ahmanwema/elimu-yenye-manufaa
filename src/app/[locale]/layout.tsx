import type { Metadata, Viewport } from "next";
import { Inter, Lexend, Noto_Naskh_Arabic } from "next/font/google";
import { Suspense, cache } from "react";
import Image from "next/image";
import { AppNav } from "@/components/app-nav";
import { Icon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { LOCALES, localeDirection } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { getCurrentActor } from "@/server/auth";
import { buildNav, buildNavByTenant } from "@/server/navigation";
import "../globals.css";

// Typefaces (A152), self-hosted by next/font at build time. Exposed as CSS variables that
// globals.css composes into --font-latin / --font-heading / --font-arabic.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const lexend = Lexend({ subsets: ["latin"], variable: "--font-lexend", display: "swap" });
const naskh = Noto_Naskh_Arabic({ subsets: ["arabic"], variable: "--font-naskh", display: "swap" });

// One actor lookup per request for the whole shell (top bar + navigation).
const getShellActor = cache(getCurrentActor);

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
    // The owner's logo (A155). Declared here because the root layout lives under [locale], so the
    // app/icon.png file convention does not reach these pages.
    icons: { icon: [{ url: "/brand/logo-128.png", type: "image/png", sizes: "128x128" }], apple: "/icons/apple-touch-icon.png" },
    alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])) },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1521" },
  ],
};

// Root layout. lang/dir come from the [locale] segment: Kiswahili and English are LTR,
// Arabic is RTL. All layout CSS uses logical properties so it mirrors automatically.
export default async function LocaleLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className={`${inter.variable} ${lexend.variable} ${naskh.variable}`}
      // The boot script may set data-theme before React hydrates (A156).
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {dict.nav.skipToContent}
        </a>
        <header className="topbar">
          <a className="brand" href={`/${locale}`}>
            <Image className="brand-logo" src="/brand/logo-128.png" alt="" width={36} height={36} />
            <span>{dict.meta.title}</span>
          </a>
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
          <ThemeToggle toLight={dict.nav.themeLight} toDark={dict.nav.themeDark} />
          <Suspense fallback={null}>
            <TopbarAccount />
          </Suspense>
        </header>
        <div className="app-body">
          <Suspense fallback={null}>
            <ShellNav />
          </Suspense>
          <div className="content-col">
            <main id="main" className="shell">
              {children}
            </main>
            <SiteFooter locale={locale} dict={dict} />
          </div>
        </div>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

/** Signed out: a "Sign in" button. Signed in: an avatar link to the account page. */
async function TopbarAccount() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const current = await getShellActor();
  if (current.state === "signed-in") {
    return (
      <a className="avatar-link" href={`/${locale}/account`} aria-label={dict.nav.account}>
        <Icon name="account" />
      </a>
    );
  }
  if (current.state === "not-configured") return null;
  return (
    <a className="button button-primary button-sm" href={`/${locale}/sign-in`}>
      {dict.nav.signIn}
    </a>
  );
}

/** Role-aware rail (desktop) and bottom bar (phone); nothing for signed-out visitors. */
async function ShellNav() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const current = await getShellActor();
  const actor = current.state === "signed-in" ? current.actor : null;
  const items = buildNav(actor, locale);
  if (items.length === 0) return null;
  return <AppNav items={items} byTenant={buildNavByTenant(actor, locale)} labels={dict.nav.items} ariaLabel={dict.nav.main} />;
}
