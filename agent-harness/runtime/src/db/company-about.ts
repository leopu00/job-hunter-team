/**
 * The two sentences on who a company is (`companies.about`), cleaned and capped before they are stored: the port of
 * `shared/skills/company_about.py` (`feedback_reasons.clean_note` + a cap). The text comes from a web page, and it
 * reaches the database, the cloud and the output of `db_query.py company` that the other agents read.
 */
import { INVISIBLE_COMMANDS } from "./external-content.ts";

export const ABOUT_MAX = 600;

const SPACES = /[\r\n\t\u2028\u2029\p{Zs}]/u;
const DROPPED = /[\p{Cc}\p{Cs}\p{Co}\p{Cn}]/u;

/** NFC, no controls, no commanding invisibles, single spaces, at most ABOUT_MAX characters; null when nothing is left. */
export function cleanAbout(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let kept = "";
  for (const ch of String(value).normalize("NFC")) {
    if (SPACES.test(ch)) kept += " ";
    else if (INVISIBLE_COMMANDS.has(ch) || DROPPED.test(ch)) continue;
    else kept += ch;
  }
  let text = kept.split(" ").filter((part) => part !== "").join(" ");
  const chars = Array.from(text);
  if (chars.length > ABOUT_MAX) text = chars.slice(0, ABOUT_MAX).join("").trimEnd();
  return text === "" ? null : text;
}
