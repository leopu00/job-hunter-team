import type { Locale } from "@/i18n/config";
import { fill } from "./text-slots";

type Part = "morning" | "afternoon" | "evening";

const GREETING: Record<Locale, Record<Part, string>> = {
  it: { morning: "Buongiorno, {name}", afternoon: "Buon pomeriggio, {name}", evening: "Buonasera, {name}" },
  en: { morning: "Good morning, {name}", afternoon: "Good afternoon, {name}", evening: "Good evening, {name}" },
  hu: { morning: "Jó reggelt, {name}", afternoon: "Jó napot, {name}", evening: "Jó estét, {name}" },
  es: { morning: "Buenos días, {name}", afternoon: "Buenas tardes, {name}", evening: "Buenas noches, {name}" },
  de: { morning: "Guten Morgen, {name}", afternoon: "Guten Tag, {name}", evening: "Guten Abend, {name}" },
  fr: { morning: "Bonjour, {name}", afternoon: "Bon après-midi, {name}", evening: "Bonsoir, {name}" },
  pt: { morning: "Bom dia, {name}", afternoon: "Boa tarde, {name}", evening: "Boa noite, {name}" },
};

/** The part of the day the game's greeting uses: 5–13 morning, 13–18 afternoon, the rest evening. */
export function partOfDay(hour: number): Part {
  if (hour >= 5 && hour < 13) return "morning";
  if (hour >= 13 && hour < 18) return "afternoon";
  return "evening";
}

/**
 * What the person is called in a greeting: the first word of the name the profile holds, as letters only. A name that
 * is not one (empty, an address, numbers) is no name, and nobody is greeted by it.
 */
export function firstName(full: string | null | undefined): string | null {
  const word = (full ?? "").trim().split(/\s+/)[0] ?? "";
  const letters = word.replace(/[^\p{L}\p{M}'’-]/gu, "");
  if (!letters || letters !== word || letters.length > 24) return null;
  return letters;
}

/** «Buongiorno, Leone»; null while the name is not known. */
export function greetingText(name: string | null, hour: number, locale: Locale): string | null {
  return name ? fill(GREETING[locale][partOfDay(hour)], { name }) : null;
}

export const GREETING_TEXT = GREETING;
