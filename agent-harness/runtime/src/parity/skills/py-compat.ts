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
    if (v instanceof PyFloat) return pyFloat(v.value);
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

/**
 * A Python float. `json.dumps` prints `1.0` for it where JavaScript cannot
 * tell 1 from 1.0, so a value that is a float in the script is wrapped.
 */
export class PyFloat {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/**
 * `round(x, 3)`: the nearest multiple of 0.001, ties to even, as Python
 * does it; `toFixed` would take the larger of a tie (0.0625 → 0.063, Python
 * 0.062).
 */
export function pyRound3(x: number): number {
  const scaled = x * 1000;
  if (!Number.isInteger(scaled) && Number.isInteger(scaled * 2)) {
    const floor = Math.floor(scaled);
    return (floor % 2 === 0 ? floor : floor + 1) / 1000;
  }
  return Number(x.toFixed(3));
}

/**
 * `datetime.fromisoformat` for the timestamps the skills read — SQLite's
 * `YYYY-MM-DD HH:MM:SS`, ISO with `T`, fractions, `Z` or an offset — as
 * epoch milliseconds; a time with no zone is UTC, as the script assumes.
 * Null when Python could not read it.
 */
export function pyParseTs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0", zone] = m;
  const ms = Number((frac + "000000").slice(0, 6)) / 1000;
  let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), 0) + ms;
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (probe.getUTCMonth() !== Number(mo) - 1 || probe.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) {
    return null;
  }
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    t -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }
  return t;
}

/** `text[:n] + "…"` when longer than `n` code points, as the script's `_truncate`. */
export function pyTruncate(value: unknown, maxChars: number | null | undefined): unknown {
  if (value === null || value === undefined || maxChars === null || maxChars === undefined || maxChars <= 0) return value;
  const chars = Array.from(String(value));
  return chars.length <= maxChars ? String(value) : `${chars.slice(0, maxChars).join("")}…`;
}
