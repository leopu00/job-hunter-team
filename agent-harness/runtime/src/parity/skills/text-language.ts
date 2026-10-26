/**
 * `shared/skills/text_language.py`: which language a piece of free text is written in, roughly.
 *
 * A cheap, deterministic guess (stop words plus a few letters that belong to one language), meant for a
 * WARNING and never a refusal: everything the person reads is written in the person's language
 * (RULE-T14), and the profile validator can tell when a long enough text is clearly in another one.
 * Short or mixed text gives no answer (null), so a job title or a list of tools never raises it.
 *
 * The word lists are the script's own (`text_language_words.json`, copied here; a test pins the two
 * files byte for byte), and the algorithm is the script's step for step.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";


export const TEXT_LANGUAGES = ["en", "it", "hu", "es", "de", "fr", "pt"] as const;
export type TextLanguage = (typeof TEXT_LANGUAGES)[number];

const MIN_WORDS = 8;
const MIN_SCORE = 3;
/** The winner must beat the runner-up by this factor, or the text is mixed and there is no answer. */
const MARGIN = 1.5;
/** Letters that belong to one language (among these seven) and weigh more than a stop word. */
const SIGNATURE_LETTERS: Partial<Record<TextLanguage, string>> = { hu: "őű", de: "ß", es: "ñ¿¡", pt: "ãõ", fr: "œ" };

const words = JSON.parse(readFileSync(new URL("./text-language-words.json", import.meta.url), "utf8")) as Record<string, string[]>;
const WORD_SETS = new Map<TextLanguage, Set<string>>(TEXT_LANGUAGES.map((lang) => [lang, new Set(words[lang])]));

/** The language `text` is written in, or null when it is too short or too mixed to say. */
export function guessLanguage(text: unknown): TextLanguage | null {
  if (typeof text !== "string") return null;
  const tokens = (text.match(/\p{L}+/gu) ?? []).map((w) => w.toLowerCase());
  if (tokens.length < MIN_WORDS) return null;
  const scores = new Map<TextLanguage, number>(TEXT_LANGUAGES.map((lang) => [lang, 0]));
  for (const [lang, set] of WORD_SETS) {
    let hits = 0;
    for (const token of tokens) if (set.has(token)) hits += 1;
    scores.set(lang, hits);
  }
  const lowered = text.toLowerCase();
  for (const [lang, letters] of Object.entries(SIGNATURE_LETTERS) as [TextLanguage, string][]) {
    let count = 0;
    for (const ch of lowered) if (letters.includes(ch)) count += 1;
    scores.set(lang, (scores.get(lang) ?? 0) + 3 * count);
  }
  // Python's sort is stable and descending by score: on a tie the earlier language in the list wins.
  const ranked = TEXT_LANGUAGES.map((lang, order) => ({ lang, score: scores.get(lang) ?? 0, order })).sort(
    (a, b) => b.score - a.score || a.order - b.order,
  );
  const best = ranked[0]!;
  const second = ranked[1]!;
  if (best.score < MIN_SCORE || best.score < MARGIN * second.score) return null;
  return best.lang;
}

/**
 * The person's language now, as `shared/i18n.py` resolves it: `i18n-prefs.json`, then `$JHT_LANG`, then
 * `JHT_LANG=` in `host.env`, then English. An unknown value at any step is skipped.
 */
export function userLanguage(jhtHome: string | undefined, env: Record<string, string | undefined> = process.env): TextLanguage {
  const valid = (value: unknown): TextLanguage | null =>
    typeof value === "string" && (TEXT_LANGUAGES as readonly string[]).includes(value.trim()) ? (value.trim() as TextLanguage) : null;
  const home = jhtHome ?? env["JHT_HOME"] ?? "/jht_home";
  try {
    const fromPrefs = valid((JSON.parse(readFileSync(join(home, "i18n-prefs.json"), "utf8")) as { locale?: unknown }).locale);
    if (fromPrefs) return fromPrefs;
  } catch {
    // No prefs, or unreadable: the next source.
  }
  const fromEnv = valid(env["JHT_LANG"]);
  if (fromEnv) return fromEnv;
  try {
    const line = readFileSync(join(home, "host.env"), "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("JHT_LANG="));
    const fromHost = valid(line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, ""));
    if (fromHost) return fromHost;
  } catch {
    // No host.env.
  }
  return "en";
}

const LANGUAGE_NAMES: Record<TextLanguage, string> = {
  en: "English", it: "Italian", hu: "Hungarian", es: "Spanish", de: "German", fr: "French", pt: "Portuguese",
};

/**
 * The sentence that tells an agent which language the team writes in, by name. The rule (RULE-T14) says
 * "the user's language" and the agents used to read it off the conversation, so a message in Italian or an
 * ad in Swedish moved a whole team. The same words are in `team_language_line` (shared/skills/text_language.py)
 * and `jht_team_language_line` (.launcher/spawn-lib.sh): a test holds the three together.
 */
export function teamLanguageLine(locale: string): string {
  const code: TextLanguage = (TEXT_LANGUAGES as readonly string[]).includes(locale) ? (locale as TextLanguage) : "en";
  const name = LANGUAGE_NAMES[code];
  return (
    `[TEAM-LANGUAGE] ${name} (${code}). Write in ${name} every text the user can see: chat, profile, summaries, ` +
    "notes, scores, CVs, cover letters, the dashboard, and the messages you send to other agents. Quotes from a " +
    "job ad, names and URLs stay as they are. The team's language is this one: the language of the message or " +
    "the ad you are answering never changes it."
  );
}

/** The language `text` is clearly written in when it is not `expected`, else null. */
export function wrongLanguage(text: unknown, expected: string): TextLanguage | null {
  const guess = guessLanguage(text);
  return guess !== null && guess !== expected ? guess : null;
}
