/**
 * `shared/skills/feedback_display.py`, ported: the one rule for showing
 * user-written feedback text.
 *
 * `reason` and `comment` stay raw machine input; anything that can end up in
 * a note or a message goes through here first. Infrastructure is removed —
 * paths, hosts, URLs, tokens, the JHT home — and the text is bounded to one
 * line. The patterns are Python's, with Python's idea of a word character and
 * of whitespace (`py-compat.ts`), so both runtimes print the same thing.
 */

import { PY_SPACE, PY_WORD, pyRstrip, pySplitJoin } from "./py-compat.ts";

export const DISPLAY_TEXT_MAX_CHARS = 240;

const S = `[${PY_SPACE}]`;
const NS = `[^${PY_SPACE}`; // open: callers close the class after adding their own exclusions
const W = `[${PY_WORD}]`;
/** Python's `\b` before a word character. */
const B_START = `(?<!${W})`;
/** Python's `\b` after a word character. */
const B_END = `(?!${W})`;

const re = (source: string, flags = "giu") => new RegExp(source, flags);

const AUTH_BEARER = re(`${B_START}authorization${S}*:${S}*bearer${S}+${NS},;]+`);
const BEARER = re(`${B_START}bearer${S}+${NS},;]+`);
const SECRET = re(`${B_START}(token|api[_-]?key|secret|password|credential)${B_END}["']?${S}*[:=]${S}*["']?${NS}"',;}{\\]]+`);
const URL = re(`${B_START}(?:https?|ssh)://${NS}"',;]+`);
const SSH_HOST = re(`(?<![${PY_WORD}@])[a-z0-9._-]+@[a-z0-9._-]+(?::\\p{Nd}+)?`);
const NAMED_INFRA = re(`${B_START}(host(?:name)?|session(?:_id)?)${B_END}["']?((?:${S}*(?:[:=]${S}*|${S}+)))["']?${NS}"',;}{\\]]+`);
const QUOTED_PATH = re(`(["'])(?:[a-z]:\\\\|\\\\\\\\|/)[^"'\\r\\n]+\\1`);
const WINDOWS_DRIVE = re(`(?<!${W})(?:[a-z]:\\\\)(?:[^\\\\${PY_SPACE}]+\\\\)*[^\\\\${PY_SPACE},;:!?)]*`);
const WINDOWS_UNC = re(`(?<!${W})\\\\\\\\[^\\\\${PY_SPACE}]+\\\\(?:[^\\\\${PY_SPACE}]+\\\\)*[^\\\\${PY_SPACE},;:!?)]*`, "gu");
const POSIX_PATH = re(`(?<!${W})/(?:[^/${PY_SPACE}]+/)*[^/${PY_SPACE},;:!?)]*`, "gu");
const IPV4 = re(`(?<![${PY_WORD}.])(?:\\p{Nd}{1,3}\\.){3}\\p{Nd}{1,3}(?::\\p{Nd}+)?(?![${PY_WORD}.])`, "gu");
const JHT_HOME_LITERAL = re(`(?:\\$\\{?JHT_HOME\\}?|${B_START}JHT_HOME${B_END})(?:${S}*=${S}*${NS},;]+|(?:[/\\\\]${NS},;]+)*)`);

/** `text[:n]` and `len(text)` count code points, not UTF-16 units. */
function bounded(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  if (maxChars <= 1) return "…".slice(0, maxChars);
  return `${pyRstrip(chars.slice(0, maxChars - 1).join(""))}…`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A bounded, single-line display value with infrastructure removed. `null`
 * stays `null`, so absent text and an empty string stay different.
 * `jhtHome` is the configured JHT_HOME, replaced first because it is the most
 * specific path there is.
 */
export function sanitizeFeedbackDisplay(
  value: unknown,
  options: { maxChars?: number; jhtHome?: string | undefined } = {},
): string | null {
  if (value === null || value === undefined) return null;
  let text = pySplitJoin(String(value));
  if (!text) return "";

  const home = (options.jhtHome ?? "").trim();
  if (home) text = text.replace(new RegExp(escapeRegExp(home), "giu"), "[JHT_HOME]");
  text = text.replace(JHT_HOME_LITERAL, "[JHT_HOME]");

  text = text.replace(AUTH_BEARER, "Authorization: Bearer [redacted]");
  text = text.replace(BEARER, "Bearer [redacted]");
  text = text.replace(SECRET, (_m, name: string) => `${name}=[redacted]`);
  text = text.replace(URL, "[url]");
  text = text.replace(SSH_HOST, "[host]");
  text = text.replace(IPV4, "[host]");
  text = text.replace(NAMED_INFRA, (_m, name: string, sep: string) => `${name}${sep}[redacted]`);
  text = text.replace(QUOTED_PATH, "[path]");
  text = text.replace(WINDOWS_UNC, "[path]");
  text = text.replace(WINDOWS_DRIVE, "[path]");
  text = text.replace(POSIX_PATH, "[path]");
  text = pySplitJoin(text);
  return bounded(text, Math.max(1, Math.trunc(options.maxChars ?? DISPLAY_TEXT_MAX_CHARS)));
}
