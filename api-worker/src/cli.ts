import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SyntheticJobSource } from "./tools.js";
import { ScoutApiWorker } from "./worker.js";

type CliOptions = {
  live: boolean;
  inputPath: string;
  profilePath: string;
  jobsPath: string;
  runtimeDir: string;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [input, profile, jobs] = await Promise.all([
    readJson(options.inputPath),
    readJson(options.profilePath),
    readJson(options.jobsPath),
  ]);

  const worker = new ScoutApiWorker(profile, {
    runtimeDir: options.runtimeDir,
    source: new SyntheticJobSource(jobs),
    liveEnabled: options.live,
  });
  const outcome = await worker.run(input);
  const stream = outcome.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(outcome, null, 2)}\n`);
  if (!outcome.ok) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  let live = false;
  let inputPath = join(packageRoot, "fixtures", "scout-input.synthetic.json");
  let profilePath = join(packageRoot, "fixtures", "mock-profile.json");
  let jobsPath = join(packageRoot, "fixtures", "jobs.synthetic.json");
  let runtimeDir = join(packageRoot, ".runs");
  let inputExplicit = false;
  let profileExplicit = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") {
      live = true;
      continue;
    }
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    switch (argument) {
      case "--input":
        inputPath = resolve(value);
        inputExplicit = true;
        break;
      case "--profile":
        profilePath = resolve(value);
        profileExplicit = true;
        break;
      case "--jobs":
        jobsPath = resolve(value);
        break;
      case "--runtime-dir":
        runtimeDir = resolve(value);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
    index += 1;
  }

  if (live && (!inputExplicit || !profileExplicit)) {
    throw new Error("--live requires explicit --input and --profile files");
  }
  return { live, inputPath, profilePath, jobsPath, runtimeDir };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: "CLI_CONFIGURATION", message: "The API worker command is invalid or unreadable." } })}\n`,
  );
  process.exitCode = 1;
});
