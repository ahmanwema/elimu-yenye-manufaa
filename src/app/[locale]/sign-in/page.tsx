import type { Metadata } from "next";
import { Suspense } from "react";
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
    <>
      <h1>{dict.auth.signInTitle}</h1>
      <p className="muted">{dict.auth.signInIntro}</p>
      <section className="card">
        <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
          <SignInBody searchParams={searchParams} />
        </Suspense>
      </section>
    </>
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
      <SignInForm locale={locale} next={next} strings={{ ...dict.auth, loading: dict.common.loading }} />
    </>
  );
}
