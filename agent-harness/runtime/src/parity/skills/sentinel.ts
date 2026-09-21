/**
 * The SENTINELLA's two file-only scripts as native tools (T37):
 * `bridge_mailbox.py` and the read side of `burn_intent.py`.
 *
 * The SENTINELLA is the most host-facing role of the team: a bridge wakes it
 * by typing a tick into its pane, its emergency brake sends Escape to other
 * panes, and its fallback screen-scrapes a provider's TUI. None of that
 * exists for an API agent, and those pieces are elsewhere (T37-2, T37-3).
 * These two are the exception: they are pure reads of files under the team's
 * home, so they port as they are — same words in, same bytes out.
 *
 * `bridge_mailbox` is the safety net under a lost tmux delivery: the pacing
 * bridge appends every verdict to a JSONL whether or not the message reached
 * a pane, and the reader advances a byte cursor. Since 2026-06-25 the mailbox
 * is the SENTINELLA's, not the CAPITANO's (push→pull), and its prompt has it
 * drained at the start of the turn.
 *
 * `burn_intent status` is the read that must happen before a DAILY brake: the
 * person can suspend that ceiling ("the budget is not a constraint, push"),
 * and the SENTINELLA is the one brake that could still undo the order without
 * looking like a mistake. It fails closed — missing, unreadable, malformed or
 * expired all answer `active: false` — so a failed read is never a licence to
 * speed up.
 *
 * **Narrower on purpose**: `grant`, `revoke` and `sweep` are refused here.
 * They are the person's, through `jht burn on|off`, and RULE #0 of the
 * SENTINELLA's prompt says as much ("`status` is a read; `grant`/`revoke`
 * belong to the user"). In the TUI only the prompt stopped a role from
 * granting itself a derogation to the very ceiling it enforces.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pyJson, pyPad } from "../../db/py-format.ts";
import { refused, type ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";

export interface SentinelOptions {
  /** The team's home: `$JHT_HOME` for the scripts, where `logs/` lives. */
  jhtHome: string;
  now?: () => Date;
}

// ── bridge_mailbox ───────────────────────────────────────────────────────

const mailboxPaths = (jhtHome: string) => ({
  mailbox: join(jhtHome, "logs", "bridge-mailbox.jsonl"),
  cursor: join(jhtHome, "logs", "bridge-mailbox.cursor"),
});

/** `read_cursor`: the byte offset, and 0 for anything that is not one. */
function readCursor(path: string): number {
  try {
    const text = readFileSync(path, "utf8").trim();
    if (text === "") return 0;
    // Python's int(): a decimal integer and nothing else.
    if (!/^[+-]?\d+$/.test(text)) return 0;
    return Number.parseInt(text, 10);
  } catch {
    return 0;
  }
}

/** `write_cursor`: best effort, and the warning goes to stderr as the script's does. */
function writeCursor(path: string, offset: number): string {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, String(offset), "utf8");
    return "";
  } catch (error) {
    return `[bridge_mailbox] WARN write cursor: ${(error as Error).message}\n`;
  }
}

interface MailboxEntry {
  ts?: unknown;
  kind?: unknown;
  msg?: unknown;
  delivered_via_tmux?: unknown;
}

/**
 * `read_new`: everything after the cursor. A file shorter than the cursor
 * (a truncate by hand) restarts from 0, a line that is not JSON is skipped,
 * and `advance` moves the cursor to the end of what was read.
 */
function readNew(jhtHome: string, advance: boolean): { entries: MailboxEntry[]; stderr: string } {
  const { mailbox, cursor: cursorPath } = mailboxPaths(jhtHome);
  if (!existsSync(mailbox)) return { entries: [], stderr: "" };
  let cursor = readCursor(cursorPath);
  let size: number;
  try {
    size = statSync(mailbox).size;
  } catch {
    return { entries: [], stderr: "" };
  }
  if (cursor > size) cursor = 0;
  const raw = readFileSync(mailbox).subarray(cursor);
  const newOffset = cursor + raw.length;
  const entries: MailboxEntry[] = [];
  for (const line of raw.toString("utf8").split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      entries.push(JSON.parse(trimmed) as MailboxEntry);
    } catch {
      continue;
    }
  }
  return { entries, stderr: advance ? writeCursor(cursorPath, newOffset) : "" };
}

/** Python's `str()` of a value read from JSON, which is what the f-strings print. */
const asText = (value: unknown, fallback: string): string => (value === undefined ? fallback : String(value));

/** `bridge_mailbox.py [drain|peek|status|reset]`, the words and the bytes of the script. */
export function bridgeMailbox(args: string[], options: SentinelOptions): ScriptResult {
  const command = args.length > 0 ? args[0]! : "drain";
  const { mailbox, cursor: cursorPath } = mailboxPaths(options.jhtHome);
  if (command === "drain" || command === "peek") {
    const { entries, stderr } = readNew(options.jhtHome, command === "drain");
    if (entries.length === 0) {
      return { stdout: command === "drain" ? "[bridge_mailbox] no pending verdicts\n" : "[bridge_mailbox] no pending verdicts (peek)\n", stderr, exitCode: 0 };
    }
    const lines = entries.map((entry) =>
      command === "drain"
        ? asText(entry.msg, "")
        : `[${asText(entry.ts, "?")}] ${pyPad(asText(entry.kind, "?"), 7, ">")} ${entry.delivered_via_tmux ? "✓tmux" : "✗tmux"} | ${asText(entry.msg, "")}`,
    );
    return { stdout: `${lines.join("\n")}\n`, stderr, exitCode: 0 };
  }
  if (command === "status") {
    if (!existsSync(mailbox)) return { stdout: "mailbox: missing | pending: 0 | total: 0\n", exitCode: 0 };
    const cursor = readCursor(cursorPath);
    let size = 0;
    try {
      size = statSync(mailbox).size;
    } catch {
      size = 0;
    }
    // The script counts LINES of the file, not entries: a blank or broken line
    // is still a line here, and saying otherwise would make the two disagree
    // exactly when the file is the one worth looking at.
    const buffer = readFileSync(mailbox);
    const countLines = (from: number): number => {
      const text = buffer.subarray(from).toString("utf8");
      if (text === "") return 0;
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      return lines.length;
    };
    return {
      stdout: `mailbox: ${mailbox} | size: ${size}b | cursor: ${cursor}b | total: ${countLines(0)} | pending: ${countLines(Math.min(cursor, buffer.length))}\n`,
      exitCode: 0,
    };
  }
  if (command === "reset") {
    const stderr = writeCursor(cursorPath, 0);
    return { stdout: "[bridge_mailbox] cursor reset to 0 (the next drain will read everything again)\n", stderr, exitCode: 0 };
  }
  return { stdout: "usage: bridge_mailbox.py [drain|peek|status|reset]\n", exitCode: 2 };
}

// ── burn_intent (the read side) ──────────────────────────────────────────

/** The brakes that do not yield even under the person's derogation. */
export const NEVER_YIELDS = ["weekly-halt", "host_agent_cap", "SC-09", "freeze_team"] as const;

export interface BurnIntentStatus {
  active: boolean;
  state: "off" | "active" | "expired";
  expires_at: string | null;
  remaining_min: number | null;
  reason: string | null;
  granted_at: string | null;
  granted_by: string | null;
  hours: number | null;
}

const OFF: BurnIntentStatus = {
  active: false,
  state: "off",
  expires_at: null,
  remaining_min: null,
  reason: null,
  granted_at: null,
  granted_by: null,
  hours: null,
};

/**
 * `_parse_ts`: an ISO timestamp, naive read as UTC. Anything else is `null`,
 * which the caller turns into "no derogation" — the fail-closed path.
 */
function parseTs(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = match;
  const ms = frac ? Number.parseInt(frac.padEnd(3, "0").slice(0, 3), 10) : 0;
  let offset = 0;
  if (zone && zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const [zh, zm] = zone.slice(1).replace(":", "").match(/\d{2}/g) ?? ["0", "0"];
    offset = sign * (Number.parseInt(zh!, 10) * 60 + Number.parseInt(zm!, 10));
  }
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"), ms);
  const when = new Date(utc - offset * 60_000);
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * Whether the flag wrote `hours` as a float. `json.load` keeps the two apart
 * — `5` is an int, `5.0` a float — and `json.dumps` prints them apart again,
 * while `JSON.parse` gives the same number for both. The grant writes a float
 * (argparse `type=float`), but a flag edited by hand can carry either, and
 * this is a status line two sides compare byte for byte.
 */
function hoursIsFloat(raw: string): boolean {
  const match = /"hours"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw);
  return match !== null && /[.eE]/.test(match[1]!);
}

/** `read()`: the flag's payload, or nothing at all — the four ways it can be nothing are one answer. */
function readFlag(jhtHome: string): { data: Record<string, unknown>; raw: string } | null {
  let raw: string;
  try {
    raw = readFileSync(join(jhtHome, ".burn-intent.flag"), "utf8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  // No expiry is not a derogation: it is exactly the file left switched on
  // that this module exists not to reproduce.
  if (parseTs((data as Record<string, unknown>)["expires_at"]) === null) return null;
  return { data: data as Record<string, unknown>, raw };
}

const str = (value: unknown): string | null => (value === undefined ? null : (value as string | null));

/** `status()`: what the flag says now, fail-closed. */
export function burnIntentStatus(options: SentinelOptions): BurnIntentStatus {
  const flag = readFlag(options.jhtHome);
  if (flag === null) return { ...OFF };
  const { data } = flag;
  const expires = parseTs(data["expires_at"])!;
  const remaining = (expires.getTime() - (options.now?.() ?? new Date()).getTime()) / 1000;
  const active = remaining > 0;
  return {
    active,
    state: active ? "active" : "expired",
    expires_at: str(data["expires_at"]),
    remaining_min: active ? Math.floor(remaining / 60) : 0,
    reason: str(data["reason"]),
    granted_at: str(data["granted_at"]),
    granted_by: str(data["granted_by"]),
    hours: (data["hours"] ?? null) as number | null,
  };
}

/** `banner()`: the one line the bridges and the prompts quote. Empty when there is no derogation. */
export function burnIntentBanner(options: SentinelOptions): string {
  const st = burnIntentStatus(options);
  if (!st.active) return "";
  const reason = st.reason || "no reason provided";
  return (
    `BURN-INTENT ATTIVO — user override for spending automation, ` +
    `expires in ${st.remaining_min} min (${st.expires_at}); ` +
    `reason: ${reason}. Safeguards still active: ${NEVER_YIELDS.join(", ")}.`
  );
}

/** `burn_intent.py status [--json]`. The other three subcommands are the person's. */
export function burnIntent(args: string[], options: SentinelOptions): ScriptResult {
  const command = args[0];
  if (command === "grant" || command === "revoke" || command === "sweep") {
    return {
      stdout: "",
      stderr:
        `\`burn_intent ${command}\` is the person's, not an agent's: they grant and revoke it with \`jht burn on|off\` ` +
        `(sentinella.md RULE #0 — \`status\` is a read). Nothing was changed. Read the state with \`burn_intent status --json\`.\n`,
      exitCode: 2,
    };
  }
  if (command !== "status") return refused("burn_intent", command, ["status"]);
  const rest = args.slice(1);
  const unknown = rest.find((word) => word !== "--json");
  if (unknown !== undefined) {
    return { stdout: "", stderr: `burn_intent status: unrecognized arguments: ${rest.join(" ")}\n`, exitCode: 2 };
  }
  const st = burnIntentStatus(options);
  if (rest.includes("--json")) {
    // `json.dumps(st, ensure_ascii=False)`: a reason written in the person's
    // own alphabet stays in it, and `hours` is a float on both sides (5.0,
    // never 5) because the flag is written by `--hours`, a `type=float`.
    const flag = readFlag(options.jhtHome);
    const asFloat = flag !== null && hoursIsFloat(flag.raw);
    const asJson = { ...st, hours: st.hours === null || !asFloat ? st.hours : { value: st.hours, declared: "REAL" } };
    return { stdout: `${pyJson(asJson, { ensureAscii: false })}\n`, exitCode: 0 };
  }
  if (st.active) return { stdout: `${burnIntentBanner(options)}\n`, exitCode: 0 };
  return { stdout: "BURN-INTENT off — spending automation is active (default behavior).\n", exitCode: 0 };
}

// ── the tools ────────────────────────────────────────────────────────────

export function createSentinelTools(options: SentinelOptions): ToolHandler[] {
  return [
    argvTool({
      name: "bridge_mailbox",
      script: "bridge_mailbox.py",
      description:
        "The pacing bridge's verdicts that no pane received. `drain` prints the new ones and moves the cursor, " +
        "`peek` shows them without moving it, `status` counts pending against total, `reset` rereads everything. " +
        "Drain it at the start of your turn: a verdict lost on the way is still here.",
      run: (args) => bridgeMailbox(args, options),
    }),
    argvTool({
      name: "burn_intent",
      script: "burn_intent.py",
      description:
        "Whether the person has suspended the daily spending ceiling: `status --json` gives `active`. " +
        "Read it once, in the turn where you would send a daily brake, and never from memory. " +
        "It fails closed — missing or unreadable answers `active: false` — and `grant`/`revoke` are the person's.",
      run: (args) => burnIntent(args, options),
    }),
  ];
}
