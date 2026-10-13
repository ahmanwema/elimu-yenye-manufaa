import { getDictionary, getLocale } from "@/i18n/server";

export default async function HomePage() {
  const locale = await getLocale();
  const dict = await getDictionary();
  return (
    <>
      <p className="badge">{dict.home.badge}</p>
      <h1>{dict.home.title}</h1>
      <p className="muted">{dict.home.intro}</p>
      <section className="card">
        <h2>{dict.home.invitedTitle}</h2>
        <p>{dict.home.invitedBody}</p>
        <a className="button button-primary" href={`/${locale}/sign-in`}>
          {dict.nav.signIn}
        </a>
      </section>
    </>
  );
}
