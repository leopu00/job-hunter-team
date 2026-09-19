/**
 * What the Python skills print, reproduced exactly.
 *
 * A native tool replaces a `python3 shared/skills/*.py` call, and its output
 * must be the same text the TUI agent reads — the prompts quote it (`AVAILABLE`,
 * `configured=false`, `"latest_action": null`). These helpers mirror the few
 * Python behaviours that text depends on: `json.dumps` spacing and escaping,
 * `str()` of None and booleans, `datetime.now().isoformat()`, and what Python
 * calls whitespace and a word character.
 */

/**
 * Python's whitespace (`str.split()`, `str.isspace`, `\s` in a `str` regex).
 * Not JavaScript's `\s`: Python counts the separators \x1c–\x1f and \x85, and
 * does not count U+FEFF.
 */
export const PY_SPACE = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/**
 * Python's `\w` on a `str`: `isalnum()` or `_` — any letter or number, not
 * only ASCII, and no combining marks.
 */
export const PY_WORD = "\\p{L}\\p{N}_";

/** `" ".join(text.split())`. */
export function pySplitJoin(text: string): string {
  return text.split(new RegExp(`[${PY_SPACE}]+`, "u")).filter(Boolean).join(" ");
}

/** `text.rstrip()`. */
export function pyRstrip(text: string): string {
  return text.replace(new RegExp(`[${PY_SPACE}]+$`, "u"), "");
}

/** `str(value)` as `print` and f-strings render it. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

/**
 * `datetime.now().isoformat()`: local time, no zone, microseconds only when
 * there are any. JavaScript has milliseconds, so the last three digits are 0.
 */
export function pyNowIso(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const base =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  return now.getMilliseconds() === 0 ? base : `${base}.${p(now.getMilliseconds(), 3)}000`;
}

/**
 * `json.dumps(value, ensure_ascii=…, indent=…)` with Python's default
 * separators: `", "` and `": "` on one line, `","` and `": "` when indented.
 * Only the JSON types the skills print: no floats beyond what `String` renders.
 */
export function pyJson(value: unknown, options: { ensureAscii?: boolean; indent?: number } = {}): string {
  const { ensureAscii = true, indent } = options;
  const str = (s: string) => {
    let out = JSON.stringify(s);
    if (ensureAscii) {
      out = out.replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
    }
    return out;
  };
  const render = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloat(v);
    if (typeof v === "string") return str(v);
    const pad = indent === undefined ? "" : `\n${" ".repeat(indent * (depth + 1))}`;
    const close = indent === undefined ? "" : `\n${" ".repeat(indent * depth)}`;
    const sep = indent === undefined ? ", " : ",";
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return `[${v.map((item) => pad + render(item, depth + 1)).join(sep)}${close}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return "{}";
    return `{${entries.map(([k, item]) => `${pad}${str(k)}: ${render(item, depth + 1)}`).join(sep)}${close}}`;
  };
  return render(value, 0);
}

/** `repr(float)` for the values the skills produce (ratios such as 0.412). */
function pyFloat(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : n < 0 ? "-Infinity" : "NaN";
  const s = String(n);
  return /[.e]/.test(s) ? s.replace(/e([+-])(\d)$/, "e$10$2") : `${s}.0`;
}

/**
 * A tool's text from what the script would print: stdout without its last
 * newline, or "(no output)" when it printed nothing — the shell tool's own
 * words for an empty stdout, so the model reads silence the same way.
 */
export function printed(lines: string[]): string {
  const text = lines.join("\n");
  return text === "" ? "(no output)" : text;
}
