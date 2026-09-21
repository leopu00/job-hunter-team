/**
 * The CLOSER's two read-and-remember scripts as native tools (T39, piece two):
 * the read side of `apply_gate.py` and `application_answers.py` without the
 * subcommands that reach the person.
 *
 * The CLOSER is the only role that acts outward, and in this harness it
 * cannot: there is no browser and no mail server, so nothing it does leaves
 * the box (T39, piece one). What is left of its job here is exactly what these
 * two scripts do on the box before a send — read the queue the person
 * authorised, and keep the answers it works out — and they port as they are:
 * same words in, same bytes out, same exit code.
 *
 * **`apply_gate`: `consent`, `position <id>`, `queue`.** Fail closed, as the
 * script is: a config that is missing, unreadable or malformed, a consent that
 * is absent or off, a rule file that cannot be read — every one of them says
 * NO with a stable `reason`, and a queue that cannot be read is never an empty
 * one (CL-04). The two library calls on the send path, `reserve_daily_slot`
 * and `release_daily_slot`, are not here: they exist to take a slot of the
 * daily cap an instant before an irreversible send (CL-06), and here there is
 * no send to take it for. Nothing in this file writes `applied` (CL-02).
 *
 * **`application_answers`: `essentials`, `list`, `save`.** `save` is the one
 * write the CLOSER has (closer.md, "You write: only the answers you worked
 * out"), with the script's own guard in the statement: an answer the CLOSER
 * worked out never replaces one the person gave (`user_answer_kept`, CL-01).
 * `ask`, `essentials --ask` and `wake-idle-closer` are refused with the
 * reason: the first two send a question on Telegram and rely on the reply
 * coming back and being resolved into an answer — neither half exists here —
 * and the third types into a tmux pane.
 *
 * Neither tool takes a path from the model. The database is the runtime's
 * (`jobsDb`), the consent is the person's config under their JHT home, the
 * profile is the runtime's profile folder: `--db`, `--config` and `--profile`
 * are refused, not ignored.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ArgvError, parseArgv, pyRepr, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { pyFloatRepr, pyJson, pyStrip } from "../../db/py-format.ts";
import type { ScriptResult } from "../../db/tools.ts";
import { isInside, realPath } from "../../tools/paths.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";
import { analyze } from "./pdf-layout.ts";
import { PyFloat, pyParseTs } from "./py-compat.ts";
import { pySafeLoad } from "./profile-gate.ts";

export interface CloserOptions {
  /** The team's database, opened by the runtime. */
  db: () => Database;
  /**
   * `$JHT_HOME`: where the person's `jht.config.json` is (the general
   * consent), where the send flow leaves its checkpoints, and what a relative
   * CV path is relative to — as the scripts read it.
   */
  jhtHome: string;
  /** The person's profile folder: `candidate_profile.yml` is read for the essential facts. */
  profileDir: string;
  /**
   * `apply-request-rule.json`. Default: the copy shipped beside this file,
   * because the image carries no `shared/` (the copy is held byte for byte
   * against the original by a test, like the PDF layout CSS).
   */
  rulePath?: string;
  /**
   * Why a CV must not go out, or `""` (`cv_layout_hold`): the runtime passes
   * `createCvLayoutHold()`, which measures the PDF with poppler where the box
   * has it. The default answers `cv_pdf_check_unavailable` for every CV — an
   * unmeasured CV is not a pass — so a gate built without a check can never
   * wave one through.
   *
   * `cv_pdf_layout_bad` holds the position and does nothing else. On the box
   * the script also asks the Scrittore for the CV again (`_request_cv_rework`,
   * `application_rework.py`) and renders a PNG of page 1 beside the
   * checkpoint (`refresh_cv_preview`): two WRITES, and this gate is read-only
   * — the CAPITANO reads it too, to decide whether a CLOSER is worth spawning.
   * Neither is ported; a bad CV waits in `held` until someone renders it
   * again, and the verdict, remembered by content, lifts by itself then.
   * Whether the rework request belongs here is a decision for the team, not
   * something to slip into a read.
   */
  cvLayout?: (cv: string) => "" | "cv_pdf_layout_bad" | "cv_pdf_check_unavailable";
  /**
   * The folders a CV named by the database may be read from, symlinks
   * resolved: the team's home and its deliverables. Default: the JHT home.
   * A path outside them is held as `cv_pdf_path_outside` and never opened —
   * see `resolveFile`.
   */
  cvRoots?: readonly string[];
  now?: () => Date;
}

const RULE_COPY = fileURLToPath(new URL("./apply-request-rule.json", import.meta.url));

// ── Python's values, as the scripts print them ───────────────────────────

/**
 * `json.loads`: like `JSON.parse`, except that a float stays a float. The
 * gate refuses `"max_per_day": 2.0` (not an int) and repr()s a bad value into
 * its context; `JSON.parse` gives 2 for both spellings, so a number written
 * with a dot or an exponent comes back as a `PyFloat`.
 *
 * Known difference: Python also reads `NaN`, `Infinity` and `-Infinity`,
 * which `JSON.parse` rejects. A config spelled that way is `config_malformed`
 * here and `consent_cap_invalid` (or similar) there — closed on both sides.
 */
function pyJsonLoads(text: string): unknown {
  const reviver = (_key: string, value: unknown, context?: { source?: string }): unknown =>
    typeof value === "number" && context?.source !== undefined && /[.eE]/.test(context.source) ? new PyFloat(value) : value;
  return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);
}

type Dict = Record<string, unknown>;

/** A Python `dict` as `json.loads` or `yaml.safe_load` builds it. */
function isDict(value: unknown): value is Dict {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof PyFloat) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

function get(dict: Dict, key: string): unknown {
  return Object.hasOwn(dict, key) ? dict[key] : undefined;
}

/** `str.isprintable()` is false for these: repr escapes them. */
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** `repr(str)`, the non-printable characters escaped as Python escapes them. */
function reprStr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && NON_PRINTABLE.test(ch)) {
      out += cp < 0x100 ? `\\x${cp.toString(16).padStart(2, "0")}` : cp < 0x10000 ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\U${cp.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return `${quote}${out}${quote}`;
}

/** `repr()` of a value `json.loads` returned: what the gate puts in a refusal's context. */
function pyReprValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return reprStr(value);
  if (Array.isArray(value)) return `[${value.map(pyReprValue).join(", ")}]`;
  return `{${Object.entries(value as Dict)
    .map(([k, v]) => `${reprStr(k)}: ${pyReprValue(v)}`)
    .join(", ")}}`;
}

/** `str()` of a value as an f-string prints it. */
function pyStrValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value) || isDict(value)) return pyReprValue(value);
  return String(value);
}

/** Python truthiness. */
function truthy(value: unknown): boolean {
  if (value instanceof PyFloat) return value.value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isDict(value)) return Object.keys(value).length > 0;
  return !(value === null || value === undefined || value === false || value === 0 || value === 0n || value === "");
}

/** `json.dumps(value, ensure_ascii=False, sort_keys=True)`, what application_answers.py prints. */
function sortedJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isDict(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return pyJson(sort(value), { ensureAscii: false });
}

/**
 * `pathlib.Path(text)` as `str()` gives it back: repeated slashes and `.`
 * segments gone, `..` kept, exactly two leading slashes kept.
 */
function pyPath(...parts: string[]): string {
  let out = "";
  for (const part of parts) {
    if (part.startsWith("/")) out = part;
    else if (part !== "") out = out === "" ? part : `${out}/${part}`;
  }
  const lead = out.startsWith("//") && !out.startsWith("///") ? "//" : out.startsWith("/") ? "/" : "";
  const body = out
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .join("/");
  return lead + body || ".";
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The `OSError` a failed read raises, as `f"{type(err).__name__}: {err}"` prints it. */
const OS_ERRORS: Readonly<Record<string, [string, number, string]>> = {
  ENOENT: ["FileNotFoundError", 2, "No such file or directory"],
  EACCES: ["PermissionError", 13, "Permission denied"],
  EISDIR: ["IsADirectoryError", 21, "Is a directory"],
  ENOTDIR: ["NotADirectoryError", 20, "Not a directory"],
};

function pyOsError(error: unknown, path: string): { name: string; text: string } {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  const known = OS_ERRORS[code];
  if (known) return { name: known[0], text: `[Errno ${known[1]}] ${known[2]}: ${reprStr(path)}` };
  return { name: "OSError", text: (error as Error).message };
}

/** `Path.read_text(encoding="utf-8")`: a byte sequence that is not UTF-8 is a `UnicodeDecodeError`, a ValueError. */
class UnicodeDecodeError extends Error {
  override name = "UnicodeDecodeError";
}

function readUtf8(path: string): string {
  const bytes = readFileSync(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new UnicodeDecodeError(`'utf-8' codec can't decode the bytes of ${path}`);
  }
}

/**
 * `datetime.fromisoformat` as `_parse_instant` uses it: ISO or SQLite's
 * `YYYY-MM-DD HH:MM:SS`, a time with no zone read as UTC. Null when it is not
 * one — and a hold that cannot compare its instants holds.
 */
function parseInstant(value: unknown): number | null {
  if (!truthy(value)) return null;
  return pyParseTs(pyStrValue(value));
}

// ── The rule: who may authorise what, one file for two languages ────────

interface Rule {
  authorisable: string | null;
  postSubmission: readonly string[];
  userOrigins: readonly string[];
  /** `RULE_ERROR`: empty when the three vocabularies were read. */
  error: string;
  automated: readonly string[];
  /** `AUTOMATED_RULE_ERROR`. */
  automatedError: string;
}

/** `tuple(x)` of what `json.loads` returned: a string is its characters, a dict its keys. */
function pyTuple(value: unknown): unknown[] {
  if (typeof value === "string") return Array.from(value);
  if (Array.isArray(value)) return value;
  if (isDict(value)) return Object.keys(value);
  throw Object.assign(new Error(`'${pyTypeName(value)}' object is not iterable`), { pyName: "TypeError" });
}

function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (typeof value === "boolean") return "bool";
  if (value instanceof PyFloat) return "float";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  if (Array.isArray(value)) return "list";
  return "dict";
}

/** `data["k"]` on what `json.loads` returned: a KeyError, or a TypeError when it is not a dict. */
function subscript(data: unknown, key: string): unknown {
  if (!isDict(data)) {
    const why = Array.isArray(data) ? "list indices must be integers or slices, not str" : `'${pyTypeName(data)}' object is not subscriptable`;
    throw Object.assign(new Error(why), { pyName: "TypeError" });
  }
  if (!Object.hasOwn(data, key)) throw Object.assign(new Error(reprStr(key)), { pyName: "KeyError" });
  return data[key];
}

const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * `_load_rule` and `_load_automated_channels`. Fail closed like the script:
 * an absent or broken file leaves every vocabulary EMPTY — no status can be
 * authorised, no channel is a person's — and the reason says so instead of
 * looking like a flag turned off.
 */
function loadRule(path: string): Rule {
  let data: unknown;
  let readError = "";
  try {
    const text = readUtf8(path);
    try {
      data = JSON.parse(text);
    } catch (error) {
      readError = `JSONDecodeError: ${(error as Error).message}`;
    }
  } catch (error) {
    if (error instanceof UnicodeDecodeError) readError = `UnicodeDecodeError: ${error.message}`;
    else {
      const os = pyOsError(error, path);
      readError = `${os.name}: ${os.text}`;
    }
  }
  const described = (error: unknown) => `${(error as { pyName?: string }).pyName ?? "ValueError"}: ${(error as Error).message}`;
  const rule: Rule = { authorisable: null, postSubmission: [], userOrigins: [], error: readError, automated: [], automatedError: readError };
  if (readError) return rule;
  try {
    const status = subscript(data, "authorisable_status");
    const states = pyTuple(subscript(data, "post_submission_states"));
    const origins = pyTuple(subscript(data, "user_request_origins"));
    if (!(nonEmptyStr(status) && states.length > 0 && origins.length > 0 && [...states, ...origins].every(nonEmptyStr))) {
      throw new Error("empty or non-string vocabulary");
    }
    rule.authorisable = status;
    rule.postSubmission = states as string[];
    rule.userOrigins = origins as string[];
  } catch (error) {
    rule.error = described(error);
  }
  try {
    const channels = pyTuple(subscript(data, "automated_applied_via"));
    if (channels.length === 0 || !channels.every(nonEmptyStr)) throw new Error("empty or non-string vocabulary");
    rule.automated = channels as string[];
  } catch (error) {
    rule.automatedError = described(error);
  }
  return rule;
}

// ── apply_gate: the verdicts ─────────────────────────────────────────────

/** The two modes the CLOSER can run in; anything else is refused, not guessed. */
export const AUTO_APPLY_MODES = ["authorised", "dry_run"] as const;
const HELD_CHECKPOINT_STATES = ["blocked_human", "dry_run"];
const RETRY_LATER_STATE = "retry_later";
const EMAIL_UNRESOLVED_STATES = ["send_started", "send_outcome_unknown", "receipt_incomplete"];
const EMAIL_HELD_STATES = ["blocked_human", "denied"];
const CV_LAYOUT_REASONS = ["cv_pdf_layout_bad", "cv_pdf_check_unavailable"];

/** `Verdict`: the outcome of a gate, with the WHY attached. `reason` is the stable token. */
export interface Verdict {
  allowed: boolean;
  reason: string;
  detail: string;
  context: Dict;
}

const verdict = (allowed: boolean, reason: string, detail: string, context: Dict = {}): Verdict => ({ allowed, reason, detail, context });

/** `Verdict.log_line`: a refusal MUST leave one. */
function logLine(v: Verdict): string {
  const extra = Object.keys(v.context)
    .sort()
    .map((k) => `${k}=${pyStrValue(v.context[k])}`)
    .join(" ");
  return `[apply-gate] ${v.allowed ? "ALLOW" : "DENY"} ${v.reason} — ${v.detail}${extra ? ` (${extra})` : ""}`;
}

function configPath(options: CloserOptions): string {
  return pyPath(options.jhtHome, "jht.config.json");
}

/**
 * `_load_config`: the data, or why there is none. Missing and unreadable are
 * different faults — the second is something to repair — but both close.
 */
function loadConfig(path: string): { data: Dict | null; failure: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { data: null, failure: (error as NodeJS.ErrnoException).code === "ENOENT" ? "config_missing" : "config_unreadable" };
  }
  let data: unknown;
  try {
    data = pyJsonLoads(raw);
  } catch {
    return { data: null, failure: "config_malformed" };
  }
  return isDict(data) ? { data, failure: "" } : { data: null, failure: "config_malformed" };
}

/**
 * `consent_verdict`: the person's general consent, there or not. `enabled`
 * must be the boolean true — a consent read out of `"yes"` or `1` is not a
 * consent — and a mode or a cap the gate does not recognise is a refusal.
 */
export function consentVerdict(options: CloserOptions): Verdict {
  const path = configPath(options);
  const { data: config, failure } = loadConfig(path);
  if (config === null) return verdict(false, failure, "user config not readable: no consent can be established", { path });
  const apps = get(config, "applications");
  if (!isDict(apps)) return verdict(false, "consent_absent", "no `applications` block in the user config: auto-apply is off");
  const auto = get(apps, "auto_apply");
  if (!isDict(auto)) return verdict(false, "consent_absent", "no `applications.auto_apply` block in the user config: auto-apply is off");
  const enabled = get(auto, "enabled");
  if (enabled !== true) {
    return verdict(false, "consent_disabled", "`applications.auto_apply.enabled` is not true: the user has not consented", { enabled: pyReprValue(enabled) });
  }
  const mode = Object.hasOwn(auto, "mode") ? auto["mode"] : "authorised";
  if (typeof mode !== "string" || !(AUTO_APPLY_MODES as readonly string[]).includes(mode)) {
    return verdict(
      false,
      "consent_mode_unknown",
      `\`applications.auto_apply.mode\` is not one of ${AUTO_APPLY_MODES.join("/")}: refusing rather than guessing what the user meant`,
      { mode: pyReprValue(mode) },
    );
  }
  // Absent or null is no cap. Anything else must be a positive int: not a bool,
  // not 2.0, not a string, not 0 (CL-06).
  const cap = Object.hasOwn(auto, "max_per_day") ? auto["max_per_day"] : null;
  if (cap !== null && !(typeof cap === "number" && Number.isInteger(cap) && cap >= 1)) {
    return verdict(
      false,
      "consent_cap_invalid",
      "`applications.auto_apply.max_per_day` is neither absent/null (no cap) nor a positive integer: refusing rather than guessing the cap",
      { max_per_day: pyReprValue(cap) },
    );
  }
  return verdict(true, "consent_granted", "the user consented to auto-apply", { mode, max_per_day: cap });
}

interface PositionRow {
  status: unknown;
  apply_requested: unknown;
  apply_requested_at: unknown;
  apply_requested_by: unknown;
}

/**
 * `position_verdict`: did the person authorise THIS position? Already sent
 * comes first, and the order is the point: the flag stays on after a send, so
 * a flag is not evidence that another letter was asked for.
 */
function positionVerdict(db: Database, rule: Rule, rulePath: string, pid: number): Verdict {
  if (pid <= 0) return verdict(false, "position_id_invalid", "position id is not a positive integer", { position_id: pid });
  if (rule.error) {
    return verdict(false, "rule_unavailable", `the authorisation rule cannot be read: ${rule.error}`, { position_id: pid, path: rulePath });
  }
  let row: PositionRow | undefined;
  let already: { applied: unknown; applied_via: unknown } | undefined;
  try {
    row = db.prepare("SELECT status, apply_requested, apply_requested_at, apply_requested_by FROM positions WHERE id = ?").get(pid) as PositionRow | undefined;
    already = db.prepare("SELECT applied, applied_via FROM applications WHERE position_id = ?").get(pid) as typeof already;
  } catch (error) {
    return verdict(false, "authorisation_unreadable", `cannot read the authorisation columns: ${(error as Error).message}`, { position_id: pid });
  }
  if (row === undefined) return verdict(false, "position_not_found", "no such position in the local database", { position_id: pid });
  const { status, apply_requested: flag, apply_requested_at: at, apply_requested_by: by } = row;
  if (typeof status === "string" && rule.postSubmission.includes(status)) {
    return verdict(
      false,
      "already_submitted",
      "this application has already gone out: the flag stays on after a submission, so it is not evidence that another one was asked for",
      { position_id: pid, status },
    );
  }
  if (already !== undefined && already.applied === 1) {
    return verdict(false, "already_submitted", "an application row for this position is already marked applied", {
      position_id: pid,
      status,
      applied_via: already.applied_via,
    });
  }
  if (flag !== 1) {
    return verdict(false, "position_not_authorised", "the user has not flagged this position: no application goes out, whatever the score", {
      position_id: pid,
      status,
    });
  }
  if (!truthy(at)) {
    return verdict(
      false,
      "authorisation_undated",
      "`apply_requested` is on but `apply_requested_at` is empty: an authorisation with no instant cannot be told from a stale write",
      { position_id: pid },
    );
  }
  if (typeof by !== "string" || !rule.userOrigins.includes(by)) {
    return verdict(
      false,
      "authorisation_not_from_user",
      `\`apply_requested_by\` does not name a user channel (${rule.userOrigins.join("/")}): a flag turned on by a process is not an authorisation`,
      { position_id: pid, by: pyReprValue(by) },
    );
  }
  return verdict(true, "position_authorised", "the user authorised this position", { position_id: pid, status, by, at });
}

/** `apply_verdict`: consent AND authorisation, in that order. */
export function applyVerdict(options: CloserOptions, pid: number): Verdict {
  const consent = consentVerdict(options);
  if (!consent.allowed) return verdict(false, consent.reason, consent.detail, { ...consent.context, position_id: pid });
  const rulePath = options.rulePath ?? RULE_COPY;
  const p = positionVerdict(options.db(), loadRule(rulePath), rulePath, pid);
  if (!p.allowed) return p;
  return verdict(true, "apply_allowed", "consent granted and position authorised by the user", {
    ...p.context,
    mode: consent.context["mode"],
    max_per_day: consent.context["max_per_day"],
  });
}

// ── apply_gate: the queue ────────────────────────────────────────────────

function tableExists(db: Database, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/**
 * `_sent_today`: the automated sends that consume today's cap, browser and
 * email together, one per position — a recorded send, an email whose outcome
 * is still open, a reservation not released. The SQL is the script's.
 */
function sentToday(db: Database, rule: Rule): number {
  if (rule.automatedError) throw new Error(`automated channels unreadable: ${rule.automatedError}`);
  const marks = rule.automated.map(() => "?").join(",");
  const parts = [
    `SELECT position_id FROM applications WHERE applied = 1 AND applied_via IN (${marks}) AND date(applied_at) = date('now', 'localtime')`,
  ];
  const params: string[] = [...rule.automated];
  if (tableExists(db, "email_application_attempts")) {
    parts.push(
      `SELECT e.position_id FROM email_application_attempts e LEFT JOIN applications a ON a.position_id = e.position_id ` +
        `WHERE e.state IN (${EMAIL_UNRESOLVED_STATES.map(() => "?").join(",")}) ` +
        `AND date(e.send_started_at, 'localtime') = date('now', 'localtime') AND COALESCE(a.applied, 0) != 1`,
    );
    params.push(...EMAIL_UNRESOLVED_STATES);
  }
  if (tableExists(db, "apply_cap_reservations")) {
    parts.push(`SELECT position_id FROM apply_cap_reservations WHERE state = 'reserved' AND date(reserved_at, 'localtime') = date('now', 'localtime')`);
  }
  const row = db.prepare(`SELECT COUNT(*) AS n FROM (${parts.join(" UNION ")})`).get(...params) as { n: number };
  return Number(row.n);
}

function readJsonDict(path: string): { data: Dict | null; missing: boolean } {
  let raw: string;
  try {
    raw = readUtf8(path);
  } catch (error) {
    return { data: null, missing: (error as NodeJS.ErrnoException).code === "ENOENT" };
  }
  try {
    const data = JSON.parse(raw) as unknown;
    return { data: isDict(data) ? data : null, missing: false };
  } catch {
    return { data: null, missing: false };
  }
}

export function checkpointPath(jhtHome: string, pid: number): string {
  return pyPath(jhtHome, ".cache", "apply-flow", `${pid}.json`);
}

/**
 * `_checkpoint_hold`: why the send flow's checkpoint keeps the position out of
 * the queue, or `""`. A stop only a person can undo holds until the person
 * authorises again AFTER it (CL-05); an unreadable checkpoint holds.
 *
 * One difference, on the closed side: a checkpoint that is not UTF-8 makes the
 * script crash (its `read_text` raises a ValueError nobody catches); here it
 * is `checkpoint_unreadable`.
 */
function checkpointHold(options: CloserOptions, pid: number, authorisedAt: unknown): string {
  const { data, missing } = readJsonDict(checkpointPath(options.jhtHome, pid));
  if (missing) return "";
  if (data === null) return "checkpoint_unreadable";
  const state = get(data, "state");
  if (state === RETRY_LATER_STATE) {
    const after = parseInstant(get(data, "retry_after"));
    return after !== null && now(options) < after ? "checkpoint_retry_later" : "";
  }
  if (typeof state !== "string" || !HELD_CHECKPOINT_STATES.includes(state)) return "";
  const blocked = get(data, "blocked_reason");
  if (typeof blocked === "string" && CV_LAYOUT_REASONS.includes(blocked)) return "";
  const request = get(data, "answer_request");
  if (isDict(request) && get(request, "asked") === false && pyStrip(pyStrValue(truthy(get(request, "message_id")) ? get(request, "message_id") : "")) === "") {
    // A question the flow stopped on and nobody asked: no answer will ever
    // come, so the position stays in the queue for the CLOSER to work it out.
    return "";
  }
  const heldAt = parseInstant(get(data, "updated_at"));
  const askedAt = parseInstant(authorisedAt);
  if (heldAt !== null && askedAt !== null && askedAt > heldAt) return "";
  return `checkpoint_${state}`;
}

/** `_email_hold`: an email that may have reached the recruiter holds, and is never retried (CL-07). */
function emailHold(options: CloserOptions, db: Database, pid: number, authorisedAt: unknown): string {
  try {
    if (tableExists(db, "email_application_attempts")) {
      const row = db
        .prepare(
          `SELECT state FROM email_application_attempts WHERE position_id = ? AND state IN (${EMAIL_UNRESOLVED_STATES.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 1`,
        )
        .get(pid, ...EMAIL_UNRESOLVED_STATES) as { state: string } | undefined;
      if (row) return `email_${row.state}`;
    }
  } catch {
    // An unreadable register may hide a send in flight: hold, never pass.
    return "email_attempts_unreadable";
  }
  const { data, missing } = readJsonDict(pyPath(options.jhtHome, ".cache", "email-application", `${pid}.json`));
  if (missing) return "";
  if (data === null) return "email_state_unreadable";
  const state = get(data, "state");
  if (typeof state !== "string" || !EMAIL_HELD_STATES.includes(state)) return "";
  const reason = get(data, "reason");
  if (typeof reason === "string" && CV_LAYOUT_REASONS.includes(reason)) return "";
  const heldAt = parseInstant(get(data, "updated_at"));
  const askedAt = parseInstant(authorisedAt);
  if (heldAt !== null && askedAt !== null && askedAt > heldAt) return "";
  return `email_${state}`;
}

/** Where `resolveFile` puts a CV the database names outside the team's folders. */
const OUTSIDE = Symbol("outside");

/**
 * `_resolve_file`: the CV on disk, a relative path read from the JHT home, or
 * null — and, unlike the script, `OUTSIDE` for a file that is not in the
 * team's folders.
 *
 * The path is a column (`applications.cv_pdf_path`) that any role with
 * `db_update application` writes, and the script takes it as it is: absolute,
 * `../` or a symlink, the gate opens it. On the box that was an existence
 * check; here the gate READS what it names — a sha256 of its bytes and three
 * poppler runs — so a row pointing at `/etc/shadow`, the provider key or
 * another role's state would have the gate open it on the CLOSER's behalf,
 * and on the CAPITANO's. So the file, with every link resolved (`realPath`,
 * as the file tools judge a path), must sit in one of `cvRoots`. The path the
 * queue prints stays the script's, unresolved: the confinement decides, it
 * does not rewrite.
 */
function resolveFile(value: unknown, options: CloserOptions): string | null | typeof OUTSIDE {
  if (!truthy(value) || pyStrip(pyStrValue(value)) === "") return null;
  const p = pyPath(pyStrip(pyStrValue(value)));
  const full = p.startsWith("/") ? p : pyPath(options.jhtHome, p);
  // SICUREZZA (T39-3): the roots are the CV folders, never the home they sit
  // in. Under the JHT home the product keeps the person's secrets —
  // `credentials/ats-accounts/<tenant>.json` (portal passwords),
  // `credentials/email_monitor.json` (the IMAP login) — and this path comes
  // from a column a model writes. With the home as a root, a row naming one of
  // those files had the gate hash it and run poppler on it. The gate must be
  // able to open a CV, not the house the CV lives in. No roots: nothing opens.
  const roots = (options.cvRoots ?? []).map((root) => realPath(root));
  // Confined BEFORE any stat: answering "missing" for a path outside and
  // "outside" for one that exists would be an oracle of what exists on the
  // box. `realPath` resolves a path that does not exist as well.
  if (!roots.some((root) => isInside(root, realPath(full)))) return OUTSIDE;
  return isFile(full) ? full : null;
}

/**
 * `_essentials_hold`: `essential_answers_pending` while an essential fact was
 * asked and is still unknown (never for more than a day per question). A
 * broken profile never breaks the queue: it warns, on stderr, and counts as
 * an empty one.
 */
function essentialsHold(options: CloserOptions, db: Database): { hold: string; stderr: string } {
  let profile: unknown = null;
  let stderr = "";
  const path = pyPath(options.profileDir, "candidate_profile.yml");
  try {
    profile = pySafeLoad(readUtf8(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      stderr = `[apply-gate] profile unreadable for the essentials hold: ${pyErrorName(error, path)}\n`;
    }
    profile = null;
  }
  try {
    const report = checkEssentials(db, isDict(profile) ? profile : {}, null, now(options));
    return { hold: report.already_asked.length > 0 ? "essential_answers_pending" : "", stderr };
  } catch {
    return { hold: "", stderr };
  }
}

export interface QueueItem {
  position_id: number;
  url: string;
  cv_pdf_path: string;
}

export interface Queue {
  ready: boolean;
  reason: string;
  detail: string;
  mode: unknown;
  max_per_day: unknown;
  sent_today: number | null;
  remaining_today: number | null;
  positions: QueueItem[];
  held: Array<{ position_id: number; reason: string }>;
}

/**
 * `application_queue`: the positions the CLOSER may take now, and why the
 * others wait. `ready` only with consent, room under the cap and at least one
 * position that passes its verdict and no hold. A queue that cannot be read
 * says `queue_unreadable`, never `queue_empty` (CL-04).
 */
export function applicationQueue(options: CloserOptions): { queue: Queue; stderr: string } {
  const out: Queue = { ready: false, reason: "", detail: "", mode: null, max_per_day: null, sent_today: null, remaining_today: null, positions: [], held: [] };
  const consent = consentVerdict(options);
  if (!consent.allowed) return { queue: { ...out, reason: consent.reason, detail: consent.detail }, stderr: "" };
  out.mode = consent.context["mode"];
  out.max_per_day = consent.context["max_per_day"];
  const rulePath = options.rulePath ?? RULE_COPY;
  const rule = loadRule(rulePath);
  const db = options.db();
  let rows: Array<{ id: number; url: unknown; apply_requested_at: unknown; cv_pdf_path: unknown }>;
  let sent: number;
  try {
    rows = db
      .prepare(
        "SELECT p.id, p.url, p.apply_requested_at, a.cv_pdf_path FROM positions p LEFT JOIN applications a ON a.position_id = p.id " +
          "WHERE p.apply_requested = 1 AND p.status = ? ORDER BY p.apply_requested_at, p.id",
      )
      .all(rule.authorisable) as typeof rows;
    // The cap counts only what the automation sent: a send by the person
    // themselves does not use its quota.
    sent = sentToday(db, rule);
  } catch (error) {
    return { queue: { ...out, reason: "queue_unreadable", detail: `cannot read the application queue: ${(error as Error).message}` }, stderr: "" };
  }
  const positions: QueueItem[] = [];
  const held: Queue["held"] = [];
  const essentials = essentialsHold(options, db);
  const layout = options.cvLayout ?? (() => "cv_pdf_check_unavailable" as const);
  for (const { id: pid, url, apply_requested_at: askedAt, cv_pdf_path: cvPdf } of rows) {
    const v = positionVerdict(db, rule, rulePath, pid);
    if (!v.allowed) {
      held.push({ position_id: pid, reason: v.reason });
      continue;
    }
    if (!truthy(url) || pyStrip(pyStrValue(url)) === "") {
      held.push({ position_id: pid, reason: "url_missing" });
      continue;
    }
    const cv = resolveFile(cvPdf, options);
    if (cv === null) {
      held.push({ position_id: pid, reason: "cv_pdf_missing" });
      continue;
    }
    if (cv === OUTSIDE) {
      held.push({ position_id: pid, reason: "cv_pdf_path_outside" });
      continue;
    }
    const measured = layout(cv);
    if (measured) {
      held.push({ position_id: pid, reason: measured });
      continue;
    }
    const hold = checkpointHold(options, pid, askedAt) || emailHold(options, db, pid, askedAt) || essentials.hold;
    if (hold) {
      held.push({ position_id: pid, reason: hold });
      continue;
    }
    positions.push({ position_id: pid, url: pyStrip(pyStrValue(url)), cv_pdf_path: cv });
  }
  const cap = out.max_per_day as number | null;
  const remaining = cap === null ? null : Math.max(0, cap - sent);
  const queue: Queue = { ...out, sent_today: sent, remaining_today: remaining, positions, held };
  if (positions.length === 0) Object.assign(queue, { reason: "queue_empty", detail: "no authorised position can be taken now" });
  else if (remaining !== null && remaining <= 0) {
    Object.assign(queue, { reason: "daily_cap_reached", detail: "the daily cap of automated applications is reached; the queue waits for tomorrow" });
  } else Object.assign(queue, { ready: true, reason: "queue_ready", detail: `${positions.length} authorised position(s) can be taken` });
  return { queue, stderr: essentials.stderr };
}

/**
 * `cv_layout_hold`: why this CV must not go out, or `""`, from the layout
 * check (pdf-layout.ts). `cv_pdf_layout_bad` when the report is not ok,
 * `cv_pdf_check_unavailable` when there is no report — poppler missing, a
 * file that cannot be read, a check that throws or returns something that is
 * not a report: an unmeasured CV is not a pass.
 *
 * A measured verdict is remembered by the file's CONTENT (sha256) and by the
 * check that gave it (one memory per check: this closure), never by name or
 * mtime: a CV the Scrittore renders again is measured again and lifts the
 * hold by itself, and no stale verdict can wave a new file through. The queue
 * is read at every iteration; poppler runs once per PDF, not once per read.
 * Unavailable is never remembered: poppler may come back.
 */
export function createCvLayoutHold(check: (pdf: string) => unknown = (pdf) => analyze(pdf)): (cv: string) => "" | "cv_pdf_layout_bad" | "cv_pdf_check_unavailable" {
  const verdicts = new Map<string, "" | "cv_pdf_layout_bad">();
  return (cv) => {
    let digest: string;
    try {
      digest = createHash("sha256").update(readFileSync(cv)).digest("hex");
    } catch {
      return "cv_pdf_check_unavailable";
    }
    const known = verdicts.get(digest);
    if (known !== undefined) return known;
    let report: unknown;
    try {
      report = check(cv);
    } catch {
      // A CheckError is the script's `cv_pdf_check_unavailable`; anything
      // else is its `except Exception`, a crashing check, and the same answer.
      return "cv_pdf_check_unavailable";
    }
    if (!isDict(report)) return "cv_pdf_check_unavailable";
    const verdict = get(report, "ok") === true ? "" : "cv_pdf_layout_bad";
    if (verdicts.size >= 256) verdicts.clear();
    verdicts.set(digest, verdict);
    return verdict;
  };
}

function now(options: CloserOptions): number {
  return (options.now?.() ?? new Date()).getTime();
}

// ── apply_gate: the command line ─────────────────────────────────────────

const GATE_SPEC: CommandSpec = {
  prog: "apply_gate",
  positionals: [{ name: "check" }, { name: "position_id", type: "int", optional: true }],
  options: [{ flag: "--json", storeTrue: true }],
};

/**
 * A flag the script has and this port refuses, however argparse would let it
 * be spelled: `--db`, `--db=x`, or a prefix no allowed flag shares.
 */
function namesFlag(word: string, flag: string, allowed: readonly string[]): boolean {
  const name = word.split("=")[0]!;
  return name.length >= 3 && flag.startsWith(name) && !allowed.some((f) => f.startsWith(name));
}

const PATH_FLAGS: Readonly<Record<string, string>> = {
  "--db": "the database is the runtime's — the team's jobs.db — never an argument",
  "--config": "the consent is read from the person's own config ($JHT_HOME/jht.config.json), never from a file the caller picks",
  "--profile": "the profile is the person's, from the runtime's profile folder, never from a file the caller picks",
};

function pathFlagRefusal(tool: string, words: readonly string[], flags: readonly string[], allowed: readonly string[]): ScriptResult | null {
  for (const word of words) {
    const flag = flags.find((f) => namesFlag(word, f, allowed));
    if (flag) return { stdout: "", stderr: `\`${tool} ${flag}\` is not taken here: ${PATH_FLAGS[flag]}. Nothing was run.\n`, exitCode: 2 };
  }
  return null;
}

/** `_emit`: the verdict as JSON on stdout, or its log line — on stderr when it is a refusal. */
function emit(v: Verdict, asJson: boolean): ScriptResult {
  const code = v.allowed ? 0 : 1;
  if (asJson) return { stdout: `${pyJson({ allowed: v.allowed, reason: v.reason, detail: v.detail, context: v.context }, { ensureAscii: false })}\n`, exitCode: code };
  return v.allowed ? { stdout: `${logLine(v)}\n`, exitCode: 0 } : { stdout: "", stderr: `${logLine(v)}\n`, exitCode: 1 };
}

/** `apply_gate.py {consent,position,queue} [position_id] [--json]`. */
export function applyGate(args: string[], options: CloserOptions): ScriptResult {
  const refusal = pathFlagRefusal("apply_gate", args, ["--db", "--config"], ["--json"]);
  if (refusal) return refusal;
  const a = parseArgv(GATE_SPEC, args);
  const check = a["check"] as string;
  if (!["consent", "position", "queue"].includes(check)) {
    throw new ArgvError(`usage: apply_gate [-h] ...\napply_gate: error: argument check: invalid choice: ${pyRepr(check)} (choose from 'consent', 'position', 'queue')`);
  }
  const asJson = a["json"] === true;
  if (check === "consent") return emit(consentVerdict(options), asJson);
  if (check === "queue") {
    const { queue: q, stderr } = applicationQueue(options);
    const code = q.ready ? 0 : 1;
    if (asJson) return { stdout: `${pyJson(q, { ensureAscii: false })}\n`, stderr, exitCode: code };
    if (q.ready) return { stdout: `[apply-gate] QUEUE ${q.reason} — ${q.detail} (remaining_today=${pyStrValue(q.remaining_today)})\n`, stderr, exitCode: 0 };
    return { stdout: "", stderr: `${stderr}[apply-gate] QUEUE ${q.reason} — ${q.detail}\n`, exitCode: 1 };
  }
  if (a["position_id"] === null) throw new ArgvError("usage: apply_gate [-h] ...\napply_gate: error: the `position` check needs a position id");
  return emit(applyVerdict(options, a["position_id"] as number), asJson);
}

// ── application_answers: the rule shared with the dashboard ─────────────

const INFERRED_CHANNEL = "agent_inferred";
export const INFERENCE_BASES = ["profile", "cv", "vacancy", "judgement"] as const;
const COMPANY_SCOPED_KEYS = new Set(["salary expectations"]);
const CONTACT_LETTER_PURPOSE = "contact_form_application";
const TEXT_FIELD_TYPES = new Set(["textarea", "text", "email", "tel", "url", "number", "date"]);
const SCOPE_SEP = " @ ";
const MAX_ANSWER_CHARS = 4000;
const ESSENTIAL_QUESTION_TTL_MS = 24 * 3600 * 1000;
const ESSENTIAL_ROUNDS = 2;

/**
 * `str.casefold()`, which JavaScript does not have. Upper then lower, per
 * character and until it settles, is the full folding for every script the
 * profiles are written in (ß → ss, ẞ → ss, ﬁ → fi); the two exceptions of the
 * Unicode table are written out: the dotless ı folds to itself, and Cherokee
 * folds to its CAPITALS.
 */
function pyCasefold(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x131) out += ch;
    else if (cp >= 0x13f8 && cp <= 0x13fd) out += String.fromCodePoint(cp - 8);
    else if (cp >= 0xab70 && cp <= 0xabbf) out += String.fromCodePoint(cp - 0xab70 + 0x13a0);
    else if (cp >= 0x13a0 && cp <= 0x13f5) out += ch;
    else {
      let folded = ch;
      for (let i = 0; i < 3; i++) {
        const next = folded.toUpperCase().toLowerCase();
        if (next === folded) break;
        folded = next;
      }
      out += folded;
    }
  }
  return out;
}

/** `normalise_label`: the key an answer is saved under, as the recipes normalise a form's label. */
export function normaliseLabel(value: string): string {
  const folded = pyCasefold(pyStrip(value.replaceAll("\u00a0", " ")));
  // `[\s\W_]+` on a str: anything that is not a letter or a number.
  return pyStrip(folded.replace(/[^\p{L}\p{N}]+/gu, " "));
}

class AnswerRejected extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** `payload.get("version") != 1`: 1, 1.0 and True are all 1 to Python. */
const isOne = (v: unknown) => v === 1 || v === true || (v instanceof PyFloat && v.value === 1);

/** `payload_shape`: the field type and options of a request payload; the dashboard checks the same. */
function payloadShape(payload: unknown): { fieldType: string; options: string[] } {
  if (!isDict(payload)) throw new AnswerRejected("closer_answer_payload_invalid");
  const fieldType = get(payload, "field_type");
  const options = get(payload, "options");
  if (
    !isOne(get(payload, "version")) ||
    !nonEmptyStr(get(payload, "key")) ||
    !nonEmptyStr(get(payload, "label")) ||
    typeof fieldType !== "string" ||
    !Array.isArray(options) ||
    options.some((o) => !nonEmptyStr(o)) ||
    new Set(options).size !== options.length
  ) {
    throw new AnswerRejected("closer_answer_payload_invalid");
  }
  return { fieldType, options: options as string[] };
}

/** `validate_reply`: exactly `assertAnswerShape` in web/lib/application-answer-request.ts. */
function validateReply(fieldType: string, options: readonly string[], reply: string): void {
  if (fieldType === "radio" || fieldType === "select") {
    if (!options.includes(reply)) throw new AnswerRejected("closer_answer_not_exact_option");
    return;
  }
  if (fieldType === "checkbox") {
    if (reply !== "Yes" && reply !== "No") throw new AnswerRejected("closer_answer_not_exact_option");
    return;
  }
  if (fieldType === "checkboxes") {
    let selected: unknown;
    try {
      selected = pyJsonLoads(reply);
    } catch {
      throw new AnswerRejected("closer_answer_not_exact_option");
    }
    if (
      !Array.isArray(selected) ||
      selected.length === 0 ||
      selected.some((o) => typeof o !== "string" || !options.includes(o)) ||
      new Set(selected).size !== selected.length
    ) {
      throw new AnswerRejected("closer_answer_not_exact_option");
    }
    return;
  }
  if (TEXT_FIELD_TYPES.has(fieldType) && options.length === 0) return;
  throw new AnswerRejected("closer_answer_payload_invalid");
}

/** `decode_reply`: the typed answer a recipe fills in. */
function decodeReply(fieldType: string, reply: string): unknown {
  if (fieldType === "checkbox") return reply === "Yes";
  if (fieldType === "checkboxes") return pyJsonLoads(reply);
  return reply;
}

/** `str.splitlines()`'s boundaries. */
const PY_LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `telegram_reply_text`: one option per line becomes the JSON list the dashboard sends; nothing else is reinterpreted. */
function replyText(fieldType: string, text: string): string {
  const clean = pyStrip(text);
  if (fieldType === "checkboxes" && !clean.startsWith("[")) {
    const lines = clean
      .split(PY_LINE_BREAK)
      .map((l) => pyStrip(l))
      .filter((l) => l !== "");
    return pyJson(lines, { ensureAscii: false });
  }
  return clean;
}

// ── application_answers: the table ───────────────────────────────────────

/** `position_company`: a company answer's scope, the normalised company name. */
function positionCompany(db: Database, pid: number | null): string {
  if (pid === null) return "";
  let found: { company: unknown } | undefined;
  try {
    found = db.prepare("SELECT company FROM positions WHERE id = ?").get(pid) as typeof found;
  } catch {
    found = undefined;
  }
  const company = found && truthy(found.company) ? normaliseLabel(pyStrValue(found.company)) : "";
  return company || normaliseLabel(`position ${pid}`);
}

/** `position_scope`: an answer that belongs to one position only (a contact-form letter). */
function positionScope(pid: number): string {
  return normaliseLabel(`jht position ${pid}`);
}

interface EssentialFact {
  key: string;
  label: string;
  fieldType: string;
  options: readonly string[];
  profilePaths: ReadonlyArray<readonly string[]>;
}

/** `ESSENTIAL_FACTS`: what almost every form asks, in the script's order — the order `missing` lists them in. */
const ESSENTIAL_FACTS: readonly EssentialFact[] = [
  { key: "availability", label: "When can you start a new job (earliest start date)?", fieldType: "text", options: [], profilePaths: [["availability"], ["start_date"]] },
  { key: "notice period", label: "What is your notice period at your current job?", fieldType: "text", options: [], profilePaths: [["notice_period"]] },
  {
    key: "work authorization",
    label: "In which countries are you authorised to work without a visa?",
    fieldType: "textarea",
    options: [],
    profilePaths: [["work_authorization"], ["work_authorisation"]],
  },
  {
    key: "sponsorship",
    label: "Do you need visa sponsorship to work in the countries you apply to?",
    fieldType: "radio",
    options: ["Yes", "No"],
    profilePaths: [["sponsorship"], ["needs_sponsorship"]],
  },
  {
    key: "salary expectations",
    label: "What is your gross yearly salary expectation (amount and currency)?",
    fieldType: "text",
    options: [],
    profilePaths: [["salary_expectations"], ["salary_expectation"]],
  },
  { key: "relocation", label: "Are you willing to relocate for a job?", fieldType: "radio", options: ["Yes", "No"], profilePaths: [["relocation"], ["willing_to_relocate"]] },
  { key: "phone", label: "Which phone number should recruiters use?", fieldType: "tel", options: [], profilePaths: [["contacts", "phone"], ["phone"]] },
];
const ESSENTIAL_KEYS = new Set(ESSENTIAL_FACTS.map((f) => f.key));

/**
 * `_read_entries`: {key: [value, channel]} as a form of `pid` sees them. A
 * company answer wins over a global one, the position's own answer wins last,
 * and something the CLOSER worked out never wins over what the person said.
 */
function readEntries(db: Database, pid: number | null): Map<string, [unknown, string]> {
  const entries = new Map<string, [unknown, string]>();
  if (!tableExists(db, "application_answers")) return entries;
  const company = pid !== null ? positionCompany(db, pid) : "";
  const own = pid !== null ? positionScope(pid) : "";
  const scoped = new Map<string, [unknown, string]>();
  const positioned = new Map<string, [unknown, string]>();
  const rows = db.prepare("SELECT key, answer_json, field_type, channel FROM application_answers").all() as Array<{
    key: unknown;
    answer_json: unknown;
    field_type: unknown;
    channel: unknown;
  }>;
  for (const row of rows) {
    let value: unknown;
    try {
      value = pyJsonLoads(String(row.answer_json));
    } catch {
      continue;
    }
    const key = pyStrValue(row.key);
    const at = key.indexOf(SCOPE_SEP);
    const base = at < 0 ? key : key.slice(0, at);
    const scope = at < 0 ? "" : key.slice(at + SCOPE_SEP.length);
    const entry: [unknown, string] = [value, pyStrValue(row.channel)];
    if (at < 0) {
      // Saved before answers were kept per company: whose it was is unknown,
      // so it is never pasted into anyone's form.
      if (row.field_type === "textarea" && row.channel !== "profile_yaml" && !ESSENTIAL_KEYS.has(base)) continue;
      entries.set(base, entry);
    } else if (own && scope === own) positioned.set(base, entry);
    else if (company && scope === company) scoped.set(base, entry);
  }
  for (const layer of [scoped, positioned]) {
    for (const [base, entry] of layer) {
      const current = entries.get(base);
      if (current && entry[1] === INFERRED_CHANNEL && current[1] !== INFERRED_CHANNEL) continue;
      entries.set(base, entry);
    }
  }
  return entries;
}

/** `_present`: a fact is known when it says something; a date object or a mapping does not. */
function present(value: unknown): boolean {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint" || value instanceof PyFloat) return true;
  if (typeof value === "string") return pyStrip(value) !== "";
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function profileValue(profile: Dict, path: readonly string[]): unknown {
  let current: unknown = profile;
  for (const part of path) {
    if (!isDict(current)) return null;
    current = get(current, part);
  }
  return current;
}

/** `_profile_answers`: the YAML `application_answers`, a mapping or a list of {question, answer}. */
function profileAnswers(profile: Dict): Map<string, unknown> {
  const raw = get(profile, "application_answers");
  const out = new Map<string, unknown>();
  if (isDict(raw)) {
    for (const [k, v] of Object.entries(raw)) out.set(normaliseLabel(k), v);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isDict(item) && truthy(get(item, "question"))) out.set(normaliseLabel(pyStrValue(get(item, "question"))), get(item, "answer") ?? null);
    }
  }
  return out;
}

function essentialSourceId(fact: EssentialFact, round: number): string {
  const base = `closer-essential:${fact.key.replaceAll(" ", "_")}`;
  return round === 1 ? base : `${base}:${round}`;
}

/**
 * `_essential_state`: for a fact still unknown — unasked, waiting, expired or
 * given up, and a round. A creation time that cannot be read counts as
 * expired: a question never holds the queue for ever.
 */
function essentialState(db: Database, fact: EssentialFact, at: number): ["unasked" | "waiting" | "expired" | "given_up", number] {
  if (!tableExists(db, "pending_user_messages")) return ["unasked", 1];
  const ids = Array.from({ length: ESSENTIAL_ROUNDS }, (_, i) => essentialSourceId(fact, i + 1));
  const created = new Map<string, unknown>();
  for (const row of db
    .prepare(`SELECT source_id, MIN(created_at) AS created FROM pending_user_messages WHERE source_id IN (${ids.map(() => "?").join(",")}) GROUP BY source_id`)
    .all(...ids) as Array<{ source_id: string; created: unknown }>) {
    created.set(row.source_id, row.created);
  }
  const asked = ids.map((sid, i) => (created.has(sid) ? i + 1 : 0)).filter((n) => n > 0);
  if (asked.length === 0) return ["unasked", 1];
  const latest = Math.max(...asked);
  const when = parseInstant(created.get(ids[latest - 1]!));
  if (when !== null && at - when < ESSENTIAL_QUESTION_TTL_MS) return ["waiting", latest];
  if (latest < ESSENTIAL_ROUNDS) return ["expired", latest + 1];
  return ["given_up", latest];
}

/** `_asked_explicitly`: only a question the CLOSER chose to ask holds the queue. */
function askedExplicitly(db: Database, fact: EssentialFact, round: number): boolean {
  const row = db.prepare("SELECT source_payload FROM pending_user_messages WHERE source_id = ? ORDER BY id LIMIT 1").get(essentialSourceId(fact, round)) as
    | { source_payload: unknown }
    | undefined;
  try {
    const payload = pyJsonLoads(row && truthy(row.source_payload) ? String(row.source_payload) : "");
    return isDict(payload) && get(payload, "explicit") === true;
  } catch {
    return false;
  }
}

export interface EssentialsReport {
  status: "complete" | "missing";
  missing: string[];
  already_asked: string[];
  expired: string[];
  given_up: string[];
}

/**
 * `check_essentials`: what is still unknown, without writing anything — the
 * saved answers, the profile (its YAML answers included) and any valid reply
 * already on a question row, all read in memory.
 */
export function checkEssentials(db: Database, profile: Dict, pid: number | null, at: number): EssentialsReport {
  const answers = profileAnswers(profile);
  for (const [key, [value]] of readEntries(db, pid)) answers.set(key, value);
  if (tableExists(db, "pending_user_messages")) {
    const rows = db.prepare("SELECT source_payload, user_reply FROM pending_user_messages WHERE source_id LIKE 'closer-essential:%'").all() as Array<{
      source_payload: unknown;
      user_reply: unknown;
    }>;
    for (const { source_payload: text, user_reply: reply } of rows) {
      if (reply === null || reply === undefined) continue;
      try {
        const payload = pyJsonLoads(truthy(text) ? String(text) : "");
        const { fieldType, options } = payloadShape(payload);
        validateReply(fieldType, options, String(reply));
        const key = normaliseLabel(get(payload as Dict, "key") as string);
        if (!answers.has(key)) answers.set(key, decodeReply(fieldType, String(reply)));
      } catch {
        continue;
      }
    }
  }
  const missing = ESSENTIAL_FACTS.filter(
    (fact) => !present(answers.get(fact.key)) && !fact.profilePaths.some((path) => present(profileValue(profile, path))),
  );
  const states = new Map(missing.map((fact) => [fact.key, essentialState(db, fact, at)] as const));
  return {
    status: missing.length === 0 ? "complete" : "missing",
    missing: missing.map((f) => f.key),
    // Asked explicitly and still inside its day: only these hold the queue.
    already_asked: missing.filter((f) => states.get(f.key)![0] === "waiting" && askedExplicitly(db, f, states.get(f.key)![1])).map((f) => f.key),
    expired: missing.filter((f) => states.get(f.key)![0] === "expired").map((f) => f.key),
    given_up: missing.filter((f) => states.get(f.key)![0] === "given_up").map((f) => f.key),
  };
}

/** `_checkpoint_purpose`: the purpose of the flow's open question with this key, or "". */
function checkpointPurpose(jhtHome: string, pid: number, key: string): string {
  const { data } = readJsonDict(checkpointPath(jhtHome, pid));
  if (data === null) return "";
  const request = get(data, "answer_request");
  const payload = isDict(request) ? get(request, "payload") : undefined;
  if (!isDict(payload)) return "";
  const named = get(payload, "key");
  if (normaliseLabel(truthy(named) ? pyStrValue(named) : "") !== key) return "";
  const purpose = get(payload, "purpose");
  return typeof purpose === "string" ? purpose : "";
}

interface SaveInput {
  key: string;
  value: string;
  fieldType: string;
  options: string[];
  basis: string;
  positionId: number | null;
  label: string;
  purpose: string;
}

class InferenceRejected extends Error {}

/**
 * `save_inferred`: an answer the CLOSER worked out, checked like a person's
 * reply and saved with its basis (CL-08). The upsert's own WHERE is the
 * guard: a row the person answered is never overwritten by an inference, and
 * the answer is then `user_answer_kept` (CL-01).
 */
function saveInferred(db: Database, jhtHome: string, input: SaveInput, at: Date): Dict {
  const canonical = normaliseLabel(input.key);
  if (!canonical) throw new InferenceRejected("key_empty");
  if (!(INFERENCE_BASES as readonly string[]).includes(input.basis)) throw new InferenceRejected("basis_invalid");
  let reply: string;
  try {
    payloadShape({ version: 1, key: canonical, label: input.label || input.key, field_type: input.fieldType, options: input.options });
    reply = replyText(input.fieldType, input.value);
    if (!reply || Array.from(reply).length > MAX_ANSWER_CHARS) throw new AnswerRejected("closer_answer_empty");
    validateReply(input.fieldType, input.options, reply);
  } catch (error) {
    if (error instanceof AnswerRejected) throw new InferenceRejected(error.reason);
    throw error;
  }
  const essential = ESSENTIAL_KEYS.has(canonical);
  let purpose = input.purpose;
  if (!purpose && input.positionId !== null) purpose = checkpointPurpose(jhtHome, input.positionId, canonical);
  const positionScoped = purpose === CONTACT_LETTER_PURPOSE && !essential;
  const companyScoped = COMPANY_SCOPED_KEYS.has(canonical) || (input.fieldType === "textarea" && !essential);
  if ((companyScoped || positionScoped) && input.positionId === null) throw new InferenceRejected("position_id_required");
  const scope = positionScoped ? positionScope(input.positionId!) : companyScoped ? positionCompany(db, input.positionId) : "";
  const saved =
    Number(
      db
        .prepare(
          "INSERT INTO application_answers " +
            "(key, label, answer_json, field_type, options_json, channel, source_message_id, answered_at, basis) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET label = excluded.label, answer_json = excluded.answer_json, " +
            "field_type = excluded.field_type, options_json = excluded.options_json, " +
            "channel = excluded.channel, source_message_id = excluded.source_message_id, " +
            "answered_at = excluded.answered_at, basis = excluded.basis " +
            "WHERE excluded.channel != ? OR application_answers.channel = ?",
        )
        .run(
          scope ? `${canonical}${SCOPE_SEP}${scope}` : canonical,
          input.label || input.key,
          pyJson(decodeReply(input.fieldType, reply), { ensureAscii: false }),
          input.fieldType,
          pyJson(input.options, { ensureAscii: false }),
          INFERRED_CHANNEL,
          null,
          // `_utc_now`: milliseconds and a Z, which is exactly toISOString.
          at.toISOString(),
          input.basis,
          INFERRED_CHANNEL,
          INFERRED_CHANNEL,
        ).changes,
    ) === 1;
  return { status: saved ? "saved" : "user_answer_kept", key: canonical, scope: positionScoped ? "position" : scope ? "company" : "global", basis: input.basis };
}

/** The exception's class name, as `type(exc).__name__` prints it in the script's error line. */
function pyErrorName(error: unknown, path: string): string {
  if (error instanceof UnicodeDecodeError) return "UnicodeDecodeError";
  const code = (error as NodeJS.ErrnoException).code ?? "";
  if (Object.hasOwn(OS_ERRORS, code)) return pyOsError(error, path).name;
  if (code === "ERR_SQLITE_ERROR") return "OperationalError";
  // PyYAML names its errors by stage (ScannerError, ParserError, …); the
  // parser here has one class. The stage is not recoverable from it.
  return (error as Error).name === "YAMLParseError" || (error as Error).name === "YAMLWarning" ? "YAMLError" : (error as Error).name || "Error";
}

/** `_load_profile`: the person's profile, {} when absent or not a mapping; anything else is the script's error line. */
function loadProfile(profileDir: string): Dict {
  const path = pyPath(profileDir, "candidate_profile.yml");
  let text: string;
  try {
    text = readUtf8(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const value = pySafeLoad(text);
  return isDict(value) ? value : {};
}

// ── application_answers: the command line ───────────────────────────────

const ESSENTIALS_SPEC: CommandSpec = {
  prog: "application_answers.py essentials",
  mainProg: "application_answers.py",
  options: [
    { flag: "--position-id", type: "int", required: true },
    { flag: "--json", storeTrue: true },
  ],
};

const LIST_SPEC: CommandSpec = { prog: "application_answers.py list", mainProg: "application_answers.py", options: [{ flag: "--json", storeTrue: true }] };

const SAVE_SPEC: CommandSpec = {
  prog: "application_answers.py save",
  mainProg: "application_answers.py",
  options: [
    { flag: "--key", required: true },
    { flag: "--value", required: true },
    { flag: "--field-type", required: true },
    { flag: "--basis", required: true, choices: INFERENCE_BASES },
    { flag: "--position-id", type: "int" },
    { flag: "--label", default: "" },
    { flag: "--purpose", default: "" },
    { flag: "--json", storeTrue: true },
  ],
};

const SAVE_FLAGS = ["--key", "--value", "--field-type", "--options", "--basis", "--position-id", "--label", "--purpose", "--json"];

/** Whether argparse would take this word as a value, not as a flag. */
const isValue = (word: string) => !word.startsWith("-") || word === "-" || /^-\d+(\.\d+)?$/.test(word);

/**
 * `--options` is `nargs="*"`, which the shared parser does not read: every
 * value up to the next flag, the last occurrence winning. Taken out here, the
 * rest goes to the parser as usual.
 */
function takeOptions(words: readonly string[]): { options: string[]; rest: string[] } {
  let options: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const name = word.split("=")[0]!;
    if (name.length >= 3 && "--options".startsWith(name)) {
      if (word.includes("=")) {
        options = [word.slice(word.indexOf("=") + 1)];
        continue;
      }
      options = [];
      while (i + 1 < words.length && isValue(words[i + 1]!)) options.push(words[++i]!);
      continue;
    }
    rest.push(word);
  }
  return { options, rest };
}

const NOT_HERE = {
  ask:
    "`application_answers ask` sends ONE question to the person on Telegram and relies on what follows it: the reply coming back " +
    "and being resolved into a saved answer. Neither the Telegram channel nor that return path exists in this harness, so the " +
    "question would never be answered. Nothing was sent. When a key has no basis in the profile, the CV or the vacancy " +
    "(CL-08 step 3), say which one in the round's single message to the person, with the `notify_user` tool, and move to the " +
    "next position — never invent the answer (CL-01).",
  essentialsAsk:
    "`application_answers essentials --ask` sends the question to the person on Telegram, and the reply that would come back " +
    "and be resolved into an answer has no path here. Nothing was sent. Read what is missing with `essentials --position-id N` " +
    "(no `--ask`), work each fact out and `save` it with its basis; for a fact nothing supports, tell the person with the " +
    "`notify_user` tool (CL-08 step 3).",
  wake:
    "`application_answers wake-idle-closer` types into a live CLOSER's tmux pane; there are no panes here, and a role is woken " +
    "by the runtime's own turns. Nothing was sent.",
};

const ANSWERS_USAGE = "usage: application_answers.py [-h] ...\napplication_answers.py: error: ";

/** `application_answers.py {essentials,list,save}`: one JSON line with sorted keys, whatever `--json` says. */
export function applicationAnswers(args: string[], options: CloserOptions): ScriptResult {
  const command = args[0];
  if (command === "ask") return { stdout: "", stderr: `${NOT_HERE.ask}\n`, exitCode: 2 };
  if (command === "wake-idle-closer") return { stdout: "", stderr: `${NOT_HERE.wake}\n`, exitCode: 2 };
  if (command === undefined) throw new ArgvError(`${ANSWERS_USAGE}the following arguments are required: command`);
  if (!["essentials", "list", "save"].includes(command)) {
    throw new ArgvError(`${ANSWERS_USAGE}argument command: invalid choice: ${pyRepr(command)} (choose from 'essentials', 'list', 'save')`);
  }
  const words = args.slice(1);
  const allowed = command === "save" ? SAVE_FLAGS : command === "essentials" ? ["--position-id", "--json", "--ask"] : ["--json"];
  const refusal = pathFlagRefusal("application_answers", words, ["--db", "--profile"], allowed);
  if (refusal) return refusal;
  if (command === "essentials" && words.some((w) => namesFlag(w, "--ask", ["--position-id", "--json"]))) {
    return { stdout: "", stderr: `${NOT_HERE.essentialsAsk}\n`, exitCode: 2 };
  }
  // Argument errors are argparse's, before anything is read: exit 2 through `guarded`.
  const parsed: Record<string, unknown> =
    command === "save"
      ? (() => {
          const { options: opts, rest } = takeOptions(words);
          return { ...parseArgv(SAVE_SPEC, rest), options: opts };
        })()
      : parseArgv(command === "essentials" ? ESSENTIALS_SPEC : LIST_SPEC, words);
  let out: Dict;
  let code: number;
  try {
    const db = options.db();
    if (command === "essentials") {
      const report = checkEssentials(db, loadProfile(options.profileDir), parsed["position_id"] as number, now(options));
      out = { ...report };
      code = report.status === "complete" ? 0 : 3;
    } else if (command === "save") {
      const p = parsed as Record<string, unknown>;
      try {
        out = saveInferred(
          db,
          options.jhtHome,
          {
            key: p["key"] as string,
            value: p["value"] as string,
            fieldType: p["field_type"] as string,
            options: p["options"] as string[],
            basis: p["basis"] as string,
            positionId: (p["position_id"] as number | null) ?? null,
            label: p["label"] as string,
            purpose: p["purpose"] as string,
          },
          options.now?.() ?? new Date(),
        );
        code = out["status"] === "saved" ? 0 : 3;
      } catch (error) {
        if (!(error instanceof InferenceRejected)) throw error;
        out = { status: "rejected", reason: error.message, key: normaliseLabel(p["key"] as string) };
        code = 1;
      }
    } else {
      const rows = db.prepare("SELECT key, field_type, channel, basis, answered_at FROM application_answers ORDER BY key").all() as Dict[];
      out = {
        status: "listed",
        answers: rows.map((r) => ({ key: r["key"], field_type: r["field_type"], channel: r["channel"], basis: r["basis"], answered_at: r["answered_at"] })),
      };
      code = 0;
    }
  } catch (error) {
    // One JSON line, never a traceback to the agent — as the script's own catch-all.
    const profile = pyPath(options.profileDir, "candidate_profile.yml");
    const known = Object.hasOwn(OS_ERRORS, (error as NodeJS.ErrnoException).code ?? "");
    const detail = known ? pyOsError(error, profile).text : String((error as Error).message);
    out = { status: "error", reason: pyErrorName(error, profile), detail: Array.from(detail).slice(0, 300).join("") };
    code = 2;
  }
  return { stdout: `${sortedJson(out)}\n`, exitCode: code };
}

// ── the tools ────────────────────────────────────────────────────────────

export function createApplyGateTool(options: CloserOptions): ToolHandler {
  return argvTool({
    name: "apply_gate",
    script: "apply_gate.py",
    description:
      "The authorisation gate (skill apply-authorization). `queue --json` is what you may take now: read it at the start of every " +
      "iteration, never from memory (CL-04). `position <ID> --json` is the verdict on one position, `consent` the person's general " +
      "consent. Exit 1 is a refusal, with its reason; a queue that cannot be read is never an empty one. It reads only: it reserves " +
      "no slot of the daily cap and sends nothing.",
    run: (args) => applyGate(args, options),
    // Exit 1 is the gate's answer — refused, or nothing to take — not a failure of the call.
    okCodes: [0, 1],
  });
}

export function createApplicationAnswersTool(options: CloserOptions): ToolHandler {
  return argvTool({
    name: "application_answers",
    script: "application_answers.py",
    description:
      "The application answers (CL-08). `essentials --position-id N --json` lists the essential facts still unknown (exit 3 = some " +
      "are missing). `list --json` shows the saved answers: keys, channels and bases, never values. `save --key K --value V " +
      "--field-type T [--options …] --basis profile|cv|vacancy|judgement [--position-id N]` keeps an answer you worked out, and " +
      "never replaces one the person gave (`user_answer_kept`, exit 3). `ask` is not available here: nothing reaches the person " +
      "from this tool.",
    run: (args) => applicationAnswers(args, options),
    okCodes: [0, 3],
  });
}
