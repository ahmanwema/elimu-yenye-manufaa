import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinForm } from "@/components/join-form";
import { isSupabaseConfigured } from "@/env";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { getAuthIdentity } from "@/server/auth";
import { getDb } from "@/server/db";
import { previewJoinLink } from "@/server/services/join-links";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).join.title, robots: { index: false } };
}

export default async function JoinPage({ params }: PageProps<"/[locale]/join/[token]">) {
  const dict = await getDictionary();
  return (
    <>
      <h1>{dict.join.title}</h1>
      <section className="card">
        <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
          <JoinBody params={params} />
        </Suspense>
      </section>
    </>
  );
}

async function JoinBody({ params }: { params: PageProps<"/[locale]/join/[token]">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const { token } = await params;
  if (!isSupabaseConfigured()) return <p>{dict.common.notConfigured}</p>;

  // Unknown, cancelled, expired and full all look the same, so a stale link tells a visitor
  // nothing about whether it ever existed or how full the Markaz is.
  const preview = await previewJoinLink(getDb(), token);
  if (preview.state !== "valid") return <p>{dict.join.invalid}</p>;

  const isStudent = preview.role === "STUDENT";
  const identity = await getAuthIdentity();
  const role = dict.roles[preview.role];

  return (
    <>
      <p>
        {preview.className
          ? format(dict.join.introClass, { markaz: preview.tenantName, role, class: preview.className })
          : format(dict.join.intro, { markaz: preview.tenantName, role })}
      </p>
      {isStudent ? <p className="muted">{dict.join.paymentNote}</p> : null}
      <JoinForm
        locale={locale}
        token={token}
        isStudent={isStudent}
        signedInEmail={identity?.email ?? null}
        strings={{
          nameLabel: dict.join.nameLabel,
          phoneLabel: dict.join.phoneLabel,
          genderLabel: dict.join.genderLabel,
          genderMale: dict.join.genderMale,
          genderFemale: dict.join.genderFemale,
          dobLabel: dict.join.dobLabel,
          dobHint: dict.join.dobHint,
          emailLabel: dict.join.emailLabel,
          emailHint: dict.join.emailHint,
          passwordLabel: dict.join.passwordLabel,
          passwordHint: dict.join.passwordHint,
          passwordConfirmLabel: dict.join.passwordConfirmLabel,
          submit: dict.join.submit,
          submitSignedIn: dict.join.submitSignedIn,
          signedInAs: dict.join.signedInAs,
          haveAccount: dict.join.haveAccount,
          loading: dict.join.loading,
          errors: {
            invalid: dict.join.invalid,
            expired: dict.join.invalid,
            invalid_input: dict.results.invalid_input,
            weak_password: dict.join.errorWeakPassword,
            password_mismatch: dict.join.errorPasswordMismatch,
            email_taken: dict.join.errorEmailTaken,
            unavailable: dict.auth.errors.unavailable,
          },
        }}
      />
    </>
  );
}
