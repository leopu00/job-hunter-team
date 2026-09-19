/**
 * The command line of a Python skill, read the way `argparse` reads it.
 *
 * The DB tools take the words an agent would have typed after the script's
 * name — `db_query {args: ["check-url", "4381470286"]}` for
 * `python3 db_query.py check-url 4381470286` — so the skills' instructions
 * stay true word for word. This parser accepts what argparse accepts for the
 * subcommands we port: `--flag value`, `--flag=value`, a unique prefix of a
 * flag (`--stat` for `--status`), `store_true` flags, `type=int`/`float`,
 * `choices`, required flags and positionals, the last occurrence winning.
 * Errors come back as argparse's error line with exit code 2; the usage line
 * before it is shorter than argparse's, the one documented difference.
 */

import { pyInt } from "./py-format.ts";

export type ArgType = "str" | "int" | "float";

export interface OptionSpec {
  /** `--title` → `title`, `--jd-text` → `jd_text`, as argparse names the attribute. */
  flag: string;
  type?: ArgType;
  choices?: readonly string[];
  required?: boolean;
  default?: string | number | boolean | null;
  storeTrue?: boolean;
}

export interface PositionalSpec {
  name: string;
  type?: ArgType;
  optional?: boolean;
  default?: string | number | null;
}

export interface CommandSpec {
  /** `db_insert.py position`: how errors name the command. */
  prog: string;
  /**
   * `db_insert.py`: argparse reports words no subcommand wanted from the top
   * parser, under this name. Defaults to the first word of `prog`.
   */
  mainProg?: string;
  positionals?: PositionalSpec[];
  options?: OptionSpec[];
}

export type Parsed = Record<string, string | number | boolean | null>;

export class ArgvError extends Error {
  readonly exitCode = 2;
}

/** `repr(str)` as argparse prints a bad value: single quotes unless the text has one and no double quote. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}

export function destOf(flag: string): string {
  return flag.replace(/^--/, "").replaceAll("-", "_");
}

export function parseArgv(spec: CommandSpec, argv: readonly string[]): Parsed {
  const options = spec.options ?? [];
  const positionals = spec.positionals ?? [];
  const fail = (message: string, prog = spec.prog): never => {
    throw new ArgvError(`usage: ${prog} [-h] ...\n${prog}: error: ${message}`);
  };

  const out: Parsed = {};
  for (const o of options) out[destOf(o.flag)] = o.storeTrue ? (o.default ?? false) : (o.default ?? null);
  for (const p of positionals) out[p.name] = p.default ?? null;

  const seen = new Set<string>();
  const loose: string[] = [];
  const unknown: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === "--") {
      loose.push(...argv.slice(i + 1));
      break;
    }
    // A negative number is a value, not a flag, as argparse sees it when no flag looks like one.
    if (!word.startsWith("-") || word === "-" || /^-\d+(\.\d+)?$/.test(word)) {
      loose.push(word);
      continue;
    }
    if (!word.startsWith("--")) {
      unknown.push(word);
      continue;
    }
    const eq = word.indexOf("=");
    const name = eq >= 0 ? word.slice(0, eq) : word;
    const option = findOption(options, name, fail);
    if (!option) {
      unknown.push(word);
      continue;
    }
    const dest = destOf(option.flag);
    if (option.storeTrue) {
      if (eq >= 0) fail(`argument ${option.flag}: ignored explicit argument '${word.slice(eq + 1)}'`);
      out[dest] = true;
      seen.add(dest);
      continue;
    }
    let value: string;
    if (eq >= 0) {
      value = word.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-" && !/^-\d+(\.\d+)?$/.test(next))) {
        fail(`argument ${option.flag}: expected one argument`);
      }
      value = next!;
      i += 1;
    }
    out[dest] = convert(value, option.type, option.choices, `argument ${option.flag}`, fail);
    seen.add(dest);
  }

  let at = 0;
  for (const p of positionals) {
    const word = loose[at];
    if (word === undefined) {
      if (!p.optional) continue;
      break;
    }
    out[p.name] = convert(word, p.type, undefined, `argument ${p.name}`, fail);
    seen.add(p.name);
    at += 1;
  }
  const missing = [
    ...positionals.filter((p) => !p.optional && !seen.has(p.name)).map((p) => p.name),
    ...options.filter((o) => o.required && !seen.has(destOf(o.flag))).map((o) => o.flag),
  ];
  if (missing.length > 0) fail(`the following arguments are required: ${missing.join(", ")}`);
  const extra = [...loose.slice(at), ...unknown];
  if (extra.length > 0) fail(`unrecognized arguments: ${extra.join(" ")}`, spec.mainProg ?? spec.prog.split(" ")[0]);
  return out;
}

function findOption(options: OptionSpec[], name: string, fail: (m: string) => never): OptionSpec | undefined {
  const exact = options.find((o) => o.flag === name);
  if (exact) return exact;
  const prefixed = options.filter((o) => o.flag.startsWith(name));
  if (prefixed.length > 1) {
    fail(`ambiguous option: ${name} could match ${prefixed.map((o) => o.flag).join(", ")}`);
  }
  return prefixed[0];
}

function convert(
  raw: string,
  type: ArgType | undefined,
  choices: readonly string[] | undefined,
  label: string,
  fail: (m: string) => never,
): string | number {
  let value: string | number = raw;
  if (type === "int") {
    const n = pyInt(raw);
    if (n === null) fail(`${label}: invalid int value: ${pyRepr(raw)}`);
    value = n!;
  } else if (type === "float") {
    const text = raw.trim();
    const n = Number(text.replaceAll("_", ""));
    if (text === "" || Number.isNaN(n)) fail(`${label}: invalid float value: ${pyRepr(raw)}`);
    value = n;
  }
  if (choices && !choices.includes(String(value))) {
    const shown = choices.map((c) => `'${c}'`).join(", ");
    fail(`${label}: invalid choice: ${pyRepr(raw)} (choose from ${shown})`);
  }
  return value;
}
