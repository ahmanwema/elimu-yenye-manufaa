import type { Metadata } from "next";
import { Suspense } from "react";
import { PasswordSignInForm } from "@/components/password-sign-in-form";
import { AuthLayout } from "@/components/auth-layout";
import { SignInForm } from "@/components/sign-in-form";
import { isSupabaseConfigured } from "@/env";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getDictionary, getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).auth.signInTitle };
}

export default async function SignInPage({ searchParams }: PageProps<"/[locale]/sign-in">) {
  const dict = await getDictionary();
  return (
    <AuthLayout panel={dict.authPanel} title={dict.auth.signInTitle} intro={<p className="muted">{dict.auth.signInIntro}</p>}>
      <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
        <SignInBody searchParams={searchParams} />
      </Suspense>
    </AuthLayout>
  );
}

async function SignInBody({ searchParams }: { searchParams: PageProps<"/[locale]/sign-in">["searchParams"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const params = await searchParams;
  if (!isSupabaseConfigured()) return <p>{dict.common.notConfigured}</p>;

  // `next` is untrusted; only same-origin relative paths survive.
  const next = safeRedirectPath(params.next, `/${locale}/account`);
  const linkError = params.error === "link_invalid" || params.error === "unavailable" ? params.error : null;

  return (
    <>
      {linkError ? (
        <p role="alert" className="message message-error">
          {dict.auth.errors[linkError]}
        </p>
      ) : null}
      {params.joined ? (
        <p role="status" className="message">
          {dict.auth.joinedNotice}
        </p>
      ) : null}

      <h2 className="visually-hidden">{dict.auth.passwordHeading}</h2>
      <PasswordSignInForm
        locale={locale}
        next={next}
        strings={{
          emailLabel: dict.auth.emailLabel,
          passwordLabel: dict.auth.passwordLabel,
          submit: dict.auth.passwordSubmit,
          showPassword: dict.auth.showPassword,
          hidePassword: dict.auth.hidePassword,
          loading: dict.common.loading,
          errors: {
            invalid_credentials: dict.auth.errors.invalid_credentials,
            rate_limited: dict.auth.errors.rate_limited,
            unavailable: dict.auth.errors.unavailable,
          },
        }}
      />

      {/* The emailed-code route stays available (A149), folded below the primary password form. */}
      <details className="auth-alt">
        <summary>{dict.auth.orCodeHeading}</summary>
        <SignInForm locale={locale} next={next} strings={{ ...dict.auth, loading: dict.common.loading }} />
      </details>
    </>
  );
}
