/**
 * `npm run monitor -- --dashboard` — the team on one screen, a TUI to watch it work.
 *
 * The follow view prints every event of every run, which is what you want for
 * one agent and a wall of text for a team. This is the other view, read at a
 * glance from a tmux pane (B-02), in three pages the arrows move between:
 * - AGENTS: every role of the product, always, in the same place — a role
 *   with no trace is a row switched off, not a row missing. Each agent shows
 *   its state, its activity over the last minutes, its spend against its
 *   run's cap, what it is doing now, and who spawned it;
 * - RESULTS: what the team made for the person — a position, a score, a CV,
 *   a word to them — and what went wrong, each result ringing the bell tmux
 *   marks on the window; the latest events below;
 * - MONEY: the piggy bank as the hub last answered the CAPITANO, the key
 *   proxy, one bar splitting the money among the runs, each run's spend over
 *   time against its cap, the waits on a 429, and every answer the launcher
 *   gave the CAPITANO, refusals included.
 * It fits whatever the pane is, full screen or a corner of it.
 *
 * Emoji only where they were measured to take two cells both in tmux 3.6 and
 * in Terminal.app, and only to say in one glyph what would take a word. The
 * roles' own emoji (👨‍✈️, 🕵️…) are joined sequences Terminal.app draws four
 * or five cells wide where tmux counts two, so the roles keep coloured badges.
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
import { stdin, stdout } from "node:process";

import type { TraceLine } from "../core/trace.ts";
import { roleOf } from "../db/role-policy.ts";
import { c, dur, int, usd } from "./render.ts";
import { hubAccess, onStartKey, readStarts, readTeamPlan, startAndRecord, startPageLines, startsFile, type StartStep } from "./start-page.ts";
import { Tail } from "./tail.ts";

/** A run with no event for this long has stopped writing: a live one samples its process every 5 s. */
export const SILENT_MS = 15_000;
/** How many of the latest events and results are kept. */
const FEED_MAX = 300;
/** Spend at this share of the run's cap is worth a warning. */
const CAP_WARN = 0.9;
/** One cell of an activity or spend line. */
export const SPARK_CELL_MS = 15_000;

/**
 * The product's team, in the order `jht team list` shows it
 * (cli/src/commands/team/agents.js). The image carries no `cli/`, so the list
 * is repeated here. It is the fixed frame of the AGENTS page.
 */
const ROSTER = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "assistente", "mentor", "sentinella"];

export const PAGES = ["agents", "results", "money", "start"] as const;
export type Page = (typeof PAGES)[number];
const PAGE_TITLE: Record<Page, string> = { agents: "🟢 AGENTS", results: "🔔 RESULTS", money: "💰 MONEY", start: "▶ START" };

const COLOR = c.dim("x") !== "x";
const fg = (n: number) => (s: string) => (COLOR ? `\x1b[38;5;${n}m${s}\x1b[39m` : s);
const bg = (n: number) => (s: string) => (COLOR ? `\x1b[48;5;${n}m\x1b[38;5;16m${s}\x1b[39m\x1b[49m` : s);
const inverse = (s: string) => (COLOR ? `\x1b[7m${s}\x1b[27m` : `[${s}]`);
/** One colour per role, the same on every page. */
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
  lastAt?: number;
  final?: Final;
  /** Model calls in the run, as the last round (or the end) counted them. */
  steps?: number;
  /** The run's spend, and the round that wrote it: tokens and searches, as the guardrails charged them. */
  spentUsd?: number;
  spentAsOf?: string;
  /** Every spend the run wrote, with when: its line on the MONEY page. */
  spendSeries: Array<{ at: number; usd: number }>;
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
  /** When it did something: every event but the process samples, which tick when it does nothing. */
  activity: number[];
  /** Rounds that waited out a 429, and the time they waited, as the rounds wrote them. */
  backoffRounds: number;
  backoffWaitedMs: number;
  warnedCap?: boolean;
}

interface FeedLine {
  at: number;
  agent: string;
  text: string;
}

export type AlertKind = "position" | "update" | "review" | "file" | "person" | "end" | "failed" | "refused" | "cap";
/** One glyph per kind of result or warning. */
const ALERT_ICON: Record<AlertKind, string> = {
  position: "🆕",
  update: "🧾",
  review: "📨",
  file: "📄",
  person: "💬",
  end: "🏁",
  failed: "🔴",
  refused: "🚫",
  cap: "💸",
};
/** What the team made for the person, and a run that failed: these ring. */
const RINGS = new Set<AlertKind>(["position", "update", "review", "file", "person", "failed"]);

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

/** One answer of the launcher to a `spawn_agent`, as the CAPITANO's trace kept it. */
interface Decision {
  at: number;
  by: string;
  asked: string;
  refused: boolean;
  agent?: string;
  bookedUsd?: number;
  leftUsd?: number;
  reason?: string;
}

const SPAWN_TOOLS = new Set(["spawn_agent", "stop_agent", "list_agents"]);

export class Board {
  readonly #runs = new Map<string, RunState>();
  readonly #feed: FeedLine[] = [];
  readonly #alerts: Alert[] = [];
  readonly #decisions: Decision[] = [];
  /** Children the hub accepted, by the agent name it gave them. */
  readonly #spawns = new Map<string, { by: string; bookedUsd?: number; at: number }>();
  #purse: Purse | undefined;
  /** Results and failures so far: a new one rings the bell. */
  bells = 0;

  /** The run of `agent` that `runId` names becomes that agent's row; a newer run replaces an older one. */
  handle(agent: string, record: TraceLine): void {
    let run = this.#runs.get(agent);
    if (!run || run.runId !== record.runId) {
      if (run && run.runId > record.runId) return;
      run = {
        agent, runId: record.runId, tokIn: 0, tokOut: 0, toolsDone: 0, toolsBad: 0, tools: new Map(), rounds: new Map(),
        wroteTo: new Map(), subagents: new Map(), activity: [], spendSeries: [], backoffRounds: 0, backoffWaitedMs: 0,
      };
      this.#runs.set(agent, run);
    }
    const at = Date.parse(record.ts);
    run.lastAt = at;
    if (record.type !== "process_sample") push(run.activity, at);
    const feed = (text: string) => push(this.#feed, { at, agent, text });
    const alert = (kind: AlertKind, text: string) => {
      push(this.#alerts, { at, agent, kind, text });
      if (RINGS.has(kind)) this.bells += 1;
    };

    switch (record.type) {
      case "run_started":
        run.model = record.modelId;
        run.budgetUsd = record.budgetUsd;
        // A line written by another branch or an older runtime may lack a field the type
        // requires: the field stays blank, the screen stays up (SICUREZZA, P2).
        if (typeof record.limits?.["maxWebSearches"] === "number") run.maxWebSearches = record.limits["maxWebSearches"];
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
        run.tokIn += record.usage?.inputTokens ?? 0;
        run.tokOut += record.usage?.outputTokens ?? 0;
        if (record.backoff) {
          run.backoffRounds += 1;
          run.backoffWaitedMs += record.backoff.waitedMs;
          feed(`${c.yellow("⏵")} 429: waited ${dur(record.backoff.waitedMs)} over ${record.backoff.attempts} attempts`);
        }
        if (!record.run) return;
        run.steps = record.run.steps;
        run.spentUsd = record.run.costUsd;
        run.spentAsOf = `round ${record.run.steps}`;
        run.webSearches = record.run.webSearches;
        push(run.spendSeries, { at, usd: record.run.costUsd });
        if (!run.warnedCap && run.budgetUsd && run.spentUsd >= CAP_WARN * run.budgetUsd) {
          run.warnedCap = true;
          alert("cap", `spent ${usd(run.spentUsd)} of its ${usd(run.budgetUsd)} cap`);
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
          if (record.name === "spawn_agent") {
            push(this.#decisions, {
              at, by: agent, asked: oneLine(call?.summary ?? ""), refused: answer.refused,
              ...(answer.agent !== undefined ? { agent: answer.agent } : {}),
              ...(answer.bookedUsd !== undefined ? { bookedUsd: answer.bookedUsd } : {}),
              ...(answer.leftUsd !== undefined ? { leftUsd: answer.leftUsd } : {}),
              ...(answer.reason !== undefined ? { reason: answer.reason } : {}),
            });
            if (answer.refused) alert("refused", `spawn refused: ${answer.reason ?? oneLine(record.result)}`);
            else if (answer.agent) this.#spawns.set(answer.agent, { by: agent, at, ...(answer.bookedUsd !== undefined ? { bookedUsd: answer.bookedUsd } : {}) });
          }
          text += ` ${c.dim("→")} ${answer.headline}`;
        } else if (ok && call) {
          const result = resultOf(record.name, call.args, call.summary);
          if (result) alert(result.kind, result.text);
        }
        feed(text);
        return;
      }
      case "tool_permission":
        if (!record.allowed) {
          feed(`${c.yellow("⊘")} ${sub(record.agent)}${record.name} refused by permissions (${record.mode})`);
          alert("refused", `${record.name} refused by permissions`);
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
        push(run.spendSeries, { at, usd: record.costUsd });
        if (record.webSearches !== undefined) run.webSearches = record.webSearches;
        run.tools.clear();
        run.rounds.clear();
        feed(`${c.cyan("■")} ${record.reason} · ${usd(record.costUsd)}`);
        alert("end", `${record.reason} · spent ${usd(record.costUsd)}${run.budgetUsd !== undefined ? ` of ${usd(run.budgetUsd)}` : ""}`);
        return;
      case "run_failed":
        run.final = { kind: "failed", code: record.code };
        run.tools.clear();
        run.rounds.clear();
        feed(`${c.red("✗")} failed: ${record.code} ${c.dim(oneLine(record.message))}`);
        alert("failed", `failed: ${record.code}`);
        return;
      default:
        return;
    }
  }

  /**
   * The screen at `now` on `page`: at most `rows` lines, none wider than `cols`.
   * The START page is not the board's: its lines come from `start-page.ts`.
   */
  frame(now: number, size: { cols: number; rows: number }, header: string, page: Page = "agents", startLines: string[] = []): string[] {
    const W = Math.max(30, size.cols);
    const H = Math.max(6, size.rows);
    const out: string[] = [];
    const add = (line = "") => out.push(clipTo(line, W));

    const runs = this.#ordered();
    add(this.#banner(runs, now, W));
    add(this.#tabs(page, W));
    if (H >= 30) add(c.dim(` ${header}`));
    const footer = H >= 16 ? c.dim(" ←/→ or 1 2 3 4: pages · q: quit") : "";
    const room = H - out.length - (footer ? 1 : 0);
    const body =
      page === "agents"
        ? this.#agentsPage(runs, now, W, room)
        : page === "results"
          ? this.#resultsPage(now, room)
          : page === "money"
            ? this.#moneyPage(runs, now, W, room)
            : startLines;
    for (const line of body.slice(0, room)) add(line);
    if (footer) {
      while (out.length < H - 1) out.push("");
      add(footer);
    }
    return out.slice(0, H);
  }

  /** Captains first, then the product's roles in their order, then any other. */
  #ordered(): RunState[] {
    return [...this.#runs.values()].sort((a, b) => rank(a.agent) - rank(b.agent) || a.agent.localeCompare(b.agent, "en", { numeric: true }));
  }

  #banner(runs: RunState[], now: number, W: number): string {
    const live = runs.filter((r) => !r.final && r.lastAt !== undefined && now - r.lastAt <= SILENT_MS).length;
    const silent = runs.filter((r) => !r.final && (r.lastAt === undefined || now - r.lastAt > SILENT_MS)).length;
    const failed = runs.filter((r) => r.final?.kind === "failed").length;
    const last = Math.max(0, ...runs.map((r) => r.lastAt ?? 0));
    const spent = runs.filter((r) => r.spentUsd !== undefined);
    const state =
      live > 0 ? `WORKING · ${live} live` : runs.length === 0 ? "NO TRACE YET" : `IDLE · last activity ${ago(now - last)} ago`;
    const parts = [
      ` JHT · API TEAM `,
      ` ${state}${silent ? ` · ${silent} silent` : ""}${failed ? ` · ${failed} failed` : ""} `,
      spent.length ? ` spent ${usd(spent.reduce((a, r) => a + (r.spentUsd ?? 0), 0))} in ${spent.length} run${spent.length === 1 ? "" : "s"} ` : "",
    ];
    const paint = live > 0 ? bg(34) : failed || silent ? bg(214) : bg(244);
    const time = ` ${clock(now)} `;
    // The clock stays: the spend is the first thing a narrow pane gives up.
    const body = cells(parts.join("")) + 10 <= W ? parts.join("") : parts.slice(0, 2).join("");
    return paint(clipTo(body + " ".repeat(Math.max(1, W - cells(body) - cells(time))) + time, W));
  }

  #tabs(page: Page, W: number): string {
    const count = this.#alerts.filter((a) => RINGS.has(a.kind)).length;
    const tabs = PAGES.map((p, i) => {
      const label = ` ${i + 1} ${PAGE_TITLE[p]}${p === "results" && count ? ` ${count}` : ""} `;
      return p === page ? inverse(c.bold(label)) : c.dim(label);
    });
    return clipTo(` ${tabs.join(" ")}`, W);
  }

  /**
   * Every role of the product in its place, whatever runs. A role with no
   * trace is one row switched off; a role with runs has a row per agent, a
   * spawn the hub booked whose child has written nothing yet included.
   */
  #agentsPage(runs: RunState[], now: number, W: number, room: number): string[] {
    const spark = W >= 140 ? 24 : W >= 100 ? 16 : W >= 70 ? 10 : 0;
    const gauge = W >= 90 ? 10 : W >= 70 ? 6 : 0;
    // Wide enough for every role's name, switched off or not: the rows do not move when one lights up.
    const nameWidth = Math.max(...ROSTER.map((role) => role.length + 2), ...runs.map((r) => r.agent.length + 2), ...[...this.#spawns.keys()].map((a) => a.length + 2));
    const lines: string[] = [];
    const booked = [...this.#spawns].filter(([child]) => !this.#runs.has(child));
    const roles = [...ROSTER, ...new Set(runs.map((r) => roleOf(r.agent)).filter((role) => !ROSTER.includes(role)))];
    const scale = Math.max(1, ...runs.map((r) => Math.max(...buckets(r.activity, now, spark || 1))));
    const detailed = room >= roles.length * 2 + runs.length + 2;

    if (spark && room >= roles.length + 2) {
      lines.push(c.dim(`${" ".repeat(3 + nameWidth + 1)}${fit(`activity, last ${ago(spark * SPARK_CELL_MS)}`, spark, false)} ${gauge ? fit("spent / run cap", gauge + 19, false) : ""} now`));
    }
    for (const role of roles) {
      const mine = runs.filter((r) => roleOf(r.agent) === role);
      const pending = booked.filter(([child]) => roleOf(child) === role);
      if (mine.length === 0 && pending.length === 0) {
        // ○ is one cell where the state emoji are two: the extra space keeps the names in one column.
        lines.push(c.dim(` ○  ${fit(` ${role}`, nameWidth, false)} ${spark ? "·".repeat(spark) + " " : ""}no trace`));
        continue;
      }
      for (const r of mine) {
        const parent = this.#spawns.get(r.agent);
        const badge = bg(tint(r.agent))(fit(` ${r.agent}`, nameWidth, false));
        const act = spark ? `${sparkline(buckets(r.activity, now, spark), scale, tint(r.agent))} ` : "";
        const money = `${gauge && r.budgetUsd ? `${meter(r.spentUsd, r.budgetUsd, gauge, tint(r.agent))} ` : ""}${r.spentUsd === undefined ? BLANK : usd(r.spentUsd)} / ${r.budgetUsd === undefined ? BLANK : usd(r.budgetUsd)}`;
        lines.push(` ${stateIcon(r, now)} ${badge} ${act}${fit(money, (gauge ? gauge + 1 : 0) + 17, false)}  ${stateWords(r, now)}${doingOf(r, now)}`);
        if (!detailed) continue;
        const facts = [
          parent ? `↳ spawned by ${parent.by}${parent.bookedUsd !== undefined ? ` · booked ${usd(parent.bookedUsd)}` : ""}` : "",
          [...r.wroteTo].length ? `✉ → ${[...r.wroteTo].map(([to, n]) => `${fg(tint(to))(to)}${n > 1 ? ` ×${n}` : ""}`).join(", ")}` : "",
          r.subagents.size ? `subagents ${[...r.subagents].map(([name, state]) => `${name}${state === "running" ? "" : ` ${state}`}`).join(", ")}` : "",
          r.steps === undefined ? "" : `round ${int(r.steps)}`,
          r.toolsDone ? `${int(r.toolsDone)} tool${r.toolsDone === 1 ? "" : "s"}${r.toolsBad ? c.red(` ✗${r.toolsBad}`) : ""}` : "",
          r.webSearches === undefined ? "" : `search ${r.webSearches}/${r.maxWebSearches ?? "—"}`,
          r.steps === undefined ? "" : `${int(r.tokIn)} in / ${int(r.tokOut)} out tok`,
          r.backoffRounds ? c.yellow(`429: ${r.backoffRounds} round${r.backoffRounds === 1 ? "" : "s"} waited ${dur(r.backoffWaitedMs)}`) : "",
        ].filter(Boolean);
        lines.push(`${" ".repeat(4 + nameWidth)}${c.dim(facts.join(" · "))}`);
      }
      for (const [child, s] of pending) {
        lines.push(` ○  ${bg(tint(child))(fit(` ${child}`, nameWidth, false))} ${c.dim(`booked ${s.bookedUsd !== undefined ? usd(s.bookedUsd) : "—"} by ${s.by} ${ago(now - s.at)} ago · no trace yet`)}`);
      }
    }
    if (runs.length === 0) lines.push("", c.dim("   waiting for the first trace: a run that starts lights its row by itself"));
    return lines;
  }

  #resultsPage(now: number, room: number): string[] {
    const lines: string[] = [];
    const made = (Object.keys(ALERT_ICON) as AlertKind[])
      .map((kind) => [kind, this.#alerts.filter((a) => a.kind === kind).length] as const)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${ALERT_ICON[kind]} ${n}`);
    lines.push(made.length ? ` ${made.join("   ")}` : c.dim(" nothing yet: a new position, a score, a CV, a word to the person, a failure"));
    lines.push(c.dim(" 🆕 position · 🧾 score or status · 📨 review · 📄 CV · 💬 to the person · 🏁 run ended · 🔴 failed · 🚫 refused · 💸 near its cap"));
    lines.push("");
    const events = [...this.#feed].sort((a, b) => a.at - b.at).map((f) => ` ${c.dim(stamp(f.at, now))} ${fg(tint(f.agent))(f.agent)} ${f.text}`);
    const results = [...this.#alerts]
      .sort((a, b) => b.at - a.at)
      .map((a) => ` ${ALERT_ICON[a.kind]} ${c.dim(fit(now - a.at < 3_600_000 ? `${ago(now - a.at)} ago` : stamp(a.at, now), 14, false))} ${fg(tint(a.agent))(a.agent)} ${a.text}`);
    const left = room - lines.length;
    // The results first; the events take what they leave, and at least a few lines.
    const rRoom = Math.max(1, Math.min(results.length, left - Math.min(6, Math.max(0, left - 3))));
    lines.push(...results.slice(0, rRoom));
    if (left - rRoom >= 3) lines.push("", ` ${c.bold("EVENTS")}`, ...events.slice(-(left - rRoom - 2)));
    return lines;
  }

  #moneyPage(runs: RunState[], now: number, W: number, room: number): string[] {
    const lines: string[] = [];
    const p = this.#purse;
    lines.push(
      ` 🐷 piggy bank   left ${p ? c.bold(usd(p.leftUsd)) : BLANK} of ${BLANK}` +
        c.dim(p ? `   hub → ${p.agent} · ${p.tool} · ${ago(now - p.at)} ago${p.session ? ` · ${p.session}` : ""}` : "   no answer from the hub in any trace yet") +
        c.dim(" · its size is not in the trace"),
    );
    lines.push(` 🔑 key proxy    ceiling ${BLANK}${c.dim("   the key proxy's ceiling and count are not in the trace")}`);
    lines.push(...this.#budget(runs, W));
    lines.push("");

    // Each run's spend over time, against its own cap.
    const capped = runs.filter((r) => r.budgetUsd !== undefined);
    const spark = W >= 140 ? 30 : W >= 100 ? 20 : W >= 70 ? 12 : 0;
    const nameWidth = Math.max(10, ...runs.map((r) => r.agent.length + 2));
    if (capped.length) {
      if (spark) lines.push(c.dim(`${" ".repeat(nameWidth + 2)}${fit(`spend against cap, last ${ago(spark * SPARK_CELL_MS)}`, spark, false)}`));
      for (const r of capped) {
        const line = spark ? `${spendLine(r.spendSeries, r.budgetUsd!, now, spark, tint(r.agent))} ` : "";
        const money = `${r.spentUsd === undefined ? BLANK : usd(r.spentUsd)} / ${usd(r.budgetUsd!)}${r.spentAsOf ? c.dim(` @${r.spentAsOf}`) : ""}`;
        const waits = r.backoffRounds ? c.yellow(`  429: ${r.backoffRounds} round${r.backoffRounds === 1 ? "" : "s"} waited ${dur(r.backoffWaitedMs)}`) : "";
        lines.push(` ${bg(tint(r.agent))(fit(` ${r.agent}`, nameWidth, false))} ${line}${money}${waits}`);
      }
      const byRole = new Map<string, number>();
      for (const r of capped) if (r.spentUsd !== undefined) byRole.set(roleOf(r.agent), (byRole.get(roleOf(r.agent)) ?? 0) + r.spentUsd);
      if (byRole.size) lines.push(c.dim(" by role  ") + [...byRole].map(([role, v]) => `${fg(ROLE_COLOR[role] ?? 250)(role)} ${usd(v)}`).join(c.dim(" · ")));
      lines.push("");
    }

    // The launcher's answers to the CAPITANO: how it divided the money, and what it was refused.
    lines.push(` ${c.bold("LAUNCHER")} ${c.dim("· every spawn the CAPITANO asked for, newest first")}`);
    if (this.#decisions.length === 0) lines.push(c.dim("  no spawn asked yet"));
    for (const d of [...this.#decisions].sort((a, b) => b.at - a.at)) {
      const asked = d.asked ? c.dim(` asked ${d.asked} →`) : "";
      lines.push(
        d.refused
          ? ` 🚫 ${c.dim(clock(d.at))} ${fg(tint(d.by))(d.by)}${asked} ${c.red(`refused: ${d.reason ?? "?"}`)}`
          : ` ${c.green("✓")}  ${c.dim(clock(d.at))} ${fg(tint(d.by))(d.by)}${asked} ${d.agent ? fg(tint(d.agent))(d.agent) : "?"}${d.bookedUsd !== undefined ? ` booked ${usd(d.bookedUsd)}` : ""}${d.leftUsd !== undefined ? c.dim(` · left ${usd(d.leftUsd)}`) : ""}`,
      );
    }
    return lines.slice(0, room);
  }

  /**
   * One bar for the money the runs were given: each agent's share as wide as
   * its run's cap, filled as far as it has spent. Both are numbers the trace
   * wrote; an agent whose spend no round has written yet is drawn hatched.
   */
  #budget(runs: RunState[], W: number): string[] {
    const capped = runs.filter((r) => r.budgetUsd !== undefined && r.budgetUsd > 0);
    if (capped.length === 0) return [` 💰 run caps     ${BLANK}${c.dim("   no run has started yet")}`];
    const total = capped.reduce((a, r) => a + r.budgetUsd!, 0);
    const known = capped.filter((r) => r.spentUsd !== undefined);
    const spent = known.reduce((a, r) => a + r.spentUsd!, 0);
    const title =
      ` 💰 run caps     ${usd(total)} given to ${capped.length} run${capped.length === 1 ? "" : "s"} · ${usd(spent)} spent` +
      (known.length < capped.length ? c.dim(` (${capped.length - known.length} not reported yet)`) : "");
    const barWidth = Math.max(capped.length, W - 4);
    // Every share gets at least one cell; the rest follow the caps.
    const widths = capped.map((r) => Math.max(1, Math.floor((r.budgetUsd! / total) * barWidth)));
    for (let i = 0; widths.reduce((a, b) => a + b, 0) < barWidth; i = (i + 1) % widths.length) widths[i]! += 1;
    while (widths.reduce((a, b) => a + b, 0) > barWidth) widths[widths.indexOf(Math.max(...widths))]! -= 1;
    let bar = "";
    let names = "";
    capped.forEach((r, i) => {
      const n = widths[i]!;
      const paint = fg(tint(r.agent));
      if (r.spentUsd === undefined) bar += paint("╌".repeat(n));
      else {
        const full = Math.min(n, Math.round((r.spentUsd / r.budgetUsd!) * n));
        bar += paint("█".repeat(full)) + (COLOR ? paint(c.dim("░".repeat(n - full))) : "░".repeat(n - full));
      }
      if (!COLOR && i < capped.length - 1) bar = `${bar.slice(0, -1)}|`;
      names += paint(fit(`${r.agent} $${Number(r.budgetUsd!.toFixed(4))}`, Math.max(1, n - 1), false)) + (n > 1 ? " " : "");
    });
    return [title, `  ${bar}`, `  ${names}`];
  }
}

const BLANK = c.dim("—");

function rank(agent: string): number {
  const i = ROSTER.indexOf(roleOf(agent));
  return i < 0 ? ROSTER.length : i;
}

function push<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > FEED_MAX) list.splice(0, list.length - FEED_MAX);
}

/** One glyph for where a run stands. */
function stateIcon(r: RunState, now: number): string {
  if (r.final?.kind === "failed") return "🔴";
  if (r.final) return r.final.kind === "completed" ? "🔵" : "🟤";
  return r.lastAt !== undefined && now - r.lastAt > SILENT_MS ? "🟡" : "🟢";
}

/** The words the glyph cannot say: why it failed, how long it has been silent, how long ago it ended. */
function stateWords(r: RunState, now: number): string {
  if (r.final?.kind === "failed") return c.red(`${r.final.code} `);
  if (r.final) return c.dim(`${r.final.kind}${r.lastAt === undefined ? "" : ` ${ago(now - r.lastAt)} ago`}`);
  if (r.lastAt !== undefined && now - r.lastAt > SILENT_MS) return c.yellow(`silent ${ago(now - r.lastAt)} `);
  return "";
}

function doingOf(r: RunState, now: number): string {
  if (r.final) return "";
  const tools = [...r.tools.values()];
  if (tools.length > 0) return tools.map((t) => `${c.yellow("⚙")} ${sub(t.agent)}${t.name} ${c.dim(`${oneLine(t.summary)} ${ago(now - t.since)}`)}`).join("  ");
  const rounds = [...r.rounds.entries()];
  if (rounds.length > 0) return rounds.map(([agent, x]) => `${c.blue("…")} ${sub(agent || undefined)}thinking, round ${x.round} ${c.dim(ago(now - x.since))}`).join("  ");
  if (r.idleSince !== undefined) return c.dim(`turn done, waiting ${ago(now - r.idleSince)}`);
  return "";
}

/** How many events fell in each of the last `n` cells, oldest first. */
function buckets(times: number[], now: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const at of times) {
    const back = Math.floor((now - at) / SPARK_CELL_MS);
    if (back >= 0 && back < n) out[n - 1 - back]! += 1;
  }
  return out;
}

/** The sentinella's sparkline (cli/src/commands/sentinella.js), on one scale for every agent: a quiet cell is a dot. */
function sparkline(counts: number[], max: number, colour: number): string {
  const bars = "▁▂▃▄▅▆▇█";
  return counts.map((n) => (n === 0 ? c.dim("·") : fg(colour)(bars[Math.min(bars.length - 1, Math.ceil((n / max) * bars.length) - 1)]!))).join("");
}

/**
 * The run's spend over the last `n` cells, each as high as the spend its
 * rounds had written by then against its cap. Before its first round the cell
 * is a dot: nothing was written, so nothing is drawn.
 */
function spendLine(series: Array<{ at: number; usd: number }>, cap: number, now: number, n: number, colour: number): string {
  const bars = "▁▂▃▄▅▆▇█";
  let out = "";
  for (let i = 0; i < n; i++) {
    const end = now - (n - 1 - i) * SPARK_CELL_MS;
    const known = series.filter((s) => s.at <= end).at(-1);
    if (!known) out += c.dim("·");
    else {
      const fraction = Math.min(1, known.usd / cap);
      out += (fraction >= CAP_WARN ? c.red : fg(colour))(bars[Math.max(0, Math.ceil(fraction * bars.length) - 1)]!);
    }
  }
  return out;
}

/** `width` cells for spent / cap: two numbers the trace wrote, nothing in between. Hatched while no round has written the spend. */
function meter(spent: number | undefined, cap: number, width: number, colour: number): string {
  if (spent === undefined) return c.dim("╌".repeat(width));
  const fraction = spent / cap;
  const full = Math.min(width, Math.max(0, Math.round(fraction * width)));
  const paint = fraction >= CAP_WARN ? c.red : fraction >= 0.6 ? c.yellow : fg(colour);
  return paint("█".repeat(full)) + c.dim("░".repeat(width - full));
}

/**
 * The result a tool call earns, or nothing: what the team made for the
 * person, as the call that made it names it. Only accepted calls get here.
 */
export function resultOf(name: string, args: unknown, summary: string): { kind: AlertKind; text: string } | undefined {
  const argv = Array.isArray((args as { args?: unknown } | null)?.args) ? (args as { args: unknown[] }).args.map(String) : [];
  const flag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const said = (args as { text?: unknown; message?: unknown } | null) ?? {};
  switch (name) {
    case "db_insert": {
      if (argv[0] !== "position") return undefined;
      const company = flag("--company");
      return { kind: "position", text: `${oneLine(flag("--title") ?? "?")}${company ? ` @ ${oneLine(company)}` : ""}` };
    }
    case "db_update": {
      if (argv[0] !== "position") return undefined;
      const changes = ["--status", "--score", "--total-score"].flatMap((f) => (flag(f) !== undefined ? [`${f.slice(2)} ${flag(f)}`] : []));
      return changes.length ? { kind: "update", text: `position ${argv[1] ?? "?"}: ${changes.join(", ")}` } : undefined;
    }
    case "save_review":
      return { kind: "review", text: `review saved ${c.dim(oneLine(summary))}` };
    case "notify_user":
    case "chat_reply":
      return { kind: "person", text: oneLine(typeof said.text === "string" ? said.text : typeof said.message === "string" ? said.message : summary) };
    case "write_file": {
      const path = (args as { path?: unknown } | null)?.path;
      return typeof path === "string" && /(^|\/)(cv|critiche)\//.test(path) ? { kind: "file", text: path.split("/").slice(-2).join("/") } : undefined;
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
export function hubAnswer(result: string): { leftUsd?: number; session?: string; agent?: string; bookedUsd?: number; reason?: string; refused: boolean; headline: string } {
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
    ...(reason !== undefined ? { reason: oneLine(reason) } : {}),
    refused,
    headline,
  };
}

const sub = (agent: string | undefined) => (agent ? c.cyan(`${agent}: `) : "");
/**
 * Text from a trace on one line. Pictographs go: a joined emoji is two cells
 * in tmux and four or five in Terminal.app, and one line that disagrees with
 * the terminal shifts every column after it.
 */
const oneLine = (text: string) => text.replace(/[\p{Extended_Pictographic}\u200D\uFE0F]/gu, "").replace(/\s+/g, " ").trim();
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

const ANSI = /\x1b\[[0-9;]*m/g;
/** The cells a code point takes: two for an emoji or a wide East Asian character, none for a joiner or a mark. */
function cellOf(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || /\p{M}/u.test(ch)) return 0;
  if (/\p{Emoji_Presentation}/u.test(ch)) return 2;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

/** The cells `s` takes on screen, colour codes aside. */
export function cells(s: string): number {
  let n = 0;
  for (const ch of s.replace(ANSI, "")) n += cellOf(ch);
  return n;
}

function fit(s: string, n: number, right: boolean): string {
  const clipped = clipTo(s, n);
  const pad = " ".repeat(Math.max(0, n - cells(clipped)));
  return right ? pad + clipped : clipped + pad;
}

/** `s` cut to `n` cells, colour codes kept whole, a wide character never cut in half. */
function clipTo(s: string, n: number): string {
  if (cells(s) <= n) return s;
  let seen = 0;
  let out = "";
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    for (const ch of part) {
      const w = cellOf(ch);
      if (seen + w > n - 1) return COLOR ? `${out}\x1b[0m…` : `${out}…`;
      out += ch;
      seen += w;
    }
  }
  return COLOR ? `${out}\x1b[0m…` : `${out}…`;
}

/**
 * Draws the board every second, at once when the pane is resized or a key
 * changes the page, until q or ctrl-c. Each agent's row follows its newest
 * trace file, however old: an idle team shows how its last session went.
 * With `windowMin`, a file older than that is left out. A new result or
 * failure rings the bell, which tmux marks on the window. With `once`, or
 * when stdout is not a terminal, one frame of `page` is printed and nothing
 * is followed.
 */
export function runDashboard(options: { logsDir: string; traceFiles: () => string[]; windowMin?: number; once: boolean; bell?: boolean; page?: Page }): void {
  const board = new Board();
  // The START page: its plan and the hub's address are read at every draw, so
  // the page shows the configuration as it is now, never as it was.
  const starts = startsFile(options.logsDir);
  let step: StartStep = { step: "idle" };
  const startBody = (interactive: boolean) =>
    page === "start" ? startPageLines(readTeamPlan(process.env["JHT_LAUNCHER_CONFIG"]?.trim()), hubAccess(), step, readStarts(starts), interactive) : [];
  const tails = new Map<string, Tail>();
  const header = `${options.logsDir} · ${options.windowMin ? `runs of the last ${options.windowMin} min` : "each agent's latest run"}`;
  let page: Page = options.page ?? "agents";

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
    for (const line of board.frame(Date.now(), size(), header, page, startBody(false))) console.log(line);
    return;
  }

  // The alternate screen, as `top` does: the terminal's scrollback is left as it was.
  stdout.write("\x1b[?1049h\x1b[?25l");
  const restore = () => {
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write("\x1b[?25h\x1b[?1049l");
  };
  process.on("exit", restore);
  process.on("SIGINT", () => process.exit(0));
  // What is already in the traces is history: only what arrives from now on rings.
  pump(Date.now());
  let rung = board.bells;
  const draw = () => {
    const now = Date.now();
    pump(now);
    const lines = board.frame(now, size(), header, page, startBody(true));
    const bell = options.bell !== false && board.bells > rung ? "\x07" : "";
    rung = board.bells;
    stdout.write(`${bell}\x1b[H${lines.map((l) => `${l}\x1b[K`).join("\n")}\x1b[J`);
  };

  // Keys: the arrows and tab move between pages, a digit goes to one, q leaves.
  // Raw mode takes ctrl-c away from the terminal, so it is read here too.
  // On the START page, s asks and y confirms: two keys, never one, and this
  // handler is the only place a start can come from.
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (data: Buffer) => {
      const key = data.toString("utf8");
      const at = PAGES.indexOf(page);
      if (key === "q" || key === "\x03") process.exit(0);
      if (page === "start") {
        const plan = readTeamPlan(process.env["JHT_LAUNCHER_CONFIG"]?.trim());
        const hub = hubAccess();
        const ready = plan.ok && !("reason" in hub);
        const next = onStartKey(step, key, ready);
        step = next.step;
        if (next.start && plan.ok && !("reason" in hub)) {
          draw();
          void startAndRecord(plan, hub, starts).then((outcome) => {
            step = { step: "answered", outcome };
            draw();
          });
          return;
        }
        if (next.consumed) {
          draw();
          return;
        }
      }
      if (key === "\x1b[C" || key === "\t" || key === "l") page = PAGES[(at + 1) % PAGES.length]!;
      else if (key === "\x1b[D" || key === "\x1b[Z" || key === "h") page = PAGES[(at + PAGES.length - 1) % PAGES.length]!;
      else if (/^[1-9]$/.test(key) && Number(key) <= PAGES.length) page = PAGES[Number(key) - 1]!;
      else return;
      // Leaving the START page drops a confirmation left pending there.
      if (page !== "start" && step.step === "confirm") step = { step: "idle" };
      draw();
    });
  }
  draw();
  setInterval(draw, 1_000);
  stdout.on("resize", draw);
}
