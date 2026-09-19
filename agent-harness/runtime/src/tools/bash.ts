/**
 * The shell.
 *
 * One tool that makes every command-line program on the machine available —
 * which is why it is the most useful tool an agent can have and the one the
 * permission gate exists for. Four rules:
 *
 * - **A deadline.** A command that does not finish is killed, with its whole
 *   process group, and the model is told. A hung `npm install` must not hang
 *   the agent.
 * - **No secrets in reach.** Environment variables that look like keys,
 *   tokens or passwords are removed before the command starts, so `env` cannot
 *   print the provider key into the conversation.
 * - **No stdin.** A command waiting for input gets end-of-file instead of
 *   waiting forever.
 * - **The exit code is part of the result.** Output alone does not say whether
 *   a command failed; many programs write to stderr when all is well.
 *
 * Beside the text, each run reports structured details for the trace: exit
 * code, signal, output sizes and — where `/usr/bin/time` is available — the
 * CPU time and peak memory the command used.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { CommandResources } from "../core/trace.ts";
import type { ToolHandler, ToolExecution } from "./registry.ts";

export interface BashToolOptions {
  workdir: string;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
/** Bytes kept per stream while the command runs. The runtime caps the result again afterwards. */
const MAX_STREAM_BYTES = 1_000_000;
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;

export function createBashTool(options: BashToolOptions): ToolHandler {
  const defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTimeout = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;

  return {
    spec: {
      name: "bash",
      description:
        "Run a shell command with bash and return its exit code, stdout and stderr. " +
        "The command starts in the working folder; use absolute paths or cd to go elsewhere. " +
        "It has no stdin and is killed after timeout_ms (default 120000). " +
        "Prefer read_file, glob and grep for reading and searching files.",
      schema: z
        .object({
          command: z.string().min(1).max(10_000),
          timeout_ms: z.number().int().min(1_000).max(maxTimeout).optional(),
        })
        .strict(),
    },

    classify(args) {
      const { command } = args as { command: string };
      return { risk: "execute", paths: [], summary: command.replace(/\s+/g, " ").trim() };
    },

    execute(args) {
      const { command, timeout_ms } = args as { command: string; timeout_ms?: number };
      return run(command, options.workdir, timeout_ms ?? defaultTimeout);
    },
  };
}

function run(command: string, cwd: string, timeoutMs: number): Promise<ToolExecution> {
  return new Promise((resolvePromise) => {
    const meter = TIME_FLAGS ? mkdtempSync(join(tmpdir(), "jht-api-time-")) : undefined;
    const meterFile = meter ? join(meter, "rusage") : undefined;
    const [bin, argv] = meterFile && TIME_FLAGS
      ? ["/usr/bin/time", [...TIME_FLAGS, "-o", meterFile, "/bin/bash", "-c", command]]
      : ["/bin/bash", ["-c", command]];
    const startedAt = Date.now();
    const child = spawn(bin, argv, {
      cwd,
      env: scrubEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so a timeout can kill everything it started.
      detached: true,
    });

    const stdout = collector();
    const stderr = collector();
    child.stdout.on("data", stdout.push);
    child.stderr.on("data", stderr.push);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (meter) rmSync(meter, { recursive: true, force: true });
      resolvePromise({ ok: false, content: `The command could not be started: ${error.message}` });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const resources: CommandResources = { wallMs: Date.now() - startedAt, ...readResources(meterFile) };
      if (meter) rmSync(meter, { recursive: true, force: true });
      const sections: string[] = [];
      if (timedOut) {
        sections.push(`timed out after ${timeoutMs / 1000}s — the command and everything it started were killed`);
      } else {
        sections.push(signal ? `killed by ${signal}` : `exit code ${code}`);
      }
      const out = stdout.text();
      const err = stderr.text();
      if (out) sections.push(`--- stdout ---\n${out}`);
      if (err) sections.push(`--- stderr ---\n${err}`);
      if (!out && !err) sections.push("(no output)");
      resolvePromise({
        ok: !timedOut && code === 0,
        content: sections.join("\n"),
        details: {
          exitCode: code,
          signal,
          timedOut,
          stdoutBytes: stdout.bytes(),
          stderrBytes: stderr.bytes(),
          resources,
        },
      });
    });
  });
}

function collector() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let dropped = 0;
  return {
    bytes: () => bytes + dropped,
    push: (chunk: Buffer) => {
      if (bytes >= MAX_STREAM_BYTES) {
        dropped += chunk.length;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    },
    text: () => {
      const text = Buffer.concat(chunks).toString("utf8").replace(/\n$/, "");
      return dropped > 0 ? `${text}\n[${dropped} more bytes discarded]` : text;
    },
  };
}

/**
 * Flags that make `/usr/bin/time` write resource usage to a file: `-l` on BSD
 * and macOS, `-v` on GNU. Probed once; null where neither works, and commands
 * then run without measurement rather than fail.
 */
const TIME_FLAGS: string[] | null = (() => {
  for (const flags of [["-l"], ["-v"]]) {
    const probe = spawnSync("/usr/bin/time", [...flags, "-o", "/dev/null", "/bin/bash", "-c", "true"], { stdio: "ignore" });
    if (probe.status === 0) return flags;
  }
  return null;
})();

/** CPU and peak memory from a `/usr/bin/time` report, BSD or GNU. */
export function parseTimeReport(report: string): CommandResources {
  const resources: CommandResources = {};
  const bsd = /([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/.exec(report);
  if (bsd) {
    resources.cpuUserMs = Math.round(Number(bsd[2]) * 1000);
    resources.cpuSystemMs = Math.round(Number(bsd[3]) * 1000);
  }
  const bsdRss = /(\d+)\s+maximum resident set size/.exec(report);
  if (bsdRss) resources.maxRssBytes = Number(bsdRss[1]);

  const gnuUser = /User time \(seconds\): ([\d.]+)/.exec(report);
  const gnuSys = /System time \(seconds\): ([\d.]+)/.exec(report);
  const gnuRss = /Maximum resident set size \(kbytes\): (\d+)/.exec(report);
  if (gnuUser) resources.cpuUserMs = Math.round(Number(gnuUser[1]) * 1000);
  if (gnuSys) resources.cpuSystemMs = Math.round(Number(gnuSys[1]) * 1000);
  if (gnuRss) resources.maxRssBytes = Number(gnuRss[1]) * 1024;
  return resources;
}

function readResources(file: string | undefined): CommandResources {
  if (!file) return {};
  try {
    return parseTimeReport(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** The environment minus anything that looks like a credential. */
export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_NAME.test(name)));
}
