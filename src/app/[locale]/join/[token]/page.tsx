import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinForm } from "@/components/join-form";
import { isSupabaseConfigured } from "@/env";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
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

  return (
    <>
      <p>
        {preview.className
          ? format(dict.join.introClass, { markaz: preview.tenantName, class: preview.className })
          : format(dict.join.intro, { markaz: preview.tenantName })}
      </p>
      <p className="muted">{dict.join.paymentNote}</p>
      <JoinForm
        locale={locale}
        token={token}
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
          send: dict.join.send,
          sentBody: dict.join.sentBody,
          codeLabel: dict.join.codeLabel,
          codeHint: dict.join.codeHint,
          verify: dict.join.verify,
          loading: dict.join.loading,
          errors: {
            invalid: dict.join.invalid,
            expired: dict.join.invalid,
            rate_limited: dict.auth.errors.rate_limited,
            unavailable: dict.auth.errors.unavailable,
            invalid_input: dict.results.invalid_input,
            invalid_code: dict.auth.errors.invalid_code,
          },
        }}
      />
    </>
  );
}
