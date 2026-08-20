import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import { StandaloneScout } from "./standalone.js";
import { SyntheticJobSource, type ScoutJobSource } from "./tools.js";

type CliOptions = {
  live: boolean;
  candidatePath: string;
  modelPath: string;
  jobsPath: string;
  workspaceDir: string;
  agentId: string;
  maxCostUsd: number;
  maxWebSearches: number;
  candidateExplicit: boolean;
  modelExplicit: boolean;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && (!options.candidateExplicit || !options.modelExplicit)) {
    throw new Error(
      "--live requires explicit --candidate-profile and --model-profile files",
    );
  }
  if (options.live && options.maxCostUsd <= 0) {
    throw new Error("--live requires a positive --max-cost-usd");
  }
  const [candidateProfile, modelProfile] = await Promise.all([
    readData(options.candidatePath),
    readData(options.modelPath),
  ]);
  let source: ScoutJobSource = new EmptyJobSource();
  if (!options.live) {
    source = new SyntheticJobSource(await readData(options.jobsPath));
  }
  const result = await new StandaloneScout({
    agentId: options.agentId,
    workspaceDir: options.workspaceDir,
    candidateProfile,
    modelProfile,
    source,
    liveEnabled: options.live,
    webEnabled: options.live,
    maxCostUsd: options.maxCostUsd,
    maxWebSearches: options.maxWebSearches,
  }).runOnce();

  const summary = {
    ok: result.worker.ok,
    runId: result.runId,
    databasePath: result.databasePath,
    coordination: {
      mode: result.coordination.mode,
      peerCount: result.coordination.peers.length,
      lane: result.coordination.lane,
    },
    persistence: result.persistence,
    worker: result.worker.ok
      ? {
          provider: result.worker.result.provider,
          model: result.worker.result.model,
          proposals: result.worker.result.proposals.length,
          usage: result.worker.result.usage,
          cost: result.worker.result.cost,
          metrics: result.worker.result.metrics,
          stopReason: result.worker.result.stopReason,
        }
      : result.worker.error,
  };
  const stream = result.worker.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!result.worker.ok) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    live: false,
    candidatePath: join(
      packageRoot,
      "fixtures",
      "candidate-profile.synthetic.yml",
    ),
    modelPath: join(packageRoot, "fixtures", "mock-profile.json"),
    jobsPath: join(packageRoot, "fixtures", "jobs.synthetic.json"),
    workspaceDir: join(packageRoot, ".standalone"),
    agentId: `scout-${process.pid}`,
    maxCostUsd: 0,
    maxWebSearches: 4,
    candidateExplicit: false,
    modelExplicit: false,
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
      case "--candidate-profile":
        options.candidatePath = resolve(value);
        options.candidateExplicit = true;
        break;
      case "--model-profile":
        options.modelPath = resolve(value);
        options.modelExplicit = true;
        break;
      case "--jobs":
        options.jobsPath = resolve(value);
        break;
      case "--workspace":
        options.workspaceDir = resolve(value);
        break;
      case "--agent-id":
        options.agentId = value;
        break;
      case "--max-cost-usd":
        options.maxCostUsd = Number(value);
        if (!Number.isFinite(options.maxCostUsd))
          throw new Error("Invalid --max-cost-usd");
        break;
      case "--max-web-searches":
        options.maxWebSearches = Number(value);
        if (
          !Number.isInteger(options.maxWebSearches) ||
          options.maxWebSearches < 1 ||
          options.maxWebSearches > 10
        ) {
          throw new Error("Invalid --max-web-searches (expected 1-10)");
        }
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }
  return options;
}

async function readData(path: string): Promise<unknown> {
  const contents = await readFile(path, "utf8");
  return path.toLowerCase().endsWith(".json")
    ? JSON.parse(contents)
    : parseYaml(contents);
}

class EmptyJobSource implements ScoutJobSource {
  async search() {
    return { jobs: [] };
  }

  async read() {
    return null;
  }
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: "CLI_CONFIGURATION", message: "The standalone Scout command is invalid or unreadable." } })}\n`,
  );
  process.exitCode = 1;
});
