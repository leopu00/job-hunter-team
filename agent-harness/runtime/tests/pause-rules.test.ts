import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";
import { prepareAgentHome } from "../src/core/agent-home.ts";
import { NullAuditLog } from "../src/core/audit.ts";
import { Guardrails } from "../src/core/guardrails.ts";
import { MockProvider, type ScriptedTurn } from "../src/core/provider/mock.ts";
import { RoleSession, type SessionEvent } from "../src/core/role-session.ts";
import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { loadPauseRules, NO_RULES, PausePolicy, watchInserts, WorkUnit } from "../src/parity/pause-rules.ts";
import { prepareProductRole, runCycles } from "../src/parity/product-role.ts";
import type { ToolHandler } from "../src/tools/registry.ts";
import { buildToolkit } from "../src/tools/toolkit.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The file the TUI's throttle engine reads too (shared/skills/throttle_engine.py).
const FILE = JSON.parse(readFileSync(join(REPO_ROOT, "agents", "_skills", "throttle", "pause-rules.json"), "utf-8"));
const FULL = 660_000;
const SHORT = FILE.short_pause_sec * 1000;

/** One unit: `inserts` rows inserted, then the pause that ends it. */
function pause(policy: PausePolicy, unit: WorkUnit, inserts = 0) {
  for (let i = 0; i < inserts; i++) unit.noteInsert();
  return policy.next(unit, FULL);
}

describe("the pause rules, one file for the TUI and the API team", () => {
  it("reads agents/_skills/throttle/pause-rules.json as the throttle engine does", () => {
    expect(loadPauseRules(REPO_ROOT)).toEqual({
      shortPauseSec: FILE.short_pause_sec,
      emptyUnit: { roles: FILE.empty_unit.roles, maxStreak: FILE.empty_unit.max_streak },
    });
    expect(FILE).toMatchObject({ short_pause_sec: 60, empty_unit: { roles: ["scout"], max_streak: 10 } });
  });

  it("without the file no rule applies: the full pause", () => {
    expect(loadPauseRules(join(REPO_ROOT, "no-such-dir"))).toEqual(NO_RULES);
    const policy = new PausePolicy("scout-2", NO_RULES);
    const unit = new WorkUnit();
    pause(policy, unit);
    expect(pause(policy, unit).ms).toBe(FULL);
  });

  it("a SCOUT unit that inserted nothing pauses short; one that inserted keeps the full pause", () => {
    const policy = new PausePolicy("scout-2", loadPauseRules(REPO_ROOT));
    const unit = new WorkUnit();
    // the first pause of a run has nothing to count from, as after a TUI boot
    expect(pause(policy, unit)).toEqual({ ms: FULL, emptyStreak: 0 });
    expect(pause(policy, unit)).toEqual({ ms: SHORT, shortenedFromMs: FULL, emptyStreak: 1 });
    expect(pause(policy, unit, 1)).toEqual({ ms: FULL, emptyStreak: 0 });
    expect(pause(policy, unit).ms).toBe(SHORT);
  });

  it("after max_streak short pauses in a row the full pause comes back, then the count starts again", () => {
    const policy = new PausePolicy("scout-2", loadPauseRules(REPO_ROOT));
    const unit = new WorkUnit();
    pause(policy, unit);
    const cap = FILE.empty_unit.max_streak as number;
    const applied = Array.from({ length: cap + 1 }, () => pause(policy, unit).ms);
    expect(applied).toEqual([...Array(cap).fill(SHORT), FULL]);
    expect(pause(policy, unit).ms).toBe(SHORT);
  });

  it("is the SCOUT's rule only, and never lengthens a pause", () => {
    const analista = new PausePolicy("analista-1", loadPauseRules(REPO_ROOT));
    const unit = new WorkUnit();
    pause(analista, unit);
    expect(pause(analista, unit).ms).toBe(FULL);
    const scout = new PausePolicy("scout-1", loadPauseRules(REPO_ROOT));
    scout.next(unit, 30_000);
    expect(scout.next(unit, 30_000).ms).toBe(30_000);
  });
});

describe("watchInserts", () => {
  const fake = (content: string, ok: boolean): ToolHandler => ({
    spec: { name: "db_insert", description: "", schema: undefined as never },
    classify: () => ({ kind: "internal", paths: [], summary: "" }) as never,
    execute: async () => ({ content, ok }),
  });

  it("counts a row that went in, not a duplicate or a refusal", async () => {
    const unit = new WorkUnit();
    const call = (tool: ToolHandler) => watchInserts(tool, unit).execute({}, {} as never);
    await call(fake("Position inserted with ID: 7 (company_id=NULL — company not found in DB)\n", true));
    await call(fake("⚠️  DUPLICATE (URL already exists, UNIQUE constraint): 'Acme — Dev' — https://x. INSERT aborted.\n", false));
    await call(fake("db_insert: position not available to this agent.\n", false));
    expect(unit.inserted).toBe(1);
  });
});

describe("a mock SCOUT run with the pause rules", () => {
  let root: string;
  let db: Database | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jht-pause-rules-"));
  });
  afterEach(async () => {
    db?.close();
    db = undefined;
    await rm(root, { recursive: true, force: true });
  });

  const insert = (n: number) => ({
    name: "db_insert",
    args: {
      args: ["position", "--title", `Backend Developer ${n}`, "--company", "Acme", "--url", `https://acme.example/jobs/${n}`,
        "--source", "linkedin", "--jd-text", "Build services in Go.", "--requirements", "Go, SQL"],
    },
  });
  // Boot pause; a unit that inserts; a unit that finds only a duplicate; one more empty unit.
  const SCRIPT: ScriptedTurn[] = [
    { toolCalls: [{ name: "throttle", args: { reason: "boot" } }] },
    { text: "Paused." },
    { toolCalls: [insert(1)] },
    { toolCalls: [{ name: "throttle", args: { reason: "post-insert" } }] },
    { text: "Paused." },
    { toolCalls: [insert(1)] },
    { toolCalls: [{ name: "throttle", args: { reason: "post-dedup-skip" } }] },
    { text: "Paused." },
    { toolCalls: [{ name: "throttle", args: { reason: "post-candidate-filter" } }] },
    { text: "Paused." },
    { text: "Back to searching." },
  ];

  it("sleeps the full pause after an insert and the short one after a duplicate", async () => {
    const env = { JHT_API_HOME: join(root, "api") };
    const config = loadConfig(env, "scout-1");
    const provider = new MockProvider(SCRIPT);
    const guardrails = new Guardrails({ limits: config.limits, pricing: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 } });
    await prepareAgentHome({ dir: config.agentHome, role: config.role, fresh: true });
    const role = await prepareProductRole({
      appRoot: REPO_ROOT,
      role: "scout",
      agent: "scout-1",
      homeDir: config.agentHome,
      apiHome: config.apiHome,
      jhtHome: join(root, "jht"),
      jobsDb: { path: ":memory:", open: () => (db ??= openJobsDb(":memory:")) },
      env: {},
    });
    const toolkit = await buildToolkit(config, { provider });
    const events: SessionEvent[] = [];
    const session = new RoleSession({
      provider,
      guardrails,
      audit: new NullAuditLog(),
      systemPrompt: role.systemPrompt,
      tools: role.tools(toolkit.tools),
      permissions: toolkit.permissions,
      onEvent: (e) => events.push(e),
    });
    const slept: number[] = [];
    const result = await runCycles(session, {
      agent: "scout-1",
      task: "[@capitano -> @scout-1] [INFO] Start your loop.",
      maxTurns: 5,
      mailbox: role.mailbox,
      pause: role.pause,
      pauseMs: FULL,
      sleep: async (ms) => void slept.push(ms),
    });
    await toolkit.close();

    expect(result.pauses).toBe(4);
    const inserts = events.filter((e) => e.type === "tool_finished" && e.name === "db_insert");
    expect(inserts).toHaveLength(2);
    expect((db!.prepare("SELECT count(*) AS n FROM positions").get() as { n: number }).n).toBe(1);
    // boot · after the insert · after the duplicate · after an empty unit
    expect(slept).toEqual([FULL, FULL, SHORT, SHORT]);
  });
});
