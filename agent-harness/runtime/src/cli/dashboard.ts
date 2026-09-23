/**
 * `npm run monitor -- --dashboard` — the team drawn on one screen, redrawn every second.
 *
 * The follow view prints every event of every run, which is what you want for
 * one agent and a wall of text for a team. This is the other view, a picture
 * to read at a glance from a tmux pane (B-02):
 * - a banner saying whether the team is working, idle, or has something wrong;
 * - the money: the piggy bank as the hub last answered the CAPITANO, and one
 *   bar split among the agents, each share as wide as its run's cap and
 *   filled as far as it has spent — how the CAPITANO divided the money;
 * - the team as a tree: who spawned whom, who writes to whom, its subagents, what each one
 *   is doing now, and every role of the product that has left no trace;
 * - the results — a new position, a score, a CV, a word to the person — each
 *   ringing the terminal's bell, which tmux shows on the window's tab;
 * - the latest events.
 * It fits whatever the pane is: full screen, or a corner of it.
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
import { roleOf } from "../db/role-policy.ts";
import { c, dur, int, usd, width } from "./render.ts";
import { Tail } from "./tail.ts";

/** A run with no event for this long has stopped writing: a live one samples its process every 5 s. */
export const SILENT_MS = 15_000;
/** How many of the latest events and results are kept. */
const FEED_MAX = 200;
/** Spend at this share of the run's cap is worth a warning. */
const CAP_WARN = 0.9;

/**
 * The product's team, in the order `jht team list` shows it
 * (cli/src/commands/team/agents.js). The image carries no `cli/`, so the list
 * is repeated here: a role on it with no trace is drawn as absent.
 */
const ROSTER = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "assistente", "mentor", "sentinella"];

const COLOR = c.dim("x") !== "x";
const fg = (n: number) => (s: string) => (COLOR ? `\x1b[38;5;${n}m${s}\x1b[39m` : s);
const bg = (n: number) => (s: string) => (COLOR ? `\x1b[48;5;${n}m\x1b[38;5;16m${s}\x1b[39m\x1b[49m` : s);
/** One colour per role, the same in every part of the screen. */
const ROLE_COLOR: Record<string, number> = {
  capitano: 220,
  scout: 45,
  analista: 75,
  scorer: 171,
  scrittore: 114,
  critico: 203,
  assistente: 229,
  mentor: 180,
  sentinella: 246,
};
const tint = (agent: string) => ROLE_COLOR[roleOf(agent)] ?? 250;

type Final = { kind: "completed" | "stopped" } | { kind: "failed"; code: string };

interface RunState {
  agent: string;
  runId: string;
  model?: string;
  budgetUsd?: number;
  maxWebSearches?: number;
  startedAt?: number;
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
  tools: Map<string, { name: string; summary: string; args: unknown; agent?: string | undefined; since: number }>;
  /** Model calls in flight, by the (sub)agent making them; "" is the main agent. */
  rounds: Map<string, { round: number; since: number }>;
  /** Between two turns: the last reply's end. */
  idleSince?: number;
  /** Peers it wrote to with `send_message`, and how many times. */
  wroteTo: Map<string, number>;
  subagents: Map<string, "running" | "reported" | "gave up">;
  warnedCap?: boolean;
}

interface FeedLine {
  at: number;
  agent: string;
  text: string;
}

type AlertKind = "result" | "warn" | "fail" | "end";
interface Alert extends FeedLine {
  kind: AlertKind;
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
  readonly #alerts: Alert[] = [];
  /** Children the hub accepted, by the agent name it gave them. */
  readonly #spawns = new Map<string, { by: string; bookedUsd?: number; at: number }>();
  #purse: Purse | undefined;
  /** Results and failures so far: a new one rings the bell. */
  bells = 0;

  /** The run of `agent` that `runId` names becomes that agent's node; a newer run replaces an older one. */
  handle(agent: string, record: TraceLine): void {
    let run = this.#runs.get(agent);
    if (!run || run.runId !== record.runId) {
      if (run && run.runId > record.runId) return;
      run = { agent, runId: record.runId, tokIn: 0, tokOut: 0, toolsDone: 0, toolsBad: 0, tools: new Map(), rounds: new Map(), wroteTo: new Map(), subagents: new Map() };
      this.#runs.set(agent, run);
    }
    const at = Date.parse(record.ts);
    run.lastAt = at;
    const feed = (text: string) => push(this.#feed, { at, agent, text });
    const alert = (kind: AlertKind, text: string) => {
      push(this.#alerts, { at, agent, kind, text });
      if (kind === "result" || kind === "fail") this.bells += 1;
    };

    switch (record.type) {
      case "run_started":
        run.model = record.modelId;
        run.budgetUsd = record.budgetUsd;
        run.startedAt = at;
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
        if (!run.warnedCap && run.budgetUsd && run.spentUsd >= CAP_WARN * run.budgetUsd) {
          run.warnedCap = true;
          alert("warn", `spent ${usd(run.spentUsd)} of its ${usd(run.budgetUsd)} cap`);
        }
        return;
      case "tool_started":
        run.tools.set(record.callId, { name: record.name, summary: record.summary, args: record.args, agent: record.agent, since: at });
        if (record.name === "send_message") {
          const to = (record.args as { to?: unknown } | null)?.to;
          if (typeof to === "string") run.wroteTo.set(to, (run.wroteTo.get(to) ?? 0) + 1);
        }
        feed(`${c.yellow("⚙")} ${sub(record.agent)}${record.name} ${c.dim(oneLine(record.summary))}`);
        return;
      case "tool_finished": {
        const call = run.tools.get(record.callId);
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
          if (record.name === "spawn_agent" && answer.refused) alert("warn", `spawn ${answer.headline}`);
          if (record.name === "spawn_agent" && answer.agent && !answer.refused) {
            this.#spawns.set(answer.agent, { by: agent, at, ...(answer.bookedUsd !== undefined ? { bookedUsd: answer.bookedUsd } : {}) });
          }
          text += ` ${c.dim("→")} ${answer.headline}`;
        } else if (ok && call) {
          const result = resultOf(record.name, call.args, call.summary);
          if (result) alert("result", result);
        }
        feed(text);
        return;
      }
      case "tool_permission":
        if (!record.allowed) {
          feed(`${c.yellow("⊘")} ${sub(record.agent)}${record.name} refused by permissions (${record.mode})`);
          alert("warn", `${record.name} refused by permissions`);
        }
        return;
      case "agent_started":
        run.subagents.set(record.agent, "running");
        feed(`${c.cyan("↳")} subagent ${record.agent} started`);
        return;
      case "agent_finished":
        run.rounds.delete(record.agent);
        run.subagents.set(record.agent, record.ok ? "reported" : "gave up");
        feed(`${c.cyan("↳")} subagent ${record.agent} ${record.ok ? "reported" : "gave up"} after ${record.rounds} rounds`);
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
        alert("end", `${record.reason} · spent ${usd(record.costUsd)}${run.budgetUsd !== undefined ? ` of ${usd(run.budgetUsd)}` : ""}`);
        return;
      case "run_failed":
        run.final = { kind: "failed", code: record.code };
        run.tools.clear();
        run.rounds.clear();
        feed(`${c.red("✗")} failed: ${record.code} ${c.dim(oneLine(record.message))}`);
        alert("fail", `failed: ${record.code}`);
        return;
      default:
        return;
    }
  }

  /** The screen at `now`: at most `rows` lines, none wider than `cols`. */
  frame(now: number, size: { cols: number; rows: number }, header: string): string[] {
    const W = Math.max(30, size.cols);
    const H = Math.max(6, size.rows);
    const out: string[] = [];
    const add = (line = "") => out.push(clipTo(line, W));

    // A tall pane gets every detail; a short one keeps, in this order, the
    // banner, the money, one line per agent and room for the results.
    const tall = H >= 30;
    const roomy = H >= 20;
    const runs = this.#ordered();
    add(this.#banner(runs, now, W));
    if (tall) add(c.dim(` ${header}`));
    if (roomy) add();

    // The money.
    const p = this.#purse;
    const purse = ` ${c.bold("PIGGY BANK")}  left ${p ? c.bold(usd(p.leftUsd)) : BLANK} of ${BLANK}`;
    const proxy = ` ${c.bold("KEY PROXY")}   ceiling ${BLANK}`;
    if (roomy && W >= 90) {
      add(
        purse +
          c.dim(p ? `  hub → ${p.agent} · ${p.tool} · ${ago(now - p.at)} ago${p.session ? ` · ${p.session}` : ""}` : "  no answer from the hub in any trace yet") +
          c.dim(" · its size is not in the trace"),
      );
      add(`${proxy}${c.dim("  the key proxy's ceiling and count are not in the trace")}`);
    } else {
      add(`${purse}${p ? c.dim(` ${ago(now - p.at)} ago`) : ""}  ${c.dim("│")}${proxy}`);
    }
    for (const line of this.#budget(runs, W, roomy)) add(line);
    if (H >= 14) add();

    // The team, leaving the results at least their title and a few lines.
    const team = this.#tree(runs, now, W, tall && W >= 80).slice(roomy ? 0 : 1);
    const rest = () => H - out.length;
    const teamRoom = Math.max(2, Math.min(team.length, rest() - (H >= 14 ? 6 : 3)));
    for (const line of team.slice(0, teamRoom - (team.length > teamRoom ? 1 : 0))) add(line);
    if (team.length > teamRoom) add(c.dim(`   … ${team.length - teamRoom + 1} more line${team.length - teamRoom + 1 === 1 ? "" : "s"}: a taller pane shows them`));
    if (rest() < 2) return out.slice(0, H);
    if (H >= 14) add();

    // Results and events: side by side when there is room, else one above the other.
    const room = rest();
    const results = this.#results(now);
    // Files are read one after another: the screen shows them in the order they happened.
    const events = [...this.#feed].sort((a, b) => a.at - b.at).map((f) => ` ${c.dim(stamp(f.at, now))} ${fg(tint(f.agent))(f.agent)} ${f.text}`);
    const resultsTitle = ` ${c.bold("RESULTS")} ${c.dim("· newest first · each rings the bell")}`;
    const eventsTitle = ` ${c.bold("EVENTS")}`;
    if (W >= 110) {
      const left = Math.floor(W * 0.45);
      const right = W - left - 3;
      const r = [resultsTitle, ...results].slice(0, room);
      const e = [eventsTitle, ...events.slice(-(room - 1))];
      for (let i = 0; i < room && (i < r.length || i < e.length); i++) {
        add(`${fit(r[i] ?? "", left, false)} ${c.dim("│")} ${clipTo(e[i] ?? "", right)}`);
      }
    } else {
      const rRoom = Math.max(2, Math.min(results.length + 1, Math.ceil(room / 2)));
      for (const line of [resultsTitle, ...results].slice(0, rRoom)) add(line);
      const eRoom = room - rRoom - 1;
      if (eRoom >= 2) {
        add(eventsTitle);
        for (const line of events.slice(-(eRoom - 1))) add(line);
      }
    }
    return out.slice(0, H);
  }

  /** Captains first, then the product's roles in their order, then any other. */
  #ordered(): RunState[] {
    const rank = (agent: string) => {
      const i = ROSTER.indexOf(roleOf(agent));
      return i < 0 ? ROSTER.length : i;
    };
    return [...this.#runs.values()].sort((a, b) => rank(a.agent) - rank(b.agent) || a.agent.localeCompare(b.agent));
  }

  #banner(runs: RunState[], now: number, W: number): string {
    const live = runs.filter((r) => !r.final && r.lastAt !== undefined && now - r.lastAt <= SILENT_MS).length;
    const silent = runs.filter((r) => !r.final && (r.lastAt === undefined || now - r.lastAt > SILENT_MS)).length;
    const failed = runs.filter((r) => r.final?.kind === "failed").length;
    const last = Math.max(0, ...runs.map((r) => r.lastAt ?? 0));
    const spent = runs.filter((r) => r.spentUsd !== undefined);
    const state =
      live > 0
        ? `● TEAM WORKING · ${live} live`
        : runs.length === 0
          ? "○ NO TRACE YET"
          : `○ TEAM IDLE · last activity ${ago(now - last)} ago`;
    const parts = [
      ` JHT · API TEAM `,
      ` ${state}${silent ? ` · ${silent} silent` : ""}${failed ? ` · ${failed} failed` : ""} `,
      spent.length ? ` spent ${usd(spent.reduce((a, r) => a + (r.spentUsd ?? 0), 0))} in ${spent.length} run${spent.length === 1 ? "" : "s"} ` : "",
    ];
    const paint = live > 0 ? bg(34) : failed || silent ? bg(214) : bg(244);
    const time = ` ${clock(now)} `;
    // The clock stays: the spend is the first thing a narrow pane gives up.
    const body = width(parts.join("")) + 10 <= W ? parts.join("") : parts.slice(0, 2).join("");
    const pad = Math.max(1, W - width(body) - time.length);
    return paint(clipTo(body + " ".repeat(pad) + time, W));
  }

  /**
   * One bar for the money the runs were given: each agent's share as wide as
   * its run's cap, filled as far as it has spent. Both are numbers the trace
   * wrote; an agent whose spend no round has written yet is drawn hatched.
   */
  #budget(runs: RunState[], W: number, legend: boolean): string[] {
    const capped = runs.filter((r) => r.budgetUsd !== undefined && r.budgetUsd > 0);
    if (capped.length === 0) return [` ${c.bold("RUN CAPS")}    ${BLANK}${c.dim("  no run has started yet")}`];
    const total = capped.reduce((a, r) => a + r.budgetUsd!, 0);
    const known = capped.filter((r) => r.spentUsd !== undefined);
    const spent = known.reduce((a, r) => a + r.spentUsd!, 0);
    const title =
      ` ${c.bold("RUN CAPS")}    ${usd(total)} given to ${capped.length} run${capped.length === 1 ? "" : "s"} · ${usd(spent)} spent` +
      (known.length < capped.length ? c.dim(` (${capped.length - known.length} not reported yet)`) : "");
    const barWidth = Math.max(capped.length, W - 4);
    // Every share gets at least one cell; the rest follow the caps.
    const cells = capped.map((r) => Math.max(1, Math.floor((r.budgetUsd! / total) * barWidth)));
    for (let i = 0; cells.reduce((a, b) => a + b, 0) < barWidth; i = (i + 1) % cells.length) cells[i]! += 1;
    while (cells.reduce((a, b) => a + b, 0) > barWidth) {
      const i = cells.indexOf(Math.max(...cells));
      cells[i]! -= 1;
    }
    let bar = "";
    let names = "";
    capped.forEach((r, i) => {
      const n = cells[i]!;
      const paint = fg(tint(r.agent));
      if (r.spentUsd === undefined) {
        bar += paint("╌".repeat(n));
      } else {
        const full = Math.min(n, Math.round((r.spentUsd / r.budgetUsd!) * n));
        bar += paint("█".repeat(full)) + (COLOR ? paint(c.dim("░".repeat(n - full))) : "░".repeat(n - full));
      }
      if (!COLOR && i < capped.length - 1) bar = `${bar.slice(0, -1)}|`;
      names += paint(fit(`${r.agent} $${Number(r.budgetUsd!.toFixed(4))}`, Math.max(1, n - 1), false)) + (n > 1 ? " " : "");
    });
    return legend ? [title, `  ${bar}`, `  ${names}`] : [title, `  ${bar}`];
  }

  /**
   * The team as a tree: every run a node, a child the CAPITANO spawned under
   * it, a spawn the hub accepted whose child has written nothing yet as a
   * booking, and the product's roles with no trace on one line at the end.
   */
  #tree(runs: RunState[], now: number, W: number, details: boolean): string[] {
    const lines: string[] = [` ${c.bold("TEAM")} ${c.dim("· ├─▶ spawned by · ✉ wrote to · ↳ subagents")}`];
    const parentOf = (agent: string) => {
      const by = this.#spawns.get(agent)?.by;
      return by !== undefined && this.#runs.has(by) ? by : undefined;
    };
    const nameWidth = Math.max(8, ...runs.map((r) => r.agent.length), ...[...this.#spawns.keys()].map((a) => a.length)) + 2;

    const node = (r: RunState, lead: string, stem: string) => {
      const badge = bg(tint(r.agent))(` ${r.agent} `.padEnd(nameWidth));
      const spent = r.spentUsd === undefined ? BLANK : usd(r.spentUsd);
      const cap = r.budgetUsd === undefined ? BLANK : usd(r.budgetUsd);
      const meterWidth = W >= 100 ? 12 : W >= 70 ? 8 : 0;
      const gauge = meterWidth && r.budgetUsd ? `${meter(r.spentUsd, r.budgetUsd, meterWidth, tint(r.agent))} ` : "";
      const money = `${spent} / ${cap}${r.spentAsOf ? c.dim(` @${r.spentAsOf}`) : ""}`;
      lines.push(`${lead}${badge} ${fit(stateOf(r, now), 14, false)} ${gauge}${money}   ${doingOf(r, now)}`);
      if (!details) return;
      const facts = [
        r.steps === undefined ? "" : `round ${int(r.steps)}`,
        r.toolsDone + r.tools.size === 0 ? "" : `${int(r.toolsDone)} tool${r.toolsDone === 1 ? "" : "s"}${r.tools.size ? ` +${r.tools.size} running` : ""}${r.toolsBad ? c.red(` ✗${r.toolsBad}`) : ""}`,
        r.webSearches === undefined ? "" : `search ${r.webSearches}/${r.maxWebSearches ?? "—"}`,
        r.steps === undefined ? "" : `${int(r.tokIn)} in / ${int(r.tokOut)} out tok`,
        r.model ?? "",
      ].filter(Boolean);
      const wrote = [...r.wroteTo].map(([to, n]) => `${fg(tint(to))(to)}${n > 1 ? c.dim(` ×${n}`) : ""}`);
      const subs = [...r.subagents].map(([name, state]) => `${name}${state === "running" ? "" : c.dim(` ${state}`)}`);
      const edges = [wrote.length ? `✉ → ${wrote.join(", ")}` : "", subs.length ? `↳ ${subs.join(", ")}` : ""].filter(Boolean);
      lines.push(`${stem}${" ".repeat(nameWidth + 1)}${c.dim(facts.join(" · "))}${edges.length ? `   ${edges.join("   ")}` : ""}`);
    };

    for (const top of runs.filter((r) => parentOf(r.agent) === undefined)) {
      node(top, " ", " ");
      const children = runs.filter((r) => parentOf(r.agent) === top.agent);
      const booked = [...this.#spawns].filter(([child, s]) => s.by === top.agent && !this.#runs.has(child));
      const all = [...children.map((r) => ({ r })), ...booked.map(([child, s]) => ({ child, s }))];
      all.forEach((item, i) => {
        const lastOne = i === all.length - 1;
        const lead = c.dim(lastOne ? " └─▶ " : " ├─▶ ");
        const stem = c.dim(lastOne ? "     " : " │   ");
        if ("r" in item) node(item.r, lead, stem);
        else {
          const badge = bg(tint(item.child))(` ${item.child} `.padEnd(nameWidth));
          lines.push(`${lead}${badge} ${c.dim(`booked ${item.s.bookedUsd !== undefined ? usd(item.s.bookedUsd) : "—"} ${ago(now - item.s.at)} ago · no trace yet`)}`);
        }
      });
    }

    if (runs.length === 0) lines.push(` ${c.dim("waiting for the first trace: a run that starts shows up here by itself")}`);
    const seen = new Set(runs.map((r) => roleOf(r.agent)));
    const absent = ROSTER.filter((role) => !seen.has(role));
    if (absent.length) lines.push(` ${c.dim("○ no trace here:")} ${absent.map((role) => fg(ROLE_COLOR[role] ?? 250)(role)).join(c.dim(" · "))}`);
    return lines;
  }

  #results(now: number): string[] {
    if (this.#alerts.length === 0) {
      return [c.dim("  nothing yet: a new position, a score, a CV, a word to the person, a failure")];
    }
    const glyph: Record<AlertKind, string> = { result: c.green("✦"), warn: c.yellow("▲"), fail: c.red("✗"), end: c.cyan("■") };
    return [...this.#alerts].sort((a, b) => b.at - a.at).map((a) => ` ${glyph[a.kind]} ${c.dim(now - a.at < 3_600_000 ? `${ago(now - a.at)} ago` : stamp(a.at, now))} ${fg(tint(a.agent))(a.agent)} ${a.text}`);
  }
}

const BLANK = c.dim("—");

function push<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > FEED_MAX) list.splice(0, list.length - FEED_MAX);
}

function stateOf(r: RunState, now: number): string {
  if (r.final?.kind === "failed") return c.red(`✗ ${r.final.code}`);
  if (r.final) return r.final.kind === "completed" ? c.cyan("■ completed") : c.dim("■ stopped");
  if (r.lastAt !== undefined && now - r.lastAt > SILENT_MS) return c.yellow(`◌ silent ${ago(now - r.lastAt)}`);
  return c.green("● live");
}

function doingOf(r: RunState, now: number): string {
  if (r.final) return r.lastAt === undefined ? "" : c.dim(`ended ${ago(now - r.lastAt)} ago`);
  const tools = [...r.tools.values()];
  if (tools.length > 0) return tools.map((t) => `${c.yellow("⚙")} ${sub(t.agent)}${t.name} ${c.dim(`${oneLine(t.summary)} ${ago(now - t.since)}`)}`).join("  ");
  const rounds = [...r.rounds.entries()];
  if (rounds.length > 0) return rounds.map(([agent, x]) => `${c.blue("…")} ${sub(agent || undefined)}model, round ${x.round} ${c.dim(ago(now - x.since))}`).join("  ");
  if (r.idleSince !== undefined) return c.dim(`turn done, waiting ${ago(now - r.idleSince)}`);
  return "";
}

/** `width` cells for spent / cap: two numbers the trace wrote, nothing in between. Hatched while no round has written the spend. */
function meter(spent: number | undefined, cap: number, cells: number, colour: number): string {
  if (spent === undefined) return c.dim("╌".repeat(cells));
  const fraction = spent / cap;
  const full = Math.min(cells, Math.max(0, Math.round(fraction * cells)));
  const paint = fraction >= CAP_WARN ? c.red : fraction >= 0.6 ? c.yellow : fg(colour);
  return paint("█".repeat(full)) + c.dim("░".repeat(cells - full));
}

/**
 * The line a result earns, or nothing: what the team made for the person, as
 * the tool call that made it names it. Only accepted calls get here.
 */
export function resultOf(name: string, args: unknown, summary: string): string | undefined {
  const argv = Array.isArray((args as { args?: unknown } | null)?.args) ? ((args as { args: unknown[] }).args.map(String)) : [];
  const flag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const text = (args as { text?: unknown; message?: unknown } | null) ?? {};
  switch (name) {
    case "db_insert":
      if (argv[0] !== "position") return undefined;
      return `new position: ${flag("--title") ?? "?"}${flag("--company") ? ` @ ${flag("--company")}` : ""}`;
    case "db_update": {
      if (argv[0] !== "position") return undefined;
      const changes = ["--status", "--score", "--total-score"].flatMap((f) => (flag(f) !== undefined ? [`${f.slice(2)} ${flag(f)}`] : []));
      return changes.length ? `position ${argv[1] ?? "?"}: ${changes.join(", ")}` : undefined;
    }
    case "save_review":
      return `review saved ${c.dim(oneLine(summary))}`;
    case "notify_user":
    case "chat_reply": {
      const said = typeof text.text === "string" ? text.text : typeof text.message === "string" ? text.message : summary;
      return `to the person: ${oneLine(said)}`;
    }
    case "write_file": {
      const path = (args as { path?: unknown } | null)?.path;
      return typeof path === "string" && /(^|\/)(cv|critiche)\//.test(path) ? `file written: ${path.split("/").slice(-2).join("/")}` : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The hub's answer to a spawn tool, as the trace kept it: its `left_usd` and
 * `session` read as written, and a headline for the feed. The trace cuts a
 * result at 4 000 characters, so the fields are found in the text rather than
 * by parsing a JSON that may have lost its end.
 */
export function hubAnswer(result: string): { leftUsd?: number; session?: string; agent?: string; bookedUsd?: number; refused: boolean; headline: string } {
  const left = /"left_usd":\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/.exec(result)?.[1];
  const session = /"session":\s*"([^"]*)"/.exec(result)?.[1];
  const reason = /"reason":\s*"((?:[^"\\]|\\.)*)"/.exec(result)?.[1];
  const agent = /"agent":\s*"([^"]*)"/.exec(result)?.[1];
  const booked = /"booked_usd":\s*(-?\d+(?:\.\d+)?)/.exec(result)?.[1];
  const refused = /"ok":\s*false/.test(result);
  const headline = refused
    ? c.red(`refused: ${oneLine(reason ?? result)}`)
    : [agent, booked !== undefined ? `booked $${booked}` : "", left !== undefined ? `left $${left}` : ""].filter(Boolean).join(" · ") || oneLine(result);
  return {
    ...(left !== undefined ? { leftUsd: Number(left) } : {}),
    ...(session !== undefined ? { session } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(booked !== undefined ? { bookedUsd: Number(booked) } : {}),
    refused,
    headline,
  };
}

const sub = (agent: string | undefined) => (agent ? c.cyan(`${agent}: `) : "");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const clock = (at: number) => new Date(at).toLocaleTimeString("it-IT");
/** The time of an event, with its day when it was not today. */
const stamp = (at: number, now: number) =>
  new Date(at).toDateString() === new Date(now).toDateString() ? clock(at) : `${new Date(at).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })} ${clock(at)}`;

/** An elapsed time as a person says it: seconds and minutes as the monitor writes them, then hours, then days. */
export function ago(ms: number): string {
  if (ms < 3_600_000) return dur(ms);
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

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
 * Draws the board every second, and at once when the pane is resized, until
 * ctrl-c. Each agent's node follows its newest trace file, however old: an
 * idle team shows how its last session went. With `windowMin`, a file older
 * than that is left out. A new result or failure rings the bell,
 * which tmux marks on the window. With `once`, or when stdout is not a
 * terminal, one frame is printed and nothing is followed.
 */
export function runDashboard(options: { logsDir: string; traceFiles: () => string[]; windowMin?: number; once: boolean; bell?: boolean }): void {
  const board = new Board();
  const tails = new Map<string, Tail>();
  const header = `${options.logsDir} · ${options.windowMin ? `runs of the last ${options.windowMin} min` : "each agent's latest run"} · ctrl-c to stop`;

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
        if (options.windowMin && now - mtime > options.windowMin * 60_000) continue;
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
  // What is already in the traces is history: only what arrives from now on rings.
  pump(Date.now());
  let rung = board.bells;
  const draw = () => {
    const now = Date.now();
    pump(now);
    const lines = board.frame(now, size(), header);
    const bell = options.bell !== false && board.bells > rung ? "\x07" : "";
    rung = board.bells;
    stdout.write(`${bell}\x1b[H${lines.map((l) => `${l}\x1b[K`).join("\n")}\x1b[J`);
  };
  draw();
  setInterval(draw, 1_000);
  stdout.on("resize", draw);
}
