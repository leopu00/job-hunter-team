import type { Locale } from "@/i18n/config";

/**
 * A profile line the Assistant wrote as the program holds it, `work_authorization: {'region': 'EU', 'status': 'Italian citizen'}`,
 * said in words: the field's name without underscores (and in the person's language for the ones the profile has), and the
 * record as its values. Only a line that BEGINS with a snake_case name and a colon is touched, and a record that is not
 * a flat one of plain values (a list, a nested record, something unclosed) is left exactly as it came.
 */

const LABELS: Record<string, Record<Locale, string>> = {
  work_authorization: {
    en: "Work authorization",
    it: "Autorizzazione al lavoro",
    es: "Autorización de trabajo",
    fr: "Autorisation de travail",
    de: "Arbeitserlaubnis",
    hu: "Munkavállalási engedély",
    pt: "Autorização de trabalho",
  },
};

const LINE = /^(\s*(?:[-*•]\s+)?)([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(\s*:\s*)(.*)$/;
const PAIR = /\s*(?:'([A-Za-z_][\w ]{0,40})'|"([A-Za-z_][\w ]{0,40})")\s*:\s*(?:'((?:[^'\\]|\\.){0,300})'|"((?:[^"\\]|\\.){0,300})"|(None|True|False|-?\d{1,15}(?:\.\d{1,6})?))\s*(,|$)/y;

function humanName(name: string, locale: Locale): string {
  const known = Object.prototype.hasOwnProperty.call(LABELS, name) ? LABELS[name][locale] : undefined;
  if (known) return known;
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\(['"\\])/g, "$1");
}

/** `{'a': 'x', 'b': 2}` as [[a, x], [b, 2]]; null when it is anything else than a flat record of plain values. */
function flatRecord(text: string): [string, string][] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.trim() === "") return null;
  const pairs: [string, string][] = [];
  let at = 0;
  while (at < inner.length) {
    PAIR.lastIndex = at;
    const match = PAIR.exec(inner);
    if (!match) return null;
    const key = match[1] ?? match[2];
    const value = match[3] ?? match[4] ?? match[5];
    if (key === undefined || value === undefined) return null;
    pairs.push([key, match[5] !== undefined ? match[5] : unescapeQuoted(value)]);
    at = PAIR.lastIndex;
    if (match[6] === "") break;
  }
  return at >= inner.length ? pairs : null;
}

function recordInWords(name: string, pairs: [string, string][], locale: Locale): string {
  const values = new Map(pairs.map(([key, value]) => [key.trim(), value]));
  // the one the profile has: «what the person is allowed» first, where it is valid in brackets
  if (name === "work_authorization" && pairs.length === 2 && values.has("status") && values.has("region")) {
    return `${values.get("status")} (${values.get("region")})`;
  }
  return pairs.map(([key, value]) => `${humanName(key.trim().replace(/ /g, "_"), locale)}: ${value}`).join(", ");
}

export function readableRecordText(text: string, locale: Locale): string {
  if (!text.includes("_") || !text.includes(":")) return text;
  return text
    .split("\n")
    .map((line) => {
      const match = LINE.exec(line);
      if (!match) return line;
      const [, lead, name, colon, rest] = match;
      const pairs = flatRecord(rest);
      if (pairs) return `${lead}${humanName(name, locale)}: ${recordInWords(name, pairs, locale)}`;
      // a plain value: the name is put in words only for a field the profile has, never for a line of code
      return Object.prototype.hasOwnProperty.call(LABELS, name) && !rest.trim().startsWith("{")
        ? `${lead}${humanName(name, locale)}${colon.trimEnd()} ${rest}`.trimEnd()
        : line;
    })
    .join("\n");
}
