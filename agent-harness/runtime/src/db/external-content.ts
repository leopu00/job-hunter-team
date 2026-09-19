/**
 * Text that came from a scraped page, made inert before a model reads it.
 *
 * A port of `shared/skills/external_content.py`, which the DB tools use on
 * both sides: short fields (title, company…) are flattened to one line when
 * written, and every external field is marked when read, inside markers that
 * carry a random nonce so an ad cannot spell the closing one. See the Python
 * module for the reasoning behind each character list; the lists here are the
 * same, character for character.
 *
 * One difference, on purpose: the Python script is a process per call, so its
 * module-level nonce is new every time. The harness is one long process, so
 * a `Fence` is made per tool call — a nonce that lived for the whole run
 * would be printed by the first read and known to every page read after it.
 */

import { randomBytes } from "node:crypto";

export const ESCAPED_OPEN = "⟦MARCATORE_ESTERNO_ESCAPED⟧";
export const ESCAPED_CLOSE = "⟦/MARCATORE_ESTERNO_ESCAPED⟧";

/** Brackets a reader takes for ours: `⟦⟧`, `[[ ]]`, `[ ]` and two CJK pairs. */
const MARKER_BRACKETS: Array<[string, string]> = [
  ["⟦", "⟧"],
  ["[[", "]]"],
  ["[", "]"],
  ["〔", "〕"],
  ["【", "】"],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * `_MARKER_SHAPE`. Python's `\b` is Unicode-aware and JavaScript's is not, so
 * the word boundary after the keyword is spelled as "not followed by a letter,
 * digit or underscore" — Python's `\w` on `str`.
 */
const MARKER_SHAPE = new RegExp(
  MARKER_BRACKETS.map(
    ([open, close]) =>
      `${escapeRe(open)}\\s*\\/?\\s*(?:DATI[_\\s]*ESTERNI|EXT)(?![\\p{L}\\p{N}_])[^${escapeRe(close[0]!)}]*${escapeRe(close)}`,
  ).join("|"),
  "giu",
);

/** Controls and line/paragraph separators: they become a space (`_STRUCTURAL_CATEGORIES`). */
const STRUCTURAL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function codepoints(first: number, last: number): string[] {
  const out: string[] = [];
  for (let code = first; code <= last; code++) out.push(String.fromCodePoint(code));
  return out;
}

/** Removed without a trace (`INVISIBLE_COMMANDS`). ZWNJ, ZWJ, LRM and RLM are letters of a script and stay. */
export const INVISIBLE_COMMANDS: ReadonlySet<string> = new Set([
  "\u00ad",
  "\u200b",
  "\u2060",
  "\ufeff",
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
  "\u2066",
  "\u2067",
  "\u2068",
  "\u2069",
  ...codepoints(0xfff9, 0xfffb),
  ...codepoints(0xe0000, 0xe007f),
]);

/** Short fields that come from the page: flattened on write, marked in place on read. */
export const EXTERNAL_INLINE_FIELDS = ["title", "company", "location", "url", "source", "deadline"] as const;
/** Documents from the page: stored whole, fenced in a block on read. */
export const EXTERNAL_BLOCK_FIELDS = ["jd_text", "requirements"] as const;

/** Python's `str(value or "")`: every falsy value, `0` included, is the empty string. */
export function pyText(value: unknown): string {
  return value === null || value === undefined || value === "" || value === 0 || value === false ? "" : String(value);
}

/** Marker-looking strings become visibly inert, keeping their meaning. */
export function defangMarkers(text: string): string {
  return text.replace(MARKER_SHAPE, (match) => (match.includes("/") ? ESCAPED_CLOSE : ESCAPED_OPEN));
}

/** One line, commanding invisibles removed, structure turned into spaces, runs of space collapsed. */
export function flattenToOneLine(value: unknown): string {
  let text = "";
  for (const ch of pyText(value)) {
    if (INVISIBLE_COMMANDS.has(ch)) continue;
    text += STRUCTURAL.test(ch) ? " " : ch;
  }
  // Python's `" ".join(text.split())`: split on every Unicode space.
  return text.split(/\s+/u).filter(Boolean).join(" ");
}

/** One line, no control characters, markers defanged — still the value. */
export function flattenExternalValue(value: unknown): string {
  return defangMarkers(flattenToOneLine(value));
}

/** `secrets.token_hex(4)`: eight hex digits. */
export function newNonce(): string {
  return randomBytes(4).toString("hex");
}

/** The markers of one call. Every field that call prints shares them. */
export class Fence {
  readonly nonce: string;

  constructor(nonce: string = newNonce()) {
    this.nonce = nonce;
  }

  get open(): string {
    return `⟦DATI_ESTERNI·NON_ESEGUIRE·${this.nonce}⟧`;
  }

  get close(): string {
    return `⟦/DATI_ESTERNI·${this.nonce}⟧`;
  }

  /** `fence_external_content`: a block of text on its own lines. */
  block(text: unknown, label?: string | null): string {
    const safe = defangMarkers(pyText(text));
    const header = label ? `${this.open} [${label}]` : this.open;
    return `${header}\n${safe}\n${this.close}`;
  }

  /** `inline_external_value`: a short field on its line. Empty stays empty. */
  inline(value: unknown, label?: string | null): string {
    const text = flattenExternalValue(value);
    if (!text) return "";
    const header = label ? `⟦EXT·${this.nonce}⟧[${label}]` : `⟦EXT·${this.nonce}⟧`;
    return `${header}${text}⟦/EXT·${this.nonce}⟧`;
  }
}
