/**
 * How Python writes values, for tools whose output must be the Python's.
 *
 * The DB tools answer with what `db_query.py` & co. print, and Python prints a
 * float as `45.0`, `None` for NULL, `json.dumps` with spaces after `,` and
 * `:`, `isoformat()` with microseconds. Each function here is one of those
 * rules, checked against Python in `tests/db-py-format.test.ts`.
 */

/** Python's `str.isspace()` set: JavaScript's `\s` lacks U+001C-U+001F and U+0085 and adds U+FEFF. */
export const PY_SPACE_CLASS = "\\t\\n\\v\\f\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const LEADING = new RegExp(`^[${PY_SPACE_CLASS}]+`, "u");
const TRAILING = new RegExp(`[${PY_SPACE_CLASS}]+$`, "u");

/** `str.strip()`. */
export function pyStrip(text: string): string {
  return text.replace(LEADING, "").replace(TRAILING, "");
}

/** `float.__repr__`: shortest round-trip digits, `.0` when integral, exponent form below 1e-4 and from 1e16. */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  // toExponential() without an argument gives the shortest digits that round-trip, as repr does.
  const [mantissa, exponent] = Math.abs(x).toExponential().split("e") as [string, string];
  const digits = mantissa.replace(".", "");
  const exp = Number(exponent);
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const whole = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
      return `${sign}${whole}.${digits.slice(exp + 1) || "0"}`;
    }
    return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
  }
  const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${head}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** SQLite's rule for a declared type: REAL affinity when it names REAL, FLOA or DOUB and no INT. */
export function isRealDecl(declared: string | null | undefined): boolean {
  const t = (declared ?? "").toUpperCase();
  return !t.includes("INT") && (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB"));
}

/**
 * `str(value)` of what `sqlite3` returns for a column: `None`, an int, a
 * float in repr, the text, `b'…'` for a blob. node:sqlite gives a number for
 * both INTEGER and REAL, so the column's declared type tells them apart; a
 * non-integral number is a float whatever the column says.
 */
export function pyStr(value: unknown, declared?: string | null): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return isRealDecl(declared) || !Number.isInteger(value) ? pyFloatRepr(value) : String(value);
  if (value instanceof Uint8Array) return pyBytesRepr(value);
  return String(value);
}

/** Python truthiness of a column value: None, 0, 0.0 and '' are false. */
export function pyTruthy(value: unknown): boolean {
  return !(value === null || value === undefined || value === 0 || value === "" || value === 0n || value === false);
}

/** `repr(bytes)`. */
export function pyBytesRepr(bytes: Uint8Array): string {
  const hasSingle = bytes.includes(0x27);
  const quote = hasSingle && !bytes.includes(0x22) ? '"' : "'";
  let out = "";
  for (const b of bytes) {
    if (b === 0x5c) out += "\\\\";
    else if (b === 0x09) out += "\\t";
    else if (b === 0x0a) out += "\\n";
    else if (b === 0x0d) out += "\\r";
    else if (quote === "'" && b === 0x27) out += "\\'";
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, "0")}`;
  }
  return `b${quote}${out}${quote}`;
}

/** A value in `json.dumps`, where a REAL column's number is a float. */
export type JsonCell = { value: unknown; declared?: string | null };

/**
 * `json.dumps(value)` with Python's separators (`", "`, `": "`). `ensureAscii`
 * escapes everything outside space..tilde as `\uXXXX`, DEL included, as the
 * default does; `db_query.py` passes `ensure_ascii=False`. Numbers from a
 * REAL column are written as Python floats (`45.0`, `Infinity`); a blob as
 * `default=str` writes it.
 */
export function pyJson(value: unknown, options: { ensureAscii?: boolean } = {}): string {
  const ensureAscii = options.ensureAscii ?? true;
  const cell = (v: unknown, declared?: string | null): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
      return isRealDecl(declared) || !Number.isInteger(v) ? pyFloatRepr(v) : String(v);
    }
    if (v instanceof Uint8Array) return str(pyBytesRepr(v));
    if (typeof v === "string") return str(v);
    if (Array.isArray(v)) return `[${v.map((x) => cell(x)).join(", ")}]`;
    if (isCell(v)) return cell(v.value, v.declared);
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${str(k)}: ${cell(x)}`)
      .join(", ")}}`;
  };
  const str = (s: string): string => {
    const json = JSON.stringify(s);
    return ensureAscii ? json.replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`) : json;
  };
  return cell(value);
}

function isCell(v: unknown): v is JsonCell {
  return typeof v === "object" && v !== null && "value" in v && Object.keys(v).every((k) => k === "value" || k === "declared");
}

/** `datetime.now(timezone.utc).isoformat()`: six-digit microseconds, omitted when zero, and `+00:00`. */
export function pythonIsoUtc(date: Date): string {
  const base = date.toISOString().slice(0, 19);
  const ms = date.getUTCMilliseconds();
  return ms === 0 ? `${base}+00:00` : `${base}.${String(ms).padStart(3, "0")}000+00:00`;
}

/** The spaces `int()` skips around a number: `str.isspace()` except U+001C-U+001F (measured). */
const INT_SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const INT_TRIM = new RegExp(`^[${INT_SPACE}]+|[${INT_SPACE}]+$`, "gu");

/**
 * Python's `int(str)` as argparse's `type=int` uses it: surrounding
 * whitespace, a sign, underscores between digits, and any Unicode decimal
 * digit. Null when Python would raise ValueError.
 */
export function pyInt(raw: string): number | null {
  const text = raw.replace(INT_TRIM, "");
  if (!/^[+-]?\p{Nd}+(?:_\p{Nd}+)*$/u.test(text)) return null;
  let out = "";
  for (const ch of text) {
    if (ch === "_") continue;
    if (ch === "+" || ch === "-") {
      out += ch;
      continue;
    }
    out += String(digitValue(ch.codePointAt(0)!));
  }
  return Number(out);
}

/** `float(str)`'s digits: Unicode decimal digits, one underscore allowed between two of them. */
const PY_DIGITS = String.raw`\p{Nd}(?:_?\p{Nd})*`;
const PY_FLOAT = new RegExp(String.raw`^[+-]?(?:(?:${PY_DIGITS}(?:\.(?:${PY_DIGITS})?)?|\.${PY_DIGITS})(?:[eE][+-]?${PY_DIGITS})?|inf(?:inity)?|nan)$`, "iu");

/**
 * Python's `float(str)` as argparse's `type=float` uses it: surrounding
 * whitespace, `inf`/`infinity`/`nan` in any case, underscores between digits,
 * any Unicode decimal digit; no hex, no `Infinity` spelled JavaScript's way
 * only. Null when Python would raise ValueError.
 */
export function pyFloat(raw: string): number | null {
  const text = raw.replace(INT_TRIM, "");
  if (!PY_FLOAT.test(text)) return null;
  const ascii = Array.from(text, (ch) => (/\p{Nd}/u.test(ch) ? String(digitValue(ch.codePointAt(0)!)) : ch))
    .join("")
    .replaceAll("_", "")
    .toLowerCase();
  const sign = ascii.startsWith("-") ? -1 : 1;
  const body = ascii.replace(/^[+-]/, "");
  if (body.startsWith("inf")) return sign * Infinity;
  if (body === "nan") return NaN;
  return sign * Number(body);
}

/**
 * The value of a Unicode decimal digit. The standard encodes each set of
 * decimal digits as a contiguous run starting at zero, and runs that touch
 * are whole tens, so the value is the distance from the run's start, mod 10.
 */
function digitValue(cp: number): number {
  let start = cp;
  while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1)) && cp - start < 60) start -= 1;
  return (cp - start) % 10;
}

/** `interpret_escapes` of `db_update.py`: `\n \t \r`, then `\UXXXXXXXX`, then `\uXXXX`; surrogates and out-of-range stay literal. */
export function interpretEscapes(text: string): string {
  const chr = (whole: string, hex: string) => {
    const cp = parseInt(hex, 16);
    return (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff ? whole : String.fromCodePoint(cp);
  };
  return text
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll("\\r", "\r")
    .replace(/\\U([0-9A-Fa-f]{8})/g, chr)
    .replace(/\\u([0-9A-Fa-f]{4})/g, chr);
}

/** `s[:n]` and `f"{s:<n}"`/`f"{s:>n}"`: counted in code points, as Python's `str` is. */
export function pySlice(text: string, start: number, end?: number): string {
  return Array.from(text).slice(start, end).join("");
}

export function pyPad(text: string, width: number, align: "<" | ">"): string {
  const pad = Math.max(0, width - Array.from(text).length);
  return align === "<" ? text + " ".repeat(pad) : " ".repeat(pad) + text;
}

/**
 * `f"{x:.{digits}f}"`: the double's exact decimal value rounded half to even,
 * as Python formats it. `toFixed` rounds the tie up (3.25 → "3.3", Python
 * "3.2"), so the digits are computed here: a finite double is m·2^e, which
 * is m·5^-e / 10^-e when e < 0 — an exact decimal to round by hand.
 */
export function pyFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const negative = bits >> 63n === 1n;
  const rawExp = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = rawExp === 0 ? fraction : fraction | (1n << 52n);
  const exp = (rawExp === 0 ? 1 : rawExp) - 1075;
  // The value as an integer `scaled` over 10^places.
  let scaled: bigint;
  let places: number;
  if (exp >= 0) {
    scaled = mantissa << BigInt(exp);
    places = 0;
  } else {
    scaled = mantissa * 5n ** BigInt(-exp);
    places = -exp;
  }
  let kept: bigint;
  if (places <= digits) {
    kept = scaled * 10n ** BigInt(digits - places);
  } else {
    const divisor = 10n ** BigInt(places - digits);
    kept = scaled / divisor;
    const rest = scaled % divisor;
    const twice = rest * 2n;
    if (twice > divisor || (twice === divisor && kept % 2n === 1n)) kept += 1n;
  }
  const text = kept.toString().padStart(digits + 1, "0");
  const body = digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return negative ? `-${body}` : body;
}
