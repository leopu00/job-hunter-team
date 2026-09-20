/**
 * `deadline_extract.py` as a native tool (T14, ANALISTA MAIN LOOP step 5).
 *
 * The same conservative parser: the first match of each pattern in the
 * Python's order — ISO date, d/m/y, "Month dd[, yyyy]", "dd Month [yyyy]",
 * "expires in N days" — kept only if it is today or later, and an empty line
 * when nothing is certain. The regexes read as Python's `str` patterns read:
 * `\d` is any Unicode decimal digit, `\s` Python's whitespace, `\b` a
 * boundary between Python word characters.
 *
 * One difference: the script reads the JD from stdin when `--jd` is missing
 * or empty; a tool has no stdin, so that case is an empty JD — an empty line.
 */

import { parseArgv } from "../../db/argv.ts";
import { PY_SPACE_CLASS, pyInt } from "../../db/py-format.ts";
import type { ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";

/** `MONTHS`, in the dict's order: the alternation tries them in this order, as Python's does. */
const MONTHS: ReadonlyArray<[string, number]> = [
  ["jan", 1], ["january", 1], ["gen", 1], ["gennaio", 1],
  ["feb", 2], ["february", 2], ["febbraio", 2],
  ["mar", 3], ["march", 3], ["marzo", 3],
  ["apr", 4], ["april", 4], ["aprile", 4],
  ["may", 5], ["maggio", 5], ["mag", 5],
  ["jun", 6], ["june", 6], ["giu", 6], ["giugno", 6],
  ["jul", 7], ["july", 7], ["lug", 7], ["luglio", 7],
  ["aug", 8], ["august", 8], ["ago", 8], ["agosto", 8],
  ["sep", 9], ["sept", 9], ["september", 9], ["set", 9], ["settembre", 9],
  ["oct", 10], ["october", 10], ["ott", 10], ["ottobre", 10],
  ["nov", 11], ["november", 11], ["novembre", 11],
  ["dec", 12], ["december", 12], ["dic", 12], ["dicembre", 12],
];
const MONTH = new Map(MONTHS);

/** Python's `\w` in a `str` pattern: letters, numbers, underscore. */
const W = String.raw`[\p{L}\p{N}_]`;
/** Python's `\b`. */
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const D = String.raw`\p{Nd}`;
const S = `[${PY_SPACE_CLASS}]`;
const ALT = MONTHS.map(([m]) => m).join("|");

const ISO = new RegExp(`${B}(${D}{4})-(${D}{2})-(${D}{2})${B}`, "u");
const NUMERIC = new RegExp(`${B}(${D}{1,2})[/\\-](${D}{1,2})[/\\-](${D}{2,4})${B}`, "u");
const MONTH_DAY = new RegExp(`${B}(${ALT})${S}+(${D}{1,2})(?:[,${PY_SPACE_CLASS}]+(${D}{4}))?${B}`, "u");
const DAY_MONTH = new RegExp(`${B}(${D}{1,2})${S}+(${ALT})(?:${S}+(${D}{4}))?${B}`, "u");
const IN_DAYS = new RegExp(`${B}(?:expires?|closes?|deadline|scade|chiude)${S}+(?:in${S}+|fra${S}+|tra${S}+|entro${S}+)?(${D}+)${S}+(?:days?|giorni)${B}`, "u");

/** A calendar day, compared and printed as `datetime.date` does. */
interface Day {
  y: number;
  m: number;
  d: number;
}

const key = (x: Day) => x.y * 10_000 + x.m * 100 + x.d;
const isoOf = (x: Day) => `${String(x.y).padStart(4, "0")}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;

/** `_iso`: a real date between years 1 and 9999, or null (`ValueError`). */
function day(y: number, m: number, d: number): Day | null {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(2000, m, 0)).getUTCDate();
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (d > (m === 2 ? (leap ? 29 : 28) : last)) return null;
  return { y, m, d };
}

/** `today + timedelta(days=n)`, and Python's OverflowError past year 9999. */
function addDays(today: Day, n: number): Day {
  const t = Date.UTC(today.y, today.m - 1, today.d) + n * 86_400_000;
  const date = new Date(t);
  if (!Number.isFinite(t) || Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999) {
    throw new Error("date value out of range");
  }
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** `parse_deadline`, with today given (the script's is the local date). */
export function parseDeadline(text: string, today: Day): string | null {
  const t = text
    .replace(new RegExp(`${S}+`, "gu"), " ")
    .replace(new RegExp(`^${S}+|${S}+$`, "gu"), "")
    .toLowerCase();
  if (!t) return null;
  const int = (s: string) => pyInt(s)!;

  let m = ISO.exec(t);
  if (m) {
    const x = day(int(m[1]!), int(m[2]!), int(m[3]!));
    if (x && key(x) >= key(today)) return isoOf(x);
  }
  m = NUMERIC.exec(t);
  if (m) {
    let y = int(m[3]!);
    if (y < 100) y += 2000;
    const x = day(y, int(m[2]!), int(m[1]!));
    if (x && key(x) >= key(today)) return isoOf(x);
  }
  for (const [re, dayGroup, monthGroup] of [[MONTH_DAY, 2, 1], [DAY_MONTH, 1, 2]] as const) {
    m = re.exec(t);
    if (!m) continue;
    const mo = MONTH.get(m[monthGroup]!)!;
    const d = int(m[dayGroup]!);
    const y = m[3] ? int(m[3]) : today.y;
    let x = day(y, mo, d);
    if (x) {
      // No year and already past this year: next year's.
      if (!m[3] && key(x) < key(today)) x = day(y + 1, mo, d);
      if (x && key(x) >= key(today)) return isoOf(x);
    }
  }
  m = IN_DAYS.exec(t);
  if (m) {
    const digits = m[1]!;
    // More days than any date holds: the Python's timedelta overflows the same way.
    if (Array.from(digits).length > 9) throw new Error("date value out of range");
    return isoOf(addDays(today, int(digits)));
  }
  return null;
}

/** The local calendar day, as `datetime.now().date()`. */
function localToday(now: Date): Day {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export function deadlineExtract(argv: string[], now: Date = new Date()): ScriptResult {
  const a = parseArgv({ prog: "deadline_extract.py", mainProg: "deadline_extract.py", options: [{ flag: "--jd" }] }, argv);
  const jd = typeof a["jd"] === "string" ? a["jd"] : "";
  return { stdout: `${parseDeadline(jd, localToday(now)) ?? ""}\n`, exitCode: 0 };
}

export function createDeadlineExtractTool(options: { now?: () => Date } = {}): ToolHandler {
  return argvTool({
    name: "deadline_extract",
    script: "deadline_extract.py",
    description: "Extract an application deadline from a JD's text (--jd \"...\"): an ISO date, or an empty line when none is certain.",
    run: (args) => deadlineExtract(args, options.now?.() ?? new Date()),
  });
}
