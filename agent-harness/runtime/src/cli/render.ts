/**
 * Terminal view of a trace.
 *
 * One renderer for every way a trace reaches a terminal: live, in the process
 * that runs the agent, and from a trace file, in `npm run monitor`. It only
 * formats `TraceEvent`s; it never decides anything. Colour is dropped when
 * stdout is not a terminal or `NO_COLOR` is set.
 */

import { stdout } from "node:process";

import type { ToolOutcome } from "../core/agent-loop.ts";
import type { TraceEvent } from "../core/trace.ts";
import type { Usage } from "../core/usage.ts";
import { displayPath } from "../tools/paths.ts";

const COLOR = stdout.isTTY === true && !process.env["NO_COLOR"];
const sgr = (open: number, close: number) => (s: string) => (COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : s);
export const c = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  italic: sgr(3, 23),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  blue: sgr(34, 39),
  magenta: sgr(35, 39),
  cyan: sgr(36, 39),
};

const ANSI = /\x1b\[[0-9;]*m/g;
export const width = (s: string) => s.replace(ANSI, "").length;
const padEnd = (s: string, n: number) => s + " ".repeat(Math.max(0, n - width(s)));
const padStart = (s: string, n: number) => " ".repeat(Math.max(0, n - width(s))) + s;

export const int = (n: number) => n.toLocaleString("en-US");
export const usd = (n: number) => `$${n.toFixed(4)}`;
export const dur = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

const OUTCOME: Record<ToolOutcome["outcome"], string> = {
  accepted: c.green("✓"),
  failed: c.red("✗ failed"),
  rejected: c.red("✗ rejected"),
  denied: c.yellow("⊘ denied"),
  unknown: c.yellow("? unknown tool"),
};

const columns = () => Math.max(60, Math.min(stdout.columns ?? 120, 160));

interface ToolStat {
  calls: number;
  costUsd: number;
  ok: number;
  failed: number;
  denied: number;
  ms: number;
  chars: number;
  cpuMs: number;
  peakRss: number;
}

interface RoundRow {
  turn: number;
  round: number;
  durationMs: number;
  usage: Usage;
  costUsd: number;
  costInUsd: number;
  costOutUsd: number;
  tools: string[];
  finishReason: string;
  /** The subagent that made this round; absent for the main agent. */
  agent?: string | undefined;
}

export interface RenderOptions {
  /** Full prompt, arguments, results and process samples instead of previews. */
  verbose?: boolean;
  /** Show what the person typed. Off where the terminal already echoed it. */
  echoPerson?: boolean;
  /** Put before every line, to tell runs apart when several are followed. */
  prefix?: string;
  /** Name the agent is shown under. */
  agentName?: string;
  write?: (line: string) => void;
}

export class TraceView {
  #verbose: boolean;
  #echoPerson: boolean;
  #prefix: string;
  #agent: string;
  #write: (line: string) => void;

  #runId = "";
  #budgetUsd = 0;
  #pricing = { inputPerMTokUsd: 0, outputPerMTokUsd: 0 };
  #permissionMode = "";
  #startedAt: number | undefined;
  #turn = 0;
  #rows: RoundRow[] = [];
  #tools = new Map<string, ToolStat>();
  #pending = new Map<string, { name: string; summary: string }>();
  #contextChars = 0;
  #proc = { peakRss: 0, cpuMs: 0, maxLagMs: 0, samples: 0 };
  #servedModel = "";
  #rateLimit: Record<string, string> = {};
  #summarised = false;
  #toolSpendUsd = 0;

  constructor(options: RenderOptions = {}) {
    this.#verbose = options.verbose ?? false;
    this.#echoPerson = options.echoPerson ?? true;
    this.#prefix = options.prefix ?? "";
    this.#agent = options.agentName ?? "agent";
    this.#write = options.write ?? ((line) => console.log(line));
  }

  #out(line = ""): void {
    this.#write(line === "" ? this.#prefix.trimEnd() : `${this.#prefix}${line}`);
  }

  readonly handle = (event: TraceEvent & { ts?: string; runId?: string; role?: string }): void => {
    const ts = event.ts ? Date.parse(event.ts) : Date.now();
    if (event.runId) this.#runId = event.runId;
    if (event.role) this.#agent = event.role;

    switch (event.type) {
      case "run_started":
        return this.#runStarted(event, ts);
      case "system_prompt":
        this.#out(`  ${c.dim("▣ system prompt")} ${c.dim(`${int(event.text.length)} chars`)}`);
        if (this.#verbose) for (const line of event.text.split("\n")) this.#out(`  ${c.dim("│ " + line)}`);
        return;
      case "message_in":
        if (event.from === "runtime") {
          this.#out(`  ${c.dim("▷ runtime")} ${c.dim(clip(event.text, columns() - 14))}`);
        } else if (this.#echoPerson) {
          this.#out();
          this.#block(c.green(c.bold("❯ person")), event.text);
        }
        return;
      case "turn_started":
        this.#turn = event.turn;
        this.#out();
        this.#out(c.dim(`  ── turn ${event.turn} ${"─".repeat(Math.max(0, Math.min(columns(), 100) - 12 - String(event.turn).length))}`));
        return;
      case "round_started":
        this.#contextChars = event.contextChars;
        if (this.#verbose) {
          this.#out(`  ${c.dim(`◇ R${event.round} → ${event.messages} messages · ${int(event.contextChars)} chars of context`)}`);
        }
        return;
      case "round_finished":
        return this.#roundFinished(event);
      case "tool_started":
        return this.#toolStarted(event);
      case "tool_permission":
        if (!event.allowed) {
          this.#out(`  ${c.dim("┊")}     ${c.yellow("⊘")} ${c.yellow(`refused by permissions (${event.mode})`)}${event.asked ? c.dim(" · person asked") : ""}`);
          if (event.message) this.#out(`  ${c.dim("┊")}       ${c.dim(clip(event.message, columns() - 12))}`);
        } else if (event.asked) {
          this.#out(`  ${c.dim("┊")}     ${c.green("✓ allowed by the person")}`);
        }
        return;
      case "tool_finished":
        return this.#toolFinished(event);
      case "turn_finished":
        return this.#turnFinished(event);
      case "agent_started":
        this.#out(`  ${c.dim("┊")}   ${c.cyan("⎇ subagent")} ${c.bold(event.agent)} ${c.dim("started")}`);
        for (const line of preview(event.prompt, this.#verbose ? 40 : 2)) this.#out(`  ${c.dim("┊")}     ${c.dim("brief │ " + line)}`);
        return;
      case "agent_finished":
        this.#out(
          `  ${c.dim("┊")}   ${c.cyan("⎇ subagent")} ${c.bold(event.agent)} ` +
            `${event.ok ? c.green("reported") : c.red("gave up")} ${c.dim(`after ${event.rounds} round${event.rounds === 1 ? "" : "s"}`)}`,
        );
        for (const line of preview(event.report, this.#verbose ? 60 : 3)) this.#out(`  ${c.dim("┊")}     ${c.dim("report │ " + line)}`);
        return;
      case "todos_updated":
        this.#out(`  ${c.dim("┊")}   ${c.blue("☰ todos")}`);
        for (const todo of event.todos) {
          const mark = todo.status === "completed" ? c.green("☑") : todo.status === "in_progress" ? c.yellow("◐") : c.dim("☐");
          this.#out(`  ${c.dim("┊")}     ${mark} ${todo.status === "completed" ? c.dim(todo.content) : todo.content}`);
        }
        return;
      case "process_sample":
        this.#proc.samples += 1;
        this.#proc.peakRss = Math.max(this.#proc.peakRss, event.rssBytes);
        this.#proc.cpuMs = event.cpuUserMs + event.cpuSystemMs;
        this.#proc.maxLagMs = Math.max(this.#proc.maxLagMs, event.loopLagMs);
        if (this.#verbose) {
          this.#out(`  ${c.dim(`· process rss ${bytes(event.rssBytes)} · heap ${bytes(event.heapUsedBytes)} · cpu ${dur(this.#proc.cpuMs)} · loop lag ${event.loopLagMs}ms`)}`);
        }
        return;
      case "run_failed":
        this.#out();
        this.#out(`  ${c.red(c.bold(`✗ ${event.code}`))} ${event.message}`);
        this.summary(ts);
        return;
      case "run_finished":
        this.#out();
        this.#out(`  ${c.dim(event.reason === "completed" ? "■ run completed" : "■ run stopped")}`);
        this.summary(ts);
        return;
    }
  };

  #runStarted(event: Extract<TraceEvent, { type: "run_started" }>, ts: number): void {
    this.#startedAt = ts;
    this.#budgetUsd = event.budgetUsd;
    this.#pricing = event.pricing;
    this.#permissionMode = event.permissionMode;
    const mode = event.live ? c.yellow("● live") : c.green("○ mock");
    const lines = [
      `${c.bold(this.#agent)} ${c.dim("·")} ${c.cyan(this.#runId)} ${c.dim(`pid ${event.pid}`)}`,
      "",
      `${c.dim("model  ")} ${event.providerId}/${event.modelId}  ${mode}`,
      `${c.dim("price  ")} $${event.pricing.inputPerMTokUsd} in · $${event.pricing.outputPerMTokUsd} out ${c.dim("/ 1M tok")}  ${c.dim("budget")} ${usd(event.budgetUsd)}`,
      `${c.dim("perms  ")} ${event.permissionMode}`,
      `${c.dim("tools  ")} ${event.tools.join(", ")}`,
      ...(event.mcp ? [`${c.dim("mcp    ")} ${event.mcp.join(", ")}`] : []),
      ...(event.agentHome ? [`${c.dim("home   ")} ${displayPath(event.agentHome)}`] : []),
      `${c.dim("workdir")} ${displayPath(event.workdir)}`,
      `${c.dim("limits ")} ${event.limits["maxSteps"]} steps · ${event.limits["maxToolCalls"]} tool calls · ${int(event.limits["maxTotalTokens"] ?? 0)} tok · ${dur(event.limits["wallClockMs"] ?? 0)}`,
      `${c.dim("runtime")} node ${event.node} · ${event.platform}`,
    ];
    const inner = Math.max(...lines.map(width)) + 2;
    this.#out();
    this.#out(c.dim(`  ╭${"─".repeat(inner)}╮`));
    for (const line of lines) this.#out(`  ${c.dim("│")} ${padEnd(line, inner - 1)}${c.dim("│")}`);
    this.#out(c.dim(`  ╰${"─".repeat(inner)}╯`));
  }

  #roundFinished(event: Extract<TraceEvent, { type: "round_finished" }>): void {
    const u = event.usage;
    const calls = event.toolCalls.length;
    const what =
      calls > 0 ? c.blue(`→ ${calls} tool call${calls === 1 ? "" : "s"}`) : event.finishReason === "stop" ? c.green("→ reply") : c.yellow(`→ ${event.finishReason}`);
    const cached = (u.cachedInputTokens ?? 0) > 0 ? c.dim(` (${int(u.cachedInputTokens ?? 0)} cached)`) : "";
    const reasoning = (u.reasoningTokens ?? 0) > 0 ? c.dim(` (${int(u.reasoningTokens ?? 0)} reasoning)`) : "";
    this.#out(
      `  ${c.magenta("◆")} ${agentTag(event.agent)}${c.bold(padEnd(`R${event.round}`, 3))} ${c.dim(padStart(dur(event.durationMs), 6))}  ` +
        `${c.dim("in")} ${padStart(int(u.inputTokens), 7)}${cached}  ${c.dim("out")} ${padStart(int(u.outputTokens), 5)}${reasoning}  ` +
        `${c.dim(`${usd(event.costInUsd)} + ${usd(event.costOutUsd)} =`)} ${usd(event.costUsd)}  ${what}`,
    );
    if (calls > 0 && event.text.trim()) {
      for (const line of preview(event.text, this.#verbose ? 40 : 2)) this.#out(`  ${c.dim("┊")}   ${c.italic(c.dim(line))}`);
    }
    if (this.#verbose) {
      const run = event.run;
      this.#out(
        `  ${c.dim(`┊   run: ${run.steps} steps · ${run.toolCalls} tool calls · ${int(run.totalTokens)} tok · ${usd(run.costUsd)} · ${dur(run.remainingMs)} left`)}` +
          (event.response?.id ? c.dim(` · response ${event.response.id}`) : ""),
      );
    }
    if (event.response?.modelId) this.#servedModel = event.response.modelId;
    if (event.response?.rateLimit) this.#rateLimit = event.response.rateLimit;
    this.#rows.push({
      turn: this.#turn,
      round: event.round,
      durationMs: event.durationMs,
      usage: u,
      costUsd: event.costUsd,
      costInUsd: event.costInUsd,
      costOutUsd: event.costOutUsd,
      tools: [],
      finishReason: event.finishReason,
      agent: event.agent,
    });
  }

  #toolStarted(event: Extract<TraceEvent, { type: "tool_started" }>): void {
    this.#pending.set(event.callId, { name: event.name, summary: event.summary });
    const risk =
      event.risk === "execute" ? c.red("exec") : event.risk === "write" ? c.yellow("write") : event.risk === "network" ? c.blue("net") : event.risk === "read" ? c.dim("read") : "";
    const summary = event.summary;
    const room = columns() - 18 - event.name.length;
    this.#out(`  ${c.dim("┊")}   ${agentTag(event.agent)}${c.cyan("⚙")} ${c.bold(event.name)} ${risk} ${clip(summary.replaceAll(homePath(), "~"), room)}`);
    if (this.#verbose) {
      this.#out(`  ${c.dim("┊")}     ${c.dim("args " + clip(JSON.stringify(event.args), columns() - 16))}`);
    }
  }

  #toolFinished(event: Extract<TraceEvent, { type: "tool_finished" }>): void {
    this.#pending.delete(event.callId);
    const d = event.details;
    const stat = this.#tools.get(event.name) ?? { calls: 0, costUsd: 0, ok: 0, failed: 0, denied: 0, ms: 0, chars: 0, cpuMs: 0, peakRss: 0 };
    stat.calls += 1;
    stat.costUsd += event.costUsd ?? 0;
    this.#toolSpendUsd += event.costUsd ?? 0;
    // A subagent's rounds interleave with the call that started it: file each
    // call under the latest round of the agent that made it.
    this.#rows.findLast((r) => r.agent === event.agent)?.tools.push(event.name);
    if (event.outcome === "accepted") stat.ok += 1;
    else if (event.outcome === "denied") stat.denied += 1;
    else stat.failed += 1;
    stat.ms += event.durationMs;
    stat.chars += event.resultChars;
    stat.cpuMs += (d?.resources?.cpuUserMs ?? 0) + (d?.resources?.cpuSystemMs ?? 0);
    stat.peakRss = Math.max(stat.peakRss, d?.resources?.maxRssBytes ?? 0);
    this.#tools.set(event.name, stat);

    if (event.outcome === "denied") return; // the permission line already said it

    const facts: string[] = [];
    if (d?.timedOut) facts.push(c.red("timed out"));
    else if (d?.signal) facts.push(c.red(`killed by ${d.signal}`));
    else if (d && "exitCode" in d) facts.push(d.exitCode === 0 ? c.green("exit 0") : c.red(`exit ${d.exitCode}`));
    facts.push(dur(event.durationMs));
    if (d?.resources?.cpuUserMs !== undefined) facts.push(`cpu ${dur((d.resources.cpuUserMs ?? 0) + (d.resources.cpuSystemMs ?? 0))}`);
    if (d?.resources?.maxRssBytes) facts.push(`peak ${bytes(d.resources.maxRssBytes)}`);
    if (d?.stdoutBytes !== undefined) facts.push(`stdout ${bytes(d.stdoutBytes)}`);
    if (d?.stderrBytes) facts.push(c.yellow(`stderr ${bytes(d.stderrBytes)}`));
    if (event.costUsd) facts.push(c.yellow(usd(event.costUsd)));
    facts.push(`${int(event.resultChars)} chars to model`);
    this.#out(`  ${c.dim("┊")}     ${OUTCOME[event.outcome]} ${c.dim(facts.join(" · "))}`);

    const body = event.result.replace(/^exit code -?\d+\n?/, "").replace(/^\(no output\)$/, "");
    const lines = preview(body, this.#verbose ? 60 : 3);
    for (const line of lines) {
      const text = line.startsWith("--- ") ? c.dim(line) : line;
      this.#out(`  ${c.dim("┊       │")} ${c.dim(text)}`);
    }
    const total = body.split("\n").length;
    if (total > lines.length || event.resultCut) {
      this.#out(`  ${c.dim(`┊       └ ${total - lines.length > 0 ? `${int(total - lines.length)} more lines` : "more"}${event.resultCut ? " (trace keeps the first 4,000 chars)" : ""}`)}`);
    }
  }

  #turnFinished(event: Extract<TraceEvent, { type: "turn_finished" }>): void {
    const u = event.usage;
    const cost = this.#split(u);
    this.#out(
      `  ${c.dim("└")} ${c.dim(`${event.rounds} round${event.rounds === 1 ? "" : "s"} · ${dur(event.durationMs)} · ctx ${int(this.#contextChars)} chars ·`)} ` +
        `${c.dim("in")} ${int(u.inputTokens)}${(u.cachedInputTokens ?? 0) > 0 ? c.dim(` (${int(u.cachedInputTokens ?? 0)} cached)`) : ""} ${c.dim("·")} ` +
        `${c.dim("out")} ${int(u.outputTokens)} ${c.dim("·")} ${c.dim(`${usd(cost.in)} + ${usd(cost.out)} =`)} ${c.bold(usd(event.costUsd))}`,
    );
    if (event.text.trim()) {
      this.#out();
      this.#block(c.cyan(c.bold(`● ${this.#agent}`)), event.text);
    }
  }

  #block(title: string, text: string): void {
    this.#out(`  ${title}`);
    for (const line of wrap(text, Math.min(columns(), 110) - 4)) this.#out(`  ${inlineMarkdown(line)}`);
  }

  #split(u: Usage) {
    return {
      in: (u.inputTokens / 1_000_000) * this.#pricing.inputPerMTokUsd,
      out: (u.outputTokens / 1_000_000) * this.#pricing.outputPerMTokUsd,
    };
  }

  /** The closing report: rounds, tools, process and provider. Printed once. */
  summary(endTs = Date.now()): void {
    if (this.#summarised) return;
    this.#summarised = true;
    if (this.#rows.length === 0) return;

    this.#out();
    this.#out(`  ${c.bold("Rounds")} ${c.dim(`· $${this.#pricing.inputPerMTokUsd}/1M in · $${this.#pricing.outputPerMTokUsd}/1M out`)}`);
    const sum = (rows: RoundRow[]) =>
      rows.reduce(
        (a, r) => ({
          ms: a.ms + r.durationMs,
          in: a.in + r.usage.inputTokens,
          cached: a.cached + (r.usage.cachedInputTokens ?? 0),
          out: a.out + r.usage.outputTokens,
          reasoning: a.reasoning + (r.usage.reasoningTokens ?? 0),
          costIn: a.costIn + r.costInUsd,
          costOut: a.costOut + r.costOutUsd,
          cost: a.cost + r.costUsd,
        }),
        { ms: 0, in: 0, cached: 0, out: 0, reasoning: 0, costIn: 0, costOut: 0, cost: 0 },
      );
    const cells = (turn: string, round: string, rows: RoundRow[], tools: string, strong = false) => {
      const s = sum(rows);
      const b = strong ? c.bold : (x: string) => x;
      const dash = (n: number) => (n > 0 ? int(n) : c.dim("–"));
      return [turn, round, dur(s.ms), b(int(s.in)), dash(s.cached), b(int(s.out)), dash(s.reasoning), usd(s.costIn), usd(s.costOut), b(usd(s.cost)), tools];
    };
    const body: (string[] | "sep")[] = [];
    for (const turn of [...new Set(this.#rows.map((r) => r.turn))]) {
      const rows = this.#rows.filter((r) => r.turn === turn);
      for (const r of rows) {
        const tools = r.tools.length > 0 ? countNames(r.tools) : c.dim(r.finishReason === "stop" ? "reply" : r.finishReason);
        body.push(cells(r === rows[0] ? String(turn) : "", `R${r.round}${r.agent ? c.cyan(" ⎇") : ""}`, [r], tools));
      }
      if (rows.length > 1) body.push(cells("", c.dim("Σ"), rows, "").map((x, i) => (i < 2 ? x : c.dim(x))));
      body.push("sep");
    }
    body.pop();
    const total = cells(c.bold("Σ"), String(this.#rows.length), this.#rows, "", true);
    this.#table(
      ["turn", "round", "time", "tok in", "cached", "tok out", "reasoning", "$ in", "$ out", "$ total", "tools"],
      [2, 3, 4, 5, 6, 7, 8, 9],
      body,
      total,
    );

    if (this.#tools.size > 0) {
      this.#out();
      this.#out(`  ${c.bold("Tools")}`);
      const rows = [...this.#tools].map(([name, t]) => [
        name,
        int(t.calls),
        t.costUsd ? usd(t.costUsd) : c.dim("–"),
        t.ok ? c.green(int(t.ok)) : c.dim("–"),
        t.failed ? c.red(int(t.failed)) : c.dim("–"),
        t.denied ? c.yellow(int(t.denied)) : c.dim("–"),
        dur(t.ms),
        t.cpuMs ? dur(t.cpuMs) : c.dim("–"),
        t.peakRss ? bytes(t.peakRss) : c.dim("–"),
        int(t.chars),
      ]);
      const all = [...this.#tools.values()];
      const totalRow = [
        c.bold("Σ"),
        c.bold(int(all.reduce((a, t) => a + t.calls, 0))),
        usd(this.#toolSpendUsd),
        int(all.reduce((a, t) => a + t.ok, 0)),
        int(all.reduce((a, t) => a + t.failed, 0)),
        int(all.reduce((a, t) => a + t.denied, 0)),
        dur(all.reduce((a, t) => a + t.ms, 0)),
        dur(all.reduce((a, t) => a + t.cpuMs, 0)),
        bytes(Math.max(0, ...all.map((t) => t.peakRss))),
        int(all.reduce((a, t) => a + t.chars, 0)),
      ];
      this.#table(["tool", "calls", "$ spend", "ok", "failed", "denied", "time", "cpu", "peak mem", "chars to model"], [1, 2, 3, 4, 5, 6, 7, 8, 9], rows, totalRow);
    }

    this.#out();
    const spent = this.#rows.reduce((a, r) => a + r.costUsd, 0) + this.#toolSpendUsd;
    const pct = this.#budgetUsd > 0 ? (spent / this.#budgetUsd) * 100 : 0;
    const barWidth = 30;
    const filled = Math.min(barWidth, Math.round((pct / 100) * barWidth));
    const paint = pct >= 80 ? c.red : pct >= 50 ? c.yellow : c.green;
    this.#out(`  ${c.dim("budget ")} ${paint("█".repeat(filled))}${c.dim("░".repeat(barWidth - filled))} ${usd(spent)} ${c.dim("of")} ${usd(this.#budgetUsd)} ${c.dim(`(${pct.toFixed(1)}%)`)}`);
    if (this.#startedAt !== undefined) this.#out(`  ${c.dim("elapsed")} ${dur(endTs - this.#startedAt)}`);
    if (this.#proc.samples > 0) {
      this.#out(`  ${c.dim("process")} peak rss ${bytes(this.#proc.peakRss)} · cpu ${dur(this.#proc.cpuMs)} · max loop lag ${this.#proc.maxLagMs}ms`);
    }
    if (this.#servedModel) this.#out(`  ${c.dim("served ")} ${this.#servedModel}`);
    const limits = Object.entries(this.#rateLimit).filter(([k]) => /remaining/i.test(k));
    if (limits.length > 0) this.#out(`  ${c.dim("quota  ")} ${limits.map(([k, v]) => `${k.replace(/^x-ratelimit-/i, "")} ${v}`).join(" · ")}`);
    this.#out();
  }

  #table(head: string[], right: number[], body: (string[] | "sep")[], total: string[]): void {
    const rows = body.filter((r): r is string[] => r !== "sep");
    const all = [head, ...rows, total];
    const w = head.map((_, i) => Math.max(...all.map((r) => width(r[i] ?? ""))));
    const align = new Set(right);
    const rule = (l: string, m: string, r: string, fill = "─") => c.dim(`  ${l}${w.map((n) => fill.repeat(n + 2)).join(m)}${r}`);
    const row = (r: string[]) =>
      `  ${c.dim("│")}${r.map((s, i) => ` ${align.has(i) ? padStart(s, w[i] ?? 0) : padEnd(s, w[i] ?? 0)} `).join(c.dim("│"))}${c.dim("│")}`;
    this.#out(rule("┌", "┬", "┐"));
    this.#out(row(head.map((h) => c.bold(h))));
    this.#out(rule("├", "┼", "┤"));
    for (const r of body) this.#out(r === "sep" ? rule("├", "┼", "┤") : row(r));
    this.#out(rule("╞", "╪", "╡", "═"));
    this.#out(row(total));
    this.#out(rule("└", "┴", "┘"));
  }

  /** The line a permission question shows under the tool call it is about. */
  permissionPrompt(toolName: string, reason: string, summary: string): string {
    this.#out(`  ${c.dim("┊")}     ${c.yellow("⚠")} ${c.bold(toolName)} ${reason}: ${c.dim(clip(summary, 160))}`);
    return `${this.#prefix}  ${c.dim("┊")}     ${c.yellow("allow?")} ${c.bold("[y]")} once · ${c.bold("[a]")} always for ${toolName} · ${c.bold("[n]")} no › `;
  }

  get inputPrompt(): string {
    return `\n${this.#prefix}  ${c.green(c.bold("❯ you"))} `;
  }

  info(message: string): void {
    this.#out();
    this.#out(`  ${message}`);
  }
}

/** Rounds and calls made by a subagent carry its name; the main agent's carry nothing. */
function agentTag(agent: string | undefined): string {
  return agent ? c.cyan(`⎇ ${clip(agent, 24)} `) : "";
}

function homePath(): string {
  return process.env["HOME"] ?? " ";
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/** The first `lines` non-empty lines, each cut to the terminal. */
function preview(text: string, lines: number): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(0, lines)
    .map((l) => (l.length > columns() - 14 ? `${l.slice(0, columns() - 15)}…` : l));
}

/** "read_file ×4, glob" — repeated names counted. */
export function countNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ");
}

function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const indent = /^\s*(?:[-*]|\d+\.)\s+/.exec(para)?.[0].length ?? 0;
    let current = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (current !== "" && width(current) + 1 + word.length > cols) {
        out.push(current);
        current = " ".repeat(indent) + word;
      } else {
        current = current === "" ? word : `${current} ${word}`;
      }
    }
    out.push(current);
  }
  return out;
}

function inlineMarkdown(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, (_, s: string) => c.bold(s)).replace(/`([^`]+)`/g, (_, s: string) => c.yellow(s));
}
