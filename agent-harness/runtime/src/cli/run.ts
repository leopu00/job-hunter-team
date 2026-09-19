/**
 * `npm run role` — run one role headless, on the API.
 *
 *   npm run role -- --role scout --prompt path/to/prompt.md --task "Start your cycle."
 *
 *   --role <name>        the role: names its home (~/.jht-api/agents/<role>) and its trace
 *   --prompt <file>      the role's full system prompt, sent verbatim
 *   --task <text>        the first message (default: "Start.")
 *   --task-file <file>   the first message, from a file
 *   --skills <dir>       folder copied into the home as skills/
 *   --mock-script <f>    JSON turns for the mock provider (default: a built-in rehearsal)
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
import { hostname, platform, release } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { loadConfig, type Config } from "../config.ts";
import { prepareAgentHome, writeIdentity } from "../core/agent-home.ts";
import { JsonlAuditLog } from "../core/audit.ts";
import { HarnessError, isHarnessError } from "../core/errors.ts";
import { Guardrails } from "../core/guardrails.ts";
import { appendLedger } from "../core/ledger.ts";
import { resolveProvider } from "../core/provider/resolve.ts";
import { RoleSession } from "../core/role-session.ts";
import { JsonlTrace, sampleProcess, traceThen, type TraceSink } from "../core/trace.ts";
import { displayPath } from "../tools/paths.ts";
import { buildToolkit } from "../tools/toolkit.ts";
import { DEFAULT_MOCK_SCRIPT, readMockScript } from "./mock-script.ts";
import { c, TraceView } from "./render.ts";

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
      "mock-script": { type: "string" },
      quiet: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.role || !values.prompt) {
    throw new HarnessError("config_invalid", "Usage: npm run role -- --role <name> --prompt <file> [--task <text>]");
  }

  const config = loadConfig(process.env, values.role);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();

  const systemPrompt = (await readFile(values.prompt, "utf8")).trimEnd();
  const task = values["task-file"] ? (await readFile(values["task-file"], "utf8")).trim() : (values.task ?? "Start.");
  const script = values["mock-script"] ? await readMockScript(values["mock-script"]) : DEFAULT_MOCK_SCRIPT;

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
      const { steps, toolCalls, usage, costUsd } = guardrails.state;
      sink({ type: "run_finished", reason: "stopped", steps, toolCalls, usage, costUsd, durationMs: Date.now() - startedAt });
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

  // Headless: nobody is at a keyboard, so `ask` mode denies what it would ask.
  const toolkit = await buildToolkit(config, { provider });
  const session = new RoleSession({
    provider,
    guardrails,
    audit,
    systemPrompt,
    tools: toolkit.tools,
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
    await session.send(task);
  } finally {
    await toolkit.close();
  }

  stopSampling();
  const { steps, toolCalls, usage, costUsd } = guardrails.state;
  await audit.write({ type: "run_finished", steps, usage, costUsd });
  sink({ type: "run_finished", reason: "completed", steps, toolCalls, usage, costUsd, durationMs: Date.now() - startedAt });
  settle("completed");
  return 0;
}

/**
 * Writes the run's line to the ledger, once, on a live run. Returned before
 * the first model call so that a run that fails half-way is recorded too:
 * the money it spent is spent.
 */
function ledgerWriter(config: Config, runId: string, guardrails: Guardrails): (note: string) => void {
  let written = false;
  return (note) => {
    if (written || !config.live || !config.ledger) return;
    written = true;
    const { usage, costUsd } = guardrails.state;
    appendLedger(config.ledger, {
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
