import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  StructuredRoleOutcome,
  StructuredRoleProposal,
} from "./structured-role-worker.js";

type CliWorker = {
  run(input: unknown): Promise<StructuredRoleOutcome<StructuredRoleProposal>>;
};

type CliDefinition = {
  label: string;
  fixtureName: string;
  fixtureKey?: string;
  runtimeName: string;
  createWorker(profile: unknown, runtimeDir: string, live: boolean): CliWorker;
};

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

export async function runStructuredRoleCli(
  definition: CliDefinition,
): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2), definition);
    const [inputValue, profile] = await Promise.all([
      readJson(options.inputPath),
      readJson(options.profilePath),
    ]);
    const selectedInput = selectFixtureInput(inputValue, definition.fixtureKey);
    const input = applyCostOverride(selectedInput, options.maxCostUsd);
    const outcome = await definition
      .createWorker(profile, options.runtimeDir, options.live)
      .run(input);
    const stream = outcome.ok ? process.stdout : process.stderr;
    stream.write(`${JSON.stringify(outcome, null, 2)}\n`);
    if (!outcome.ok) process.exitCode = 1;
  } catch {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: { code: "CLI_CONFIGURATION", message: `The ${definition.label} API command is invalid or unreadable.` } })}\n`,
    );
    process.exitCode = 1;
  }
}

function selectFixtureInput(value: unknown, key?: string): unknown {
  if (!key || typeof value !== "object" || value === null) return value;
  const envelope = value as {
    sharedLimits?: unknown;
    inputs?: Record<string, unknown>;
  };
  const selected = envelope.inputs?.[key];
  if (typeof selected !== "object" || selected === null) return value;
  return { ...selected, limits: envelope.sharedLimits };
}

function parseArgs(args: string[], definition: CliDefinition): CliOptions {
  const options: CliOptions = {
    live: false,
    inputPath: join(packageRoot, "fixtures", definition.fixtureName),
    profilePath: join(packageRoot, "fixtures", "mock-profile.json"),
    runtimeDir: join(packageRoot, ".runs", definition.runtimeName),
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
    if (!value) throw new Error("missing argument value");
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
          throw new Error("invalid cost limit");
        }
        break;
      default:
        throw new Error("unknown argument");
    }
    index += 1;
  }
  if (options.live && (!options.inputExplicit || !options.profileExplicit)) {
    throw new Error("live files must be explicit");
  }
  if (options.live && !options.maxCostUsd) {
    throw new Error("live cost limit must be explicit");
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
