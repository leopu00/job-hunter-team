import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importCandidateProfile2026 } from "./candidate-profile-import.js";
import { ApiTeamRunner } from "./team-runner.js";
import { SyntheticJobSource } from "./tools.js";

type CliOptions = {
  live: boolean;
  candidatePath: string;
  modelPath: string;
  jobsPath: string;
  workspaceDir: string;
  budgetUsd: number;
  maxAgentCostUsd: number;
  targetScores: number;
  targetReviews: number;
  candidateExplicit: boolean;
  modelExplicit: boolean;
  workspaceExplicit: boolean;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (
    options.live &&
    (!options.candidateExplicit ||
      !options.modelExplicit ||
      !options.workspaceExplicit)
  ) {
    throw new Error(
      "--live requires explicit --candidate-profile, --model-profile and --workspace",
    );
  }
  if (options.live && options.budgetUsd <= 0)
    throw new Error("--live requires a positive --max-cost-usd");
  const [candidateRaw, modelProfile, jobs] = await Promise.all([
    readJson(options.candidatePath),
    readJson(options.modelPath),
    readJson(options.jobsPath),
  ]);
  const now = () => new Date();
  const result = await new ApiTeamRunner({
    workspaceDir: options.workspaceDir,
    candidate: importCandidateProfile2026(candidateRaw, {
      maxCandidates: options.targetScores,
    }),
    modelProfile,
    source: new SyntheticJobSource(jobs, now),
    liveEnabled: options.live,
    budgetUsd: options.budgetUsd,
    maxAgentCostUsd: options.maxAgentCostUsd,
    targetScores: options.targetScores,
    targetReviews: options.targetReviews,
    now,
  }).run();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runId: result.runId,
        summary: result.summary,
        captain: {
          decisions: result.captain.decisions,
          priorities: result.captain.priorities,
        },
        sentinel: { budgetState: result.sentinel.budgetState },
        agents: result.usage,
        positions: result.positions,
        timeline: result.events.map((event) => ({
          sequence: event.sequence,
          sourceId: event.sourceId,
          actor: event.actor,
          event: event.event,
          from: event.fromRole,
          to: event.toRole,
        })),
        databasePath: result.databasePath,
        artifactDirectory: result.artifactDirectory,
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    live: false,
    candidatePath: join(
      packageRoot,
      "fixtures",
      "candidate-profile-2026.synthetic.json",
    ),
    modelPath: join(packageRoot, "fixtures", "mock-profile.json"),
    jobsPath: join(packageRoot, "fixtures", "jobs.synthetic.json"),
    workspaceDir: join(packageRoot, ".team"),
    budgetUsd: 0,
    maxAgentCostUsd: 0.02,
    targetScores: 5,
    targetReviews: 2,
    candidateExplicit: false,
    modelExplicit: false,
    workspaceExplicit: false,
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
        options.workspaceExplicit = true;
        break;
      case "--max-cost-usd":
        options.budgetUsd = finiteNumber(value, argument);
        break;
      case "--max-agent-cost-usd":
        options.maxAgentCostUsd = finiteNumber(value, argument);
        break;
      case "--target-scores":
        options.targetScores = integer(value, argument);
        break;
      case "--target-reviews":
        options.targetReviews = integer(value, argument);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }
  return options;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function finiteNumber(value: string, argument: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`Invalid ${argument}`);
  return parsed;
}

function integer(value: string, argument: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid ${argument}`);
  return parsed;
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: "TEAM_CLI_FAILED", message: "The isolated API team run failed safely; inspect local audit artifacts." } })}\n`,
  );
  process.exitCode = 1;
});
