/**
 * Bash Tool — Esecutore comandi shell
 *
 * Esegue comandi bash con timeout, cattura output,
 * gestione working directory e variabili ambiente.
 */

import { spawn } from "node:child_process";
import type { Tool, ToolResult, ExecToolDefaults, ExecToolDetails } from "./types.js";

const DEFAULT_TIMEOUT_SEC = 120;
const DEFAULT_MAX_OUTPUT = 64 * 1024; // 64KB

function textResult(text: string, details: ExecToolDetails): ToolResult<ExecToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output) <= maxBytes) return output;
  const half = Math.floor(maxBytes / 2);
  const start = output.slice(0, half);
  const end = output.slice(-half);
  return `${start}\n\n--- output troncato (${Buffer.byteLength(output)} bytes) ---\n\n${end}`;
}

function runCommand(
  command: string,
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
    signal: AbortSignal;
  },
): Promise<{ exitCode: number | null; output: string; timedOut: boolean; durationMs: number }> {
  return new Promise((resolve) => {
    const startMs = Date.now();
    let output = "";
    let timedOut = false;

    const proc = spawn("bash", ["-c", command], {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 3_000);
    }, opts.timeoutMs);

    const onAbort = () => {
      proc.kill("SIGTERM");
      clearTimeout(timer);
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });

    proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code,
        output: truncateOutput(output, DEFAULT_MAX_OUTPUT),
        timedOut,
        durationMs: Date.now() - startMs,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
      resolve({
        exitCode: null,
        output: `Errore spawn: ${err.message}`,
        timedOut: false,
        durationMs: Date.now() - startMs,
      });
    });
  });
}

/**
 * Crea un tool "exec" per eseguire comandi bash.
 */
export function createExecTool(defaults?: ExecToolDefaults): Tool<{ command: string }, ExecToolDetails> {
  const timeoutSec = defaults?.timeoutSec ?? DEFAULT_TIMEOUT_SEC;

  return {
    name: "exec",
    label: "exec",
    description: "Esegue comandi shell bash",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Comando bash da eseguire" },
      },
      required: ["command"],
    },
    execute: async (_toolCallId, args, signal) => {
      const cwd = defaults?.cwd || process.cwd();
      const result = await runCommand(args.command, {
        cwd,
        env: defaults?.env,
        timeoutMs: timeoutSec * 1_000,
        signal,
      });

      const isSuccess = result.exitCode === 0;
      const status = isSuccess ? "completed" : "failed";
      const displayOutput = result.output || "(nessun output)";

      return textResult(displayOutput, {
        status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: result.output,
        timedOut: result.timedOut,
        cwd,
      });
    },
  };
}
