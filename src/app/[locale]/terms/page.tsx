import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getDictionary } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).legal.termsTitle };
}

export default async function TermsPage() {
  const dict = await getDictionary();
  const l = dict.legal;
  return <LegalPage title={l.termsTitle} draftNotice={l.draftNotice} updated={l.updated} sections={l.terms} />;
}
