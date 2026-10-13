import type { Metadata } from "next";
import { getDictionary } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).offline.title };
}

// Static page, precached by the service worker in all three languages. Never contains user data.
export default async function OfflinePage() {
  const dict = await getDictionary();
  return (
    <>
      <h1>{dict.offline.title}</h1>
      <p className="muted">{dict.offline.body}</p>
    </>
  );
}
