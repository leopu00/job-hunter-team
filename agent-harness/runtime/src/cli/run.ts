/**
 * `npm run role` — run one role headless, on the API.
 *
 *   npm run role -- --role scout --agent scout-1 --turns 2
 *   npm run role -- --role demo --prompt path/to/prompt.md --task "Start your cycle."
 *
 *   --role <name>        the role: names its home (~/.jht-api/agents/<role>) and its trace
 *   --prompt <file>      the role's full system prompt, sent verbatim. Without it the
 *                        role is a product role, built from agents/<role>/ as the TUI
 *                        launcher builds it (docs/parity.md)
 *   --agent <name>       product role: the name peers address it by, which also names
 *                        its home and trace (default: the role)
 *   --turns <n>          product role: turns to run at most (default: 1)
 *   --pause-ms <ms>      product role: how long a `throttle` pause lasts (default: 600000)
 *   --task <text>        the first message (default: "Start.")
 *   --task-file <file>   the first message, from a file
 *   --skills <dir>       folder copied into the home as skills/ (not with a product role)
 *   --mock-script <f>    JSON turns for the mock provider (default: a built-in rehearsal)
 *
 * A product role reads its repo from `JHT_API_APP_ROOT` (default: this
 * checkout; `/app` in the container) and the person's locale from `JHT_HOME`
 * (default: `~/.jht`), as the launcher does.
 *   --quiet              no live view: the trace file only
 *   --verbose            full prompt, arguments, outputs and process samples
 *
 * Deliberately thin: everything below `RoleSession` knows nothing about a
 * terminal. Every event goes to the run's trace under `~/.jht-api/logs`
 * first and to the screen second, so what this prints is exactly what
 * `npm run monitor` shows for the same run. A live run appends its spend to
 * the ledger whatever way it ends.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, hostname, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadConfig, type Config } from "../config.ts";
import { prepareAgentHome, writeIdentity } from "../core/agent-home.ts";
import { JsonlAuditLog } from "../core/audit.ts";
import { HarnessError, isHarnessError } from "../core/errors.ts";
import { Guardrails } from "../core/guardrails.ts";
import { AgentLock } from "../core/agent-lock.ts";
import { appendLedger } from "../core/ledger.ts";
import { roleOf } from "../db/role-policy.ts";
import { resolveProvider } from "../core/provider/resolve.ts";
import { RoleSession } from "../core/role-session.ts";
import { JsonlTrace, sampleProcess, traceThen, type TraceSink } from "../core/trace.ts";
import { displayPath } from "../tools/paths.ts";
import { buildToolkit } from "../tools/toolkit.ts";
import { prepareProductRole, runCycles, type ProductRole } from "../parity/product-role.ts";
import { jobsDbPath, openJobsDb, type Database } from "../db/jobs-db.ts";
import { HubClient } from "../hub/client.ts";
import { resolveUserPath } from "../tools/paths.ts";
import { DEFAULT_MOCK_SCRIPT, productRoleMockScript, readMockScript } from "./mock-script.ts";
import { c, TraceView } from "./render.ts";

/** The checkout this file belongs to: `agent-harness/runtime/src/cli/` is four levels down. */
const CHECKOUT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** jobs.db, once a tool opened it. Closed when the run ends. */
let openedDb: Database | undefined;
let jobsDb: { path: string; open: () => Database } | undefined;

/** Kept outside `main` so a run that dies still records and shows why. */
let emit: TraceSink | undefined;
let stopSampling: (() => void) | undefined;
let settle: ((note: string) => void) | undefined;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      role: { type: "string" },
      prompt: { type: "string" },
      task: { type: "string" },
      "task-file": { type: "string" },
      skills: { type: "string" },
      agent: { type: "string" },
      turns: { type: "string" },
      "pause-ms": { type: "string" },
      "mock-script": { type: "string" },
      quiet: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.role) {
    throw new HarnessError(
      "config_invalid",
      "Usage: npm run role -- --role <name> [--prompt <file>] [--task <text>] [--agent <name>] [--turns <n>]",
    );
  }
  // No prompt file: a product role, built from agents/<role>/ like its TUI twin.
  const product = values.prompt === undefined;
  if (product && values.skills) {
    throw new HarnessError("config_invalid", "--skills is for a --prompt role; a product role takes its skills from agents/<role>/.");
  }
  if (!product && (values.agent || values.turns || values["pause-ms"])) {
    throw new HarnessError("config_invalid", "--agent, --turns and --pause-ms are for a product role, without --prompt.");
  }
  const turns = positiveInt(values.turns ?? "1", "--turns");
  const pauseMs = positiveInt(values["pause-ms"] ?? "600000", "--pause-ms", true);

  const config = loadConfig(process.env, values.agent ?? values.role);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();

  // One process per agent, and `scout` is `scout-1`: taken before anything is
  // written, released however the process exits (a lock left by a killed one
  // is taken over by the next start).
  const lock = AgentLock.acquire({ dir: join(config.apiHome, "locks"), agent: config.role, runId });
  process.once("exit", () => lock.release());

  // T37: the SENTINELLA is woken by a tick, not by a task. In the TUI a bridge
  // types it into its pane; here the harness composes it from the team's
  // ledger and hands it over as the turn's INPUT — never as a tool, which
  // would let the role ask for a tick again and again for nothing. A `--task`
  // given by hand still wins: that is how a person asks it something.
  const asked = values["task-file"] ? (await readFile(values["task-file"], "utf8")).trim() : values.task;
  // Loaded only for the role that is woken by a tick: every other run — and
  // every refusal of a wrong flag — pays nothing for it.
  const task =
    asked ??
    (roleOf(values.role) === "sentinella" ? await sentinellaTick(config.ledger) : "Start.");
  const script = values["mock-script"]
    ? await readMockScript(values["mock-script"])
    : product
      ? productRoleMockScript(values.role, config.userDir, config.profileDir ?? join(config.apiHome, "profile"), config.userHistoryDir)
      : DEFAULT_MOCK_SCRIPT;

  const provider = await resolveProvider(config, script);
  const pricing = config.profile.pricing;
  if (pricing === null) {
    throw new HarnessError("pricing_unknown", `No price is known for '${config.profile.modelId}'.`);
  }

  const audit = new JsonlAuditLog({ dir: config.auditDir, runId });
  const trace = new JsonlTrace({ dir: join(config.apiHome, "logs"), role: config.role, runId });
  const guardrails = new Guardrails({ limits: config.limits, pricing });
  const view = values.quiet ? undefined : new TraceView({ agentName: config.role, verbose: values.verbose });
  const sink = view ? traceThen(trace, view.handle) : (event: Parameters<TraceSink>[0]) => void trace.write(event);
  emit = sink;
  settle = ledgerWriter(config, runId, guardrails);
  // Stopped from outside (ctrl-c, `podman stop`): the spend so far is still recorded.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopSampling?.();
      const { steps, toolCalls, usage, costUsd, webSearches } = guardrails.state;
      sink({ type: "run_finished", reason: "stopped", steps, toolCalls, usage, costUsd, webSearches, durationMs: Date.now() - startedAt });
      settle?.("stopped");
      process.exit(130);
    });
  }

  // A real spawn starts the agent in a clean home holding only its identity
  // and skills. JHT_API_KEEP_HOME=1 keeps what earlier runs left there.
  const freshHome = process.env["JHT_API_KEEP_HOME"]?.trim() !== "1";
  await prepareAgentHome({
    dir: config.agentHome,
    role: config.role,
    fresh: freshHome,
    ...(values.skills ? { skillsSource: values.skills } : {}),
  });

  // The team database: its path is the runtime's, fixed here, never a tool
  // argument. Opened on first use, so a cycle that never touches it never
  // creates it. Resolved for every run, so the file tools are kept off it even
  // in a run that has no database tool.
  const dbFile = jobsDbPath(process.env, config.apiHome);

  let role: ProductRole | undefined;
  let systemPrompt: string;
  if (values.prompt === undefined) {
    const env = process.env;
    // With a hub (T18) the database and the channels are its: nothing opens them here.
    const hub = config.hub ? new HubClient(config.hub) : undefined;
    jobsDb = hub ? undefined : { path: dbFile, open: () => (openedDb ??= openJobsDb(dbFile)) };
    role = await prepareProductRole({
      appRoot: resolveUserPath(env["JHT_API_APP_ROOT"]?.trim() || CHECKOUT_ROOT, process.cwd(), homedir()),
      role: values.role,
      agent: config.role,
      homeDir: config.agentHome,
      apiHome: config.apiHome,
      userDir: config.userDir,
      ...(config.userHistoryDir ? { userHistoryDir: config.userHistoryDir } : {}),
      jhtHome: resolveUserPath(env["JHT_HOME"]?.trim() || "~/.jht", process.cwd(), homedir()),
      profileDir: config.profileDir,
      env,
      jobsDb,
      hub,
      // T41: only a live run has a ledger, and only a live run has runs to count.
      ...(config.ledger ? { ledger: config.ledger } : {}),
    });
    systemPrompt = role.systemPrompt.trimEnd();
  } else {
    systemPrompt = (await readFile(values.prompt, "utf8")).trimEnd();
  }

  // Headless: nobody is at a keyboard, so `ask` mode denies what it would ask.
  const toolkit = await buildToolkit(config, { provider, jobsDbFile: dbFile });
  const session = new RoleSession({
    provider,
    guardrails,
    audit,
    systemPrompt,
    tools: role ? role.tools(toolkit.tools) : toolkit.tools,
    // T35: a subagent of a product role gets a toolkit built for a child, not
    // the parent's — the critic-loop's CRITICO runs in here.
    ...(role ? { subagentTools: role.subagentTools(toolkit.tools) } : {}),
    permissions: toolkit.permissions,
    workdir: config.workdir,
    platform: toolkit.platform,
    subagents: true,
    todos: true,
    onEvent: sink,
  });
  await writeIdentity(config.agentHome, session.systemPrompt);

  await audit.write({
    type: "run_started",
    providerId: config.profile.providerId,
    modelId: config.profile.modelId,
    live: config.live,
    budgetUsd: config.limits.budgetUsd,
  });
  sink({
    type: "run_started",
    pid: process.pid,
    providerId: config.profile.providerId,
    modelId: config.profile.modelId,
    live: config.live,
    pricing,
    budgetUsd: config.limits.budgetUsd,
    limits: { ...config.limits },
    permissionMode: config.permissionMode,
    workdir: config.workdir,
    agentHome: config.agentHome,
    tools: session.toolNames,
    ...(toolkit.mcpServers.length > 0
      ? {
          mcp: toolkit.mcpServers.map((s) =>
            s.error ? `${s.name} (failed: ${s.error})` : `${s.name} (${s.toolCount} tool${s.toolCount === 1 ? "" : "s"})`,
          ),
        }
      : {}),
    node: process.versions.node,
    platform: `${platform()} ${release()} · ${hostname()}`,
  });
  if (view) {
    console.log(`  ${c.dim("trace  ")} ${displayPath(trace.path)} ${c.dim(freshHome ? "· home fresh" : "· home kept")}`);
    console.log(`  ${c.dim("monitor")} npm run monitor ${c.dim("· from any terminal")}`);
  } else {
    console.log(trace.path);
  }
  stopSampling = sampleProcess(sink);

  try {
    if (role) {
      await runCycles(session, { agent: config.role, task, maxTurns: turns, mailbox: role.mailbox, pause: role.pause, pauseMs });
    } else {
      await session.send(task);
    }
  } finally {
    await toolkit.close();
    openedDb?.close();
  }

  stopSampling();
  const { steps, toolCalls, usage, costUsd, webSearches } = guardrails.state;
  await audit.write({ type: "run_finished", steps, usage, costUsd });
  sink({ type: "run_finished", reason: "completed", steps, toolCalls, usage, costUsd, webSearches, durationMs: Date.now() - startedAt });
  settle("completed");
  return 0;
}

function positiveInt(raw: string, flag: string, zeroOk = false): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < (zeroOk ? 0 : 1)) {
    throw new HarnessError("config_invalid", `${flag} must be a whole number${zeroOk ? "" : " above zero"}; got '${raw}'.`);
  }
  return value;
}

/**
 * Writes the run's line to the ledger, once, on a live run. Returned before
 * the first model call so that a run that fails half-way is recorded too:
 * the money it spent is spent.
 */
/** T37-3: the tick that wakes the SENTINELLA, or the reason there is no window. */
async function sentinellaTick(ledger: string | undefined): Promise<string> {
  const { tickForTurn, windowFromEnv } = await import("../parity/sentinel-tick.ts");
  return tickForTurn({ ledger, now: new Date(), window: windowFromEnv(process.env) });
}

function ledgerWriter(config: Config, runId: string, guardrails: Guardrails): (note: string) => void {
  let written = false;
  return (note) => {
    if (written || !config.live || !config.ledger) return;
    written = true;
    const { usage, costUsd, webSearches } = guardrails.state;
    appendLedger(config.ledger, {
      webSearches,
      at: new Date(),
      role: config.role,
      model: `${config.profile.providerId}/${config.profile.modelId}`,
      usage,
      costUsd,
      runId,
      note,
    });
  };
}

try {
  process.exitCode = await main();
} catch (error) {
  stopSampling?.();
  settle?.(isHarnessError(error) ? error.code : "crash");
  if (isHarnessError(error) && emit) {
    emit({ type: "run_failed", code: error.code, message: error.message });
    process.exitCode = 1;
  } else if (isHarnessError(error)) {
    console.error(`\n  ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    emit?.({ type: "run_failed", code: "crash", message: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    throw error;
  }
}
