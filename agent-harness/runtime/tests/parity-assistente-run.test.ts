/**
 * T38: `npm run role -- --role assistente`, as a person would type it.
 *
 * The ASSISTENTE is the one role that talks to the person, and the one that
 * writes their profile: `candidate_profile.yml` is what the whole team then
 * reads, and rule A-02 says every write of it is followed by a validation.
 * So this run does exactly that — picks up what the person said, reads the
 * profile, writes what they told it, validates the write, answers them and
 * hands the operational half to the CAPITANO.
 *
 * The other half of the same claim is checked here too: the exception is one
 * role wide. The same profile, in the same layout, is refused to a SCOUT's
 * `write_file` — if the permission were granted by folder instead of by role,
 * that second run would pass and nobody would notice.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MOCK_PROFILE, MockProvider } from "../src/core/provider/mock.ts";
import { openJobsDb } from "../src/db/jobs-db.ts";
import { buildToolkit } from "../src/tools/toolkit.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const CONTEXT = { account: undefined as never, remainingMs: () => 60_000 };

const run = promisify(execFile);

let root: string;
let profileDir: string;
let historyDir: string;
let imageRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-assistente-run-"));
  profileDir = join(root, "person-profile");
  historyDir = join(root, "person-documents");
  imageRoot = join(root, "image-app");
  await mkdir(profileDir, { recursive: true });
  await mkdir(historyDir, { recursive: true });
  await writeFile(join(profileDir, "candidate_profile.yml"), "name: A Person\ntarget_role: Backend Engineer\n");
  await writeFile(join(historyDir, "CV_2024.md"), "# The CV the person wrote in 2024\n");
  await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });
  // The dashboard the person asks about.
  const db = openJobsDb(join(root, "api", "db", "jobs.db"));
  db.prepare(
    "INSERT INTO positions (title, company, url, status, found_by, found_at) VALUES ('Backend Engineer', 'Acme', 'https://acme.example/jobs/1', 'scored', 'scout-1', '2026-09-20 09:00:00')",
  ).run();
  db.close();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const env = () => ({
  PATH: process.env["PATH"] ?? "",
  HOME: root,
  JHT_API_HOME: join(root, "api"),
  JHT_HOME: join(root, "jht"),
  JHT_API_PROFILE_DIR: profileDir,
  JHT_API_USER_HISTORY_DIR: historyDir,
  JHT_API_APP_ROOT: imageRoot,
  JHT_API_PROVIDER: "mock",
});

/** Runs one role to the end and gives back what the trace recorded. */
async function runRole(role: string, agent: string) {
  const { stdout } = await run(
    process.execPath,
    ["--experimental-strip-types", "src/cli/run.ts", "--role", role, "--agent", agent, "--turns", "2", "--pause-ms", "0", "--quiet"],
    { cwd: RUNTIME, env: env() },
  );
  const records = (await readFile(stdout.trim(), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; [key: string]: unknown });
  const finished = records.filter((record) => record.type === "tool_finished");
  return { records, finished, outcomes: finished.map((r) => [r["name"], r["outcome"]]), results: finished.map((r) => String(r["result"])) };
}

describe("npm run role -- --role assistente (T38)", () => {
  it("writes the person's profile, validates it, and answers them", async () => {
    const { records, outcomes, results } = await runRole("assistente", "assistente-1");

    expect(outcomes).toEqual([
      ["read_file", "accepted"],
      ["check_user_replies", "accepted"],
      ["read_file", "accepted"],
      // The write no other role may make.
      ["write_file", "accepted"],
      ["validate_profile", "accepted"],
      ["read_file", "accepted"],
      // The person's own documents stay theirs.
      ["write_file", "denied"],
      ["db_query", "accepted"],
      ["chat_reply", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    expect(results[4]).toContain("VALID_PROFILE");
    expect(results[5]).toContain("The CV the person wrote in 2024");
    expect(results[6]).toMatch(/not allowed|read-only|refused/i);
    // The dashboard the person asked about: the position seeded above is in it.
    expect(results[7]).toMatch(/JOB HUNTER — DASHBOARD/);
    expect(results[7]).toMatch(/Acme|scored|1/);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // What the person told it is on disk, and it is a profile the team can read.
    const profile = await readFile(join(profileDir, "candidate_profile.yml"), "utf8");
    expect(profile).toContain("location: Roma, Italia");
    expect(profile).toContain("experience_years: 6");
    expect(await readFile(join(historyDir, "CV_2024.md"), "utf8")).toBe("# The CV the person wrote in 2024\n");

    // The prompt it ran on is the TUI's, with the profile's real path in it.
    const prompt = records.find((record) => record.type === "system_prompt")?.["text"] as string;
    expect(prompt).toContain(profileDir);
    expect(prompt).not.toMatch(/python3/);
    // A-02 names the validator, and it is a tool here, not a script.
    expect(prompt).toMatch(/validate_profile\b/);
    expect(prompt).not.toMatch(/validate_profile\.py/);
  });

  it("gives that profile to no other role: the same write from a SCOUT is refused", async () => {
    // The counter-proof of the exception, at the layer that grants it. A
    // permission given by FOLDER instead of by ROLE would pass both of these.
    const write = async (agent: string) => {
      const toolkit = await buildToolkit(
        {
          role: agent,
          workdir: join(root, "api", "agents", agent),
          agentHome: join(root, "api", "agents", agent),
          apiHome: join(root, "api"),
          profileDir,
          userHistoryDir: historyDir,
          permissionMode: "auto",
          profile: MOCK_PROFILE,
        },
        { provider: new MockProvider([]) },
      );
      const tool = toolkit.tools.find((handler) => handler.spec.name === "write_file")!;
      const args = tool.spec.schema.parse({ path: join(profileDir, "candidate_profile.yml"), content: "name: Someone Else\n" });
      const decision = await toolkit.permissions.decide("write_file", tool.classify(args));
      return decision.allowed ? { allowed: true, said: (await tool.execute(args, CONTEXT)).content } : { allowed: false, said: decision.message ?? "" };
    };

    expect(await write("assistente-1")).toMatchObject({ allowed: true });
    const scout = await write("scout-1");
    expect(scout.allowed).toBe(false);
    expect(scout.said).toMatch(/read-only|not allowed|protected/i);
    // And the history is nobody's to write, the ASSISTENTE included.
    expect(await readFile(join(historyDir, "CV_2024.md"), "utf8")).toBe("# The CV the person wrote in 2024\n");
  });
});
