/**
 * `npm run monitor -- --dashboard` — the team on one screen, redrawn every second.
 *
 * The follow view prints every event of every run, which is what you want for
 * one agent and a wall of text for a team. This is the other view: one row per
 * agent — what it is doing now, its round, its tools, its tokens, its spend
 * against its run's cap — the launcher's piggy bank above them, and the last
 * events below, so a live run can be watched as it goes (B-02).
 *
 * Two rules, and every number on screen keeps them:
 * - read-only: it tails the trace files `npm run monitor` reads and nothing
 *   else. It holds no token and asks the hub nothing;
 * - a figure the trace does not carry is shown as `—`, never estimated. The
 *   spend is the run's own total as its last round wrote it; the piggy bank is
 *   the last `left_usd` the hub answered the CAPITANO, with how old that answer
 *   is; the piggy bank's size and the key proxy's ceiling are not in any trace,
 *   so they stay empty until a trace carries them.
 */

import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { stdout } from "node:process";

import type { TraceLine } from "../core/trace.ts";
import { c, dur, int, usd, width } from "./render.ts";
import { Tail } from "./tail.ts";

/** A run with no event for this long has stopped writing: a live one samples its process every 5 s. */
export const SILENT_MS = 15_000;
/** How many of the latest events the feed keeps. */
const FEED_MAX = 200;

type Final = { kind: "completed" | "stopped" } | { kind: "failed"; code: string };

interface RunState {
  agent: string;
  runId: string;
  model?: string;
  budgetUsd?: number;
  maxWebSearches?: number;
  lastAt?: number;
  final?: Final;
  /** Model calls in the run, as the last round (or the end) counted them. */
  steps?: number;
  /** The run's spend, and the round that wrote it: tokens and searches, as the guardrails charged them. */
  spentUsd?: number;
  spentAsOf?: string;
  webSearches?: number;
  tokIn: number;
  tokOut: number;
  toolsDone: number;
  toolsBad: number;
  tools: Map<string, { name: string; summary: string; agent?: string | undefined; since: number }>;
  /** Model calls in flight, by the (sub)agent making them; "" is the main agent. */
  rounds: Map<string, { round: number; since: number }>;
  /** Between two turns: the last reply's end. */
  idleSince?: number;
}

interface FeedLine {
  at: number;
  agent: string;
  text: string;
}

/** What the hub last told the CAPITANO about the piggy bank. */
interface Purse {
  leftUsd: number;
  session?: string;
  agent: string;
  tool: string;
  at: number;
}

const SPAWN_TOOLS = new Set(["spawn_agent", "stop_agent", "list_agents"]);

export class Board {
  readonly #runs = new Map<string, RunState>();
  readonly #feed: FeedLine[] = [];
  #purse: Purse | undefined;

  /** The run of `agent` that `runId` names becomes that agent's row; a newer run replaces an older one. */
  handle(agent: string, record: TraceLine): void {
    let run = this.#runs.get(agent);
    if (!run || run.runId !== record.runId) {
      if (run && run.runId > record.runId) return;
      run = { agent, runId: record.runId, tokIn: 0, tokOut: 0, toolsDone: 0, toolsBad: 0, tools: new Map(), rounds: new Map() };
      this.#runs.set(agent, run);
    }
    const at = Date.parse(record.ts);
    run.lastAt = at;
    const feed = (text: string) => {
      this.#feed.push({ at, agent, text });
      if (this.#feed.length > FEED_MAX) this.#feed.splice(0, this.#feed.length - FEED_MAX);
    };

    switch (record.type) {
      case "run_started":
        run.model = record.modelId;
        run.budgetUsd = record.budgetUsd;
        if (typeof record.limits["maxWebSearches"] === "number") run.maxWebSearches = record.limits["maxWebSearches"];
        feed(`${c.green("▶")} started · ${record.providerId}/${record.modelId} · run cap ${usd(record.budgetUsd)}`);
        return;
      case "message_in":
        if (record.from === "person") feed(`${c.green("❯ person:")} ${oneLine(record.text)}`);
        return;
      case "turn_started":
        delete run.idleSince;
        return;
      case "round_started":
        run.rounds.set(record.agent ?? "", { round: record.round, since: at });
        return;
      case "round_finished":
        run.rounds.delete(record.agent ?? "");
        run.tokIn += record.usage.inputTokens;
        run.tokOut += record.usage.outputTokens;
        run.steps = record.run.steps;
        run.spentUsd = record.run.costUsd;
        run.spentAsOf = `round ${record.run.steps}`;
        run.webSearches = record.run.webSearches;
        return;
      case "tool_started":
        run.tools.set(record.callId, { name: record.name, summary: record.summary, agent: record.agent, since: at });
        feed(`${c.yellow("⚙")} ${sub(record.agent)}${record.name} ${c.dim(oneLine(record.summary))}`);
        return;
      case "tool_finished": {
        run.tools.delete(record.callId);
        run.toolsDone += 1;
        const ok = record.outcome === "accepted";
        if (!ok) run.toolsBad += 1;
        const mark = ok ? c.green("✓") : record.outcome === "denied" ? c.yellow("⊘") : c.red("✗");
        let text = `${mark} ${sub(record.agent)}${record.name} ${c.dim(dur(record.durationMs))}${ok ? "" : ` ${record.outcome}`}`;
        if (SPAWN_TOOLS.has(record.name)) {
          const answer = hubAnswer(record.result);
          if (answer.leftUsd !== undefined) {
            this.#purse = { leftUsd: answer.leftUsd, agent, tool: record.name, at, ...(answer.session ? { session: answer.session } : {}) };
          }
          text += ` ${c.dim("→")} ${answer.headline}`;
        }
        feed(text);
        return;
      }
      case "tool_permission":
        if (!record.allowed) feed(`${c.yellow("⊘")} ${sub(record.agent)}${record.name} refused by permissions (${record.mode})`);
        return;
      case "agent_started":
        feed(`${c.cyan("⎇")} subagent ${record.agent} started`);
        return;
      case "agent_finished":
        run.rounds.delete(record.agent);
        feed(`${c.cyan("⎇")} subagent ${record.agent} ${record.ok ? "reported" : "gave up"} after ${record.rounds} rounds`);
        return;
      case "turn_finished":
        run.idleSince = at;
        run.rounds.clear();
        feed(`${c.cyan("◀")} ${oneLine(record.text) || c.dim("(no text)")}`);
        return;
      case "run_finished":
        run.final = { kind: record.reason };
        run.steps = record.steps;
        run.spentUsd = record.costUsd;
        run.spentAsOf = "end";
        if (record.webSearches !== undefined) run.webSearches = record.webSearches;
        run.tools.clear();
        run.rounds.clear();
        feed(`${record.reason === "completed" ? c.cyan("■") : c.dim("■")} ${record.reason} · ${usd(record.costUsd)}`);
        return;
      case "run_failed":
        run.final = { kind: "failed", code: record.code };
        run.tools.clear();
        run.rounds.clear();
        feed(`${c.red("✗")} failed: ${record.code} ${c.dim(oneLine(record.message))}`);
        return;
      default:
        return;
    }
  }

  /** The screen at `now`, as lines at most `cols` wide, and at most `rows` of them. */
  frame(now: number, size: { cols: number; rows: number }, header: string): string[] {
    const cols = Math.max(60, size.cols);
    const out: string[] = [];
    out.push(clipTo(`${c.bold(" JHT team · live")} ${c.dim(new Date(now).toLocaleTimeString("it-IT"))}  ${c.dim(header)}`, cols));
    out.push("");

    // The piggy bank: only what the hub said, and when.
    const p = this.#purse;
    out.push(
      clipTo(
        ` ${c.bold("PIGGY BANK")}  left ${p ? c.bold(usd(p.leftUsd)) : BLANK} of ${BLANK}` +
          c.dim(p ? `   hub's answer to ${p.agent} · ${p.tool} · ${dur(now - p.at)} ago${p.session ? ` · session ${p.session}` : ""}` : "   no answer from the hub in any trace yet") +
          c.dim(" · its size is not in the trace"),
        cols,
      ),
    );
    out.push(clipTo(` ${c.bold("KEY PROXY")}   ceiling ${BLANK}${c.dim("   the key proxy's ceiling and count are not in the trace")}`, cols));
    out.push("");

    const runs = [...this.#runs.values()].sort((a, b) => a.agent.localeCompare(b.agent));
    const head = ["AGENT", "STATE", "NOW", "ROUND", "TOOLS", "SEARCH", "TOK IN", "TOK OUT", "SPENT / RUN CAP"];
    const rows = runs.map((r) => this.#row(r, now));
    const fixed = [0, 1, 3, 4, 5, 6, 7, 8].map((i) => Math.max(width(head[i]!), ...rows.map((row) => width(row[i]!))));
    const nowWidth = Math.max(16, cols - 1 - fixed.reduce((a, b) => a + b, 0) - 2 * (head.length - 1));
    const widths = head.map((h, i) => (i === 2 ? nowWidth : Math.max(width(h), ...rows.map((row) => width(row[i]!)))));
    const right = new Set([3, 6, 7]);
    const line = (cells: string[]) =>
      clipTo(` ${cells.map((s, i) => fit(s, widths[i]!, right.has(i))).join("  ")}`, cols);
    out.push(line(head.map((h) => c.bold(h))));
    if (rows.length === 0) out.push(c.dim(" no agent has written a trace in this window yet"));
    for (const row of rows) out.push(line(row));
    out.push("");

    out.push(c.dim(` ── last events ${"─".repeat(Math.max(0, cols - 18))}`));
    const room = Math.max(3, size.rows - out.length - 1);
    for (const f of this.#feed.slice(-room)) {
      out.push(clipTo(` ${c.dim(new Date(f.at).toLocaleTimeString("it-IT"))} ${c.bold(f.agent)} ${f.text}`, cols));
    }
    return out;
  }

  #row(r: RunState, now: number): string[] {
    let state: string;
    if (r.final?.kind === "failed") state = c.red(`✗ ${r.final.code}`);
    else if (r.final) state = r.final.kind === "completed" ? c.cyan("■ completed") : c.dim("■ stopped");
    else if (r.lastAt !== undefined && now - r.lastAt > SILENT_MS) state = c.yellow(`◌ silent ${dur(now - r.lastAt)}`);
    else state = c.green("● live");

    let doing = "";
    if (!r.final) {
      const tools = [...r.tools.values()];
      const rounds = [...r.rounds.entries()];
      if (tools.length > 0) {
        doing = tools.map((t) => `${c.yellow("⚙")} ${sub(t.agent)}${t.name} ${c.dim(`${oneLine(t.summary)} ${dur(now - t.since)}`)}`).join("  ");
      } else if (rounds.length > 0) {
        doing = rounds.map(([agent, x]) => `${c.blue("…")} ${sub(agent || undefined)}model, round ${x.round} ${c.dim(dur(now - x.since))}`).join("  ");
      } else if (r.idleSince !== undefined) {
        doing = c.dim(`turn done, waiting ${dur(now - r.idleSince)}`);
      }
    }

    const spent = r.spentUsd === undefined ? BLANK : usd(r.spentUsd);
    const cap = r.budgetUsd === undefined ? BLANK : usd(r.budgetUsd);
    const bar = r.spentUsd !== undefined && r.budgetUsd !== undefined && r.budgetUsd > 0 ? ` ${meter(r.spentUsd / r.budgetUsd)}` : "";
    return [
      c.bold(r.agent),
      state,
      doing,
      r.steps === undefined ? BLANK : int(r.steps),
      r.toolsDone + r.tools.size === 0 ? BLANK : `${int(r.toolsDone)}${r.tools.size ? c.yellow(` +${r.tools.size}`) : ""}${r.toolsBad ? c.red(` ✗${r.toolsBad}`) : ""}`,
      r.webSearches === undefined ? BLANK : `${r.webSearches}/${r.maxWebSearches ?? BLANK}`,
      r.steps === undefined ? BLANK : int(r.tokIn),
      r.steps === undefined ? BLANK : int(r.tokOut),
      `${spent} / ${cap}${bar}${r.spentAsOf ? c.dim(` @${r.spentAsOf}`) : ""}`,
    ];
  }
}

const BLANK = c.dim("—");
const COLOR = c.dim("x") !== "x";

/** Ten cells for spent / cap: two numbers the trace wrote, nothing in between. */
function meter(fraction: number): string {
  const cells = Math.min(10, Math.max(0, Math.round(fraction * 10)));
  const paint = fraction >= 0.9 ? c.red : fraction >= 0.6 ? c.yellow : c.green;
  return paint("█".repeat(cells)) + c.dim("░".repeat(10 - cells));
}

/**
 * The hub's answer to a spawn tool, as the trace kept it: its `left_usd` and
 * `session` read as written, and a headline for the feed. The trace cuts a
 * result at 4 000 characters, so the fields are found in the text rather than
 * by parsing a JSON that may have lost its end.
 */
export function hubAnswer(result: string): { leftUsd?: number; session?: string; headline: string } {
  const left = /"left_usd":\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(result)?.[1];
  const session = /"session":\s*"([^"]*)"/.exec(result)?.[1];
  const reason = /"reason":\s*"((?:[^"\\]|\\.)*)"/.exec(result)?.[1];
  const agent = /"agent":\s*"([^"]*)"/.exec(result)?.[1];
  const booked = /"booked_usd":\s*(-?\d+(?:\.\d+)?)/.exec(result)?.[1];
  const headline = /"ok":\s*false/.test(result)
    ? c.red(`refused: ${oneLine(reason ?? result)}`)
    : [agent, booked !== undefined ? `booked $${booked}` : "", left !== undefined ? `left $${left}` : ""].filter(Boolean).join(" · ") || oneLine(result);
  return { ...(left !== undefined ? { leftUsd: Number(left) } : {}), ...(session !== undefined ? { session } : {}), headline };
}

const sub = (agent: string | undefined) => (agent ? c.cyan(`${agent}: `) : "");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function fit(s: string, n: number, right: boolean): string {
  const clipped = clipTo(s, n);
  const pad = " ".repeat(Math.max(0, n - width(clipped)));
  return right ? pad + clipped : clipped + pad;
}

/** `s` cut to `n` visible characters, colour codes kept whole. */
function clipTo(s: string, n: number): string {
  if (width(s) <= n) return s;
  let seen = 0;
  let out = "";
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    const take = part.slice(0, Math.max(0, n - 1 - seen));
    out += take;
    seen += take.length;
    if (seen >= n - 1) break;
  }
  return COLOR ? `${out}\x1b[0m…` : `${out}…`;
}

/**
 * Draws the board every second until ctrl-c. Each agent's row follows its
 * newest trace file written in the last `windowMin` minutes; a new run of the
 * same agent takes its row. With `once`, or when stdout is not a terminal,
 * one frame is printed and nothing is followed.
 */
export function runDashboard(options: { logsDir: string; traceFiles: () => string[]; windowMin: number; once: boolean }): void {
  const board = new Board();
  const tails = new Map<string, Tail>();
  const header = `${options.logsDir} · runs of the last ${options.windowMin} min · ctrl-c to stop`;

  const pump = (now: number) => {
    const newest = new Map<string, string>();
    for (const file of options.traceFiles()) {
      const agent = basename(dirname(file));
      if ((newest.get(agent) ?? "") < file) newest.set(agent, file);
    }
    for (const [agent, file] of newest) {
      if (!tails.has(file)) {
        let mtime: number;
        try {
          mtime = statSync(file).mtimeMs;
        } catch {
          continue;
        }
        if (now - mtime > options.windowMin * 60_000) continue;
        tails.set(file, new Tail(file));
      }
      for (const record of tails.get(file)!.read()) board.handle(agent, record);
    }
  };

  const size = () => ({ cols: stdout.columns ?? 120, rows: stdout.rows ?? 40 });
  if (options.once || !stdout.isTTY) {
    pump(Date.now());
    for (const line of board.frame(Date.now(), size(), header)) console.log(line);
    return;
  }

  // The alternate screen, as `top` does: the terminal's scrollback is left as it was.
  stdout.write("\x1b[?1049h\x1b[?25l");
  const restore = () => stdout.write("\x1b[?25h\x1b[?1049l");
  process.on("exit", restore);
  process.on("SIGINT", () => process.exit(0));
  const draw = () => {
    const now = Date.now();
    pump(now);
    const lines = board.frame(now, size(), header).slice(0, size().rows);
    stdout.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join("\n")}\x1b[J`);
  };
  draw();
  setInterval(draw, 1_000);
}
