import type { Locale } from "../config";
import { ar } from "./ar";
import type { Dictionary } from "./en";
import { en } from "./en";
import { sw } from "./sw";

export type { Dictionary };

// UI strings are small, so all three are bundled server-side; nothing is shipped to the
// client except the strings a client component is explicitly given.
export const DICTIONARIES: Record<Locale, Dictionary> = { sw, en, ar };

/** Replaces {name} placeholders. Unknown placeholders are left visible, never dropped. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
