/**
 * `npm run monitor` — watch agents work.
 *
 * Agents run headless. Each one writes its trace to
 * `~/.jht-api/logs/<role>/<runId>.jsonl`; this reads those files and renders them
 * with the same view the agent's own terminal uses, so a run looks the same
 * whether you watch it live, from another terminal, or afterwards.
 *
 *   npm run monitor                 follow every live run, and new ones as they start
 *   npm run monitor -- --list       every run: status, time, tokens, cost
 *   npm run monitor -- <run>        replay one run (id, id prefix or path), then follow it if live
 *   npm run monitor -- --last       replay the most recent run
 *   npm run monitor -- --verbose    full prompt, arguments, outputs and process samples
 *
 * Read-only: it opens trace files and nothing else.
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { TraceLine } from "../core/trace.ts";
import { resolveUserPath } from "../tools/paths.ts";
import { c, countNames, dur, int, TraceView, usd, width } from "./render.ts";

const POLL_MS = 250;
const SCAN_MS = 1_000;

type Record_ = TraceLine;

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const logsDir = join(resolveUserPath(process.env["JHT_API_HOME"]?.trim() || "~/.jht-api", process.cwd(), homedir()), "logs");

function traceFiles(): string[] {
  if (!existsSync(logsDir)) return [];
  const files: string[] = [];
  for (const role of readdirSync(logsDir)) {
    const dir = join(logsDir, role);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) if (name.endsWith(".jsonl")) files.push(join(dir, name));
  }
  return files.sort((a, b) => basename(a).localeCompare(basename(b)));
}

function readRecords(file: string): Record_[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record_];
      } catch {
        return [];
      }
    });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type Status = "running" | "completed" | "stopped" | "failed" | "died";

function statusOf(records: Record_[]): Status {
  const last = records.findLast((r) => r.type === "run_finished" || r.type === "run_failed");
  if (last?.type === "run_finished") return last.reason;
  if (last?.type === "run_failed") return "failed";
  const started = records.find((r) => r.type === "run_started");
  return started?.type === "run_started" && isAlive(started.pid) ? "running" : "died";
}

const STATUS_PAINT: Record<Status, (s: string) => string> = {
  running: (s) => c.green(`● ${s}`),
  completed: (s) => c.cyan(`■ ${s}`),
  stopped: (s) => c.dim(`■ ${s}`),
  failed: (s) => c.red(`✗ ${s}`),
  died: (s) => c.yellow(`† ${s}`),
};

function list(): void {
  const files = traceFiles();
  if (files.length === 0) {
    console.log(`\n  No runs yet in ${logsDir}\n`);
    return;
  }
  // `429` is the time this run spent waiting for the upstream account's rate
  // limit to clear — reported apart from `time`, which is work. Reading one as
  // the other has already sent the team looking for a slow model twice
  // (MASTER, 23/09), and with five or six agents at once this is the wall the
  // rehearsals of 23/09 kept hitting, not the budget.
  const head = ["agent", "run", "status", "started", "time", "429", "rounds", "tools", "search", "tok in", "tok out", "$ total", "model"];
  const rows = files.map((file) => {
    const records = readRecords(file);
    const started = records.find((r) => r.type === "run_started");
    const rounds = records.filter((r) => r.type === "round_finished");
    const tools = records.flatMap((r) => (r.type === "tool_finished" ? [r.name] : []));
    const first = records[0];
    const last = records.at(-1);
    const inTok = rounds.reduce((a, r) => a + (r.type === "round_finished" ? r.usage.inputTokens : 0), 0);
    const outTok = rounds.reduce((a, r) => a + (r.type === "round_finished" ? r.usage.outputTokens : 0), 0);
    const cost = rounds.reduce((a, r) => a + (r.type === "round_finished" ? r.costUsd : 0), 0);
    // T19: the searches the provider ran, as each web_search call recorded them.
    const searches = records.reduce((a, r) => a + (r.type === "tool_finished" && typeof r.details?.webSearches === "number" ? r.details.webSearches : 0), 0);
    const waited = rounds.reduce((a, r) => a + (r.type === "round_finished" ? (r.backoff?.waitedMs ?? 0) : 0), 0);
    const status = statusOf(records);
    return [
      basename(dirname(file)),
      basename(file, ".jsonl"),
      STATUS_PAINT[status](status),
      first ? new Date(first.ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" }) : "",
      first && last ? dur(Date.parse(last.ts) - Date.parse(first.ts)) : "",
      waited ? c.dim(dur(waited)) : c.dim("–"),
      int(rounds.length),
      tools.length ? `${tools.length} ${c.dim(`(${countNames(tools)})`)}` : c.dim("–"),
      searches ? int(searches) : c.dim("–"),
      int(inTok),
      int(outTok),
      usd(cost),
      started?.type === "run_started" ? `${started.providerId}/${started.modelId}` : "",
    ];
  });
  const all = [head, ...rows];
  const w = head.map((_, i) => Math.max(...all.map((r) => width(r[i] ?? ""))));
  const right = new Set([4, 5, 6, 8, 9, 10, 11]);
  const row = (r: string[]) => `  ${r.map((s, i) => (right.has(i) ? " ".repeat(w[i]! - width(s)) + s : s + " ".repeat(w[i]! - width(s)))).join("  ")}`;
  console.log();
  console.log(row(head.map((h) => c.bold(h))));
  console.log(c.dim(`  ${w.map((n) => "─".repeat(n)).join("  ")}`));
  for (const r of rows) console.log(row(r));
  console.log(`\n  ${c.dim(`${files.length} runs · ${logsDir}`)}\n`);
}

/** Reads what has been appended to a file since the last call, line by line. */
class Tail {
  readonly file: string;
  #offset = 0;
  #partial = "";
  constructor(file: string) {
    this.file = file;
  }

  read(): Record_[] {
    const size = statSync(this.file).size;
    if (size <= this.#offset) return [];
    const fd = openSync(this.file, "r");
    try {
      const buffer = Buffer.alloc(size - this.#offset);
      readSync(fd, buffer, 0, buffer.length, this.#offset);
      this.#offset = size;
      const text = this.#partial + buffer.toString("utf8");
      const lines = text.split("\n");
      this.#partial = lines.pop() ?? "";
      return lines.filter(Boolean).flatMap((line) => {
        try {
          return [JSON.parse(line) as Record_];
        } catch {
          return [];
        }
      });
    } finally {
      closeSync(fd);
    }
  }
}

const TAG_COLORS = [c.cyan, c.magenta, c.yellow, c.blue, c.green];

/**
 * Follows files: every record goes to that run's view. With more than one run
 * on screen, each line carries a short tag naming the agent and run.
 */
function follow(initial: string[], watchForNew: boolean): void {
  const tails = new Map<string, { tail: Tail; view: TraceView; done: boolean; pid?: number; last?: Record_ }>();
  // Tags appear once two runs are on screen together, and stay: mixed lines need them.
  let tagged = false;

  const add = (file: string) => {
    if (tails.has(file)) return;
    if ([...tails.values()].some((t) => !t.done)) tagged = true;
    const role = basename(dirname(file));
    const id = basename(file, ".jsonl");
    const paint = TAG_COLORS[tails.size % TAG_COLORS.length] ?? c.cyan;
    const tag = `${role}·${id.slice(-8)}`;
    const view = new TraceView({
      verbose,
      agentName: role,
      write: (line) => console.log(tagged ? `${paint(`[${tag}]`)} ${line}` : line),
    });
    tails.set(file, { tail: new Tail(file), view, done: false });
  };
  for (const file of initial) add(file);

  const pump = () => {
    for (const entry of tails.values()) {
      for (const record of entry.tail.read()) {
        entry.view.handle(record);
        entry.last = record;
        if (record.type === "run_started") entry.pid = record.pid;
        if (record.type === "run_finished" || record.type === "run_failed") entry.done = true;
      }
    }
    if (!watchForNew && [...tails.values()].every((t) => t.done)) process.exit(0);
  };

  const known = new Set(traceFiles());
  const scan = () => {
    for (const file of traceFiles()) {
      if (known.has(file)) continue;
      known.add(file);
      add(file);
    }
    // A run whose process vanished without a last event would otherwise be followed forever.
    for (const entry of tails.values()) {
      if (entry.done || entry.pid === undefined || isAlive(entry.pid)) continue;
      pump(); // anything written just before it died
      if (entry.done) continue;
      entry.view.handle({ ...entry.last, type: "run_failed", code: "process_died", message: "The agent process is gone and wrote no final event." } as Record_);
      entry.done = true;
    }
  };

  pump();
  setInterval(pump, POLL_MS);
  if (watchForNew) setInterval(scan, SCAN_MS);
  else setInterval(scan, SCAN_MS * 5);

  process.on("SIGINT", () => {
    for (const entry of tails.values()) if (!entry.done) entry.view.summary();
    process.exit(0);
  });
}

function findRun(query: string): string | undefined {
  if (existsSync(query)) return query;
  const files = traceFiles();
  return files.find((f) => basename(f, ".jsonl") === query) ?? files.filter((f) => basename(f).includes(query)).at(-1);
}

const positional = args.filter((a) => !a.startsWith("--"));

if (args.includes("--list")) {
  list();
} else if (args.includes("--last") || positional.length > 0) {
  const file = args.includes("--last") ? traceFiles().sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1) : findRun(positional[0] ?? "");
  if (!file) {
    console.error(`\n  No run matches ${positional[0] ?? "--last"}. Try: npm run monitor -- --list\n`);
    process.exit(1);
  }
  follow([file], false);
} else {
  const live = traceFiles().filter((f) => statusOf(readRecords(f)) === "running");
  console.log(`\n  ${c.bold("JHT agent monitor")} ${c.dim(`· ${logsDir}`)}`);
  console.log(
    live.length > 0
      ? `  ${c.dim(`following ${live.length} live run${live.length === 1 ? "" : "s"}, and any that start · ctrl-c to stop`)}`
      : `  ${c.dim("no live runs — waiting for an agent to start · ctrl-c to stop · --list for past runs")}`,
  );
  follow(live, true);
}
