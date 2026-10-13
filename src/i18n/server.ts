import { locale as rootLocale } from "next/root-params";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "./config";
import { DICTIONARIES, type Dictionary } from "./dictionaries";

// Server Components read the locale from the [locale] root segment.

export async function getLocale(): Promise<Locale> {
  const value = await rootLocale();
  if (!isLocale(value)) notFound();
  return value;
}

export async function getDictionary(): Promise<Dictionary> {
  return DICTIONARIES[await getLocale()];
}
