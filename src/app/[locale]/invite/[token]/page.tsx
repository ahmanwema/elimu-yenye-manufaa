import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { InviteSignIn } from "@/components/invite-sign-in";
import { isSupabaseConfigured } from "@/env";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { signOut } from "@/server/actions/auth";
import { acceptInvite } from "@/server/actions/invitations";
import { getAuthIdentity } from "@/server/auth";
import { getDb } from "@/server/db";
import { invitedEmailForToken, previewInvitation } from "@/server/services/invitations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).invite.title, robots: { index: false } };
}

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  const dict = await getDictionary();
  return (
    <>
      <h1>{dict.invite.title}</h1>
      <section className="card">
        <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
          <InviteBody params={params} />
        </Suspense>
      </section>
    </>
  );
}

async function InviteBody({ params }: { params: PageProps<"/[locale]/invite/[token]">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const { token } = await params;
  if (!isSupabaseConfigured()) return <p>{dict.common.notConfigured}</p>;

  const db = getDb();
  const preview = await previewInvitation(db, token);
  if (preview.state === "invalid") return <p>{dict.invite.invalid}</p>;
  if (preview.state === "expired") return <p>{dict.invite.expired}</p>;

  const intro = (
    <>
      <p>
        {preview.target === "PARENT"
          ? format(dict.invite.parentBody, { markaz: preview.tenantName })
          : format(dict.invite.validBody, { markaz: preview.tenantName, role: dict.roles[preview.target] })}
      </p>
      <p className="muted">{format(dict.invite.sentTo, { email: preview.maskedEmail })}</p>
    </>
  );

  const identity = await getAuthIdentity();
  if (!identity) {
    return (
      <>
        {intro}
        <p>{dict.invite.signInToAccept}</p>
        <InviteSignIn
          locale={locale}
          token={token}
          maskedEmail={preview.maskedEmail}
          strings={{
            sendCode: dict.invite.sendCode,
            sentBody: dict.invite.sentBody,
            codeLabel: dict.auth.codeLabel,
            codeHint: dict.auth.codeHint,
            verify: dict.auth.verify,
            loading: dict.common.loading,
            errors: {
              invalid: dict.invite.invalid,
              expired: dict.invite.expired,
              rate_limited: dict.auth.errors.rate_limited,
              unavailable: dict.auth.errors.unavailable,
              invalid_code: dict.auth.errors.invalid_code,
            },
          }}
        />
      </>
    );
  }

  // Compared on the server only; the full invited address never reaches the browser.
  const invitedEmail = await invitedEmailForToken(db, token);
  if (identity.email?.toLowerCase() !== invitedEmail) {
    return (
      <>
        {intro}
        <p role="alert">{dict.invite.wrongAccount}</p>
        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className="button button-secondary">
            {dict.nav.signOut}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      {intro}
      <ActionForm action={acceptInvite} submitLabel={dict.invite.accept} pendingLabel={dict.common.loading} messages={dict.results}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
      </ActionForm>
    </>
  );
}
