import type { Locale } from "@/i18n/config";
import { fill } from "./text-slots";

/**
 * A sentence with a count in it, in its singular and its plural form. The
 * language decides which one a number takes (Intl.PluralRules): in French 0 is
 * singular, in English it is not. A language with no plural after a number
 * (Hungarian) gives the same sentence twice.
 */
export type PluralForms = { one: string; other: string };

const TAGS: Record<Locale, string> = { it: "it-IT", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES", pt: "pt-PT", hu: "hu-HU" };

/** The form a count takes; a count that is not a number (an unknown one, "—") takes the plural. */
export function pluralForm(locale: Locale, count: number | string, forms: PluralForms): string {
  return typeof count === "number" && new Intl.PluralRules(TAGS[locale]).select(count) === "one" ? forms.one : forms.other;
}

/** The sentence for a count, its `{count}` filled (and any other slot in `values`). */
export function pluralText(locale: Locale, count: number | string, forms: PluralForms, values: Record<string, string | number> = {}): string {
  return fill(pluralForm(locale, count, forms), { count, ...values });
}
