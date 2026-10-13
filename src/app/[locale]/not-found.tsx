import { getDictionary, getLocale } from "@/i18n/server";

export default async function NotFound() {
  const locale = await getLocale();
  const dict = await getDictionary();
  return (
    <>
      <h1>{dict.notFound.title}</h1>
      <p className="muted">{dict.notFound.body}</p>
      <a href={`/${locale}`}>{dict.notFound.home}</a>
    </>
  );
}
