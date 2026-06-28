/**
 * Reads the current locale from ~/.jht/i18n-prefs.json (server-side only)
 */
import fs from "node:fs";
import path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";

export type ServerLocale = "it" | "en" | "hu" | "es" | "de" | "fr" | "pt";

const VALID_LOCALES: ServerLocale[] = [
  "it",
  "en",
  "hu",
  "es",
  "de",
  "fr",
  "pt",
];

const PREFS_PATH = path.join(JHT_HOME, "i18n-prefs.json");

export function getServerLocale(): ServerLocale {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
    if (VALID_LOCALES.includes(raw.locale)) return raw.locale as ServerLocale;
  } catch {
    /* default */
  }
  return "it";
}
