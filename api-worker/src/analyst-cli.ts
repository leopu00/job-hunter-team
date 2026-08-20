import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnalystApiWorker } from "./analyst-worker.js";

type CliOptions = {
  live: boolean;
  inputPath: string;
  profilePath: string;
  runtimeDir: string;
  inputExplicit: boolean;
  profileExplicit: boolean;
  maxCostUsd?: number;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && (!options.inputExplicit || !options.profileExplicit)) {
    throw new Error("--live requires explicit input and model profile files");
  }
  const [inputValue, profile] = await Promise.all([
    readJson(options.inputPath),
    readJson(options.profilePath),
  ]);
  const input = applyCostOverride(inputValue, options.maxCostUsd);
  const outcome = await new AnalystApiWorker(profile, {
    runtimeDir: options.runtimeDir,
    liveEnabled: options.live,
  }).run(input);
  const stream = outcome.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(outcome, null, 2)}\n`);
  if (!outcome.ok) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    live: false,
    inputPath: join(packageRoot, "fixtures", "analyst-input.synthetic.json"),
    profilePath: join(packageRoot, "fixtures", "mock-profile.json"),
    runtimeDir: join(packageRoot, ".runs", "analyst"),
    inputExplicit: false,
    profileExplicit: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") {
      options.live = true;
      continue;
    }
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    switch (argument) {
      case "--input":
        options.inputPath = resolve(value);
        options.inputExplicit = true;
        break;
      case "--profile":
        options.profilePath = resolve(value);
        options.profileExplicit = true;
        break;
      case "--runtime-dir":
        options.runtimeDir = resolve(value);
        break;
      case "--max-cost-usd":
        options.maxCostUsd = Number(value);
        if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0) {
          throw new Error("Invalid --max-cost-usd");
        }
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }
  if (options.live && !options.maxCostUsd) {
    throw new Error("--live requires a positive --max-cost-usd");
  }
  return options;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function applyCostOverride(value: unknown, maxCostUsd?: number): unknown {
  if (maxCostUsd === undefined || typeof value !== "object" || value === null) {
    return value;
  }
  const input = structuredClone(value) as { limits?: Record<string, unknown> };
  input.limits = { ...input.limits, maxCostUsd };
  return input;
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: "CLI_CONFIGURATION", message: "The Analyst API command is invalid or unreadable." } })}\n`,
  );
  process.exitCode = 1;
});
