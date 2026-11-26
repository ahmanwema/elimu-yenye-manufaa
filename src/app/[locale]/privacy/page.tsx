import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getDictionary } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).legal.privacyTitle };
}

export default async function PrivacyPage() {
  const dict = await getDictionary();
  const l = dict.legal;
  return <LegalPage title={l.privacyTitle} draftNotice={l.draftNotice} updated={l.updated} sections={l.privacy} />;
}
