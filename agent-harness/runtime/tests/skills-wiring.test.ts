/**
 * T7 wiring: the Scout gets its Python skills as native tools, on the team
 * database the runtime opened, and a `python3 …/shared/skills/*.py` typed into
 * the shell is answered with the tool to use instead of reaching a shell.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
import { jobsDbPath, openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { guardShellTool, PYTHON_SKILLS, replacedSkill } from "../src/parity/jht-tools.ts";
import { prepareProductRole } from "../src/parity/product-role.ts";
import { createSkillTools, scriptOverrides } from "../src/parity/skills/index.ts";
import type { ToolHandler } from "../src/tools/registry.ts";
import { buildToolkit } from "../src/tools/toolkit.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-skills-wiring-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("python3 …/shared/skills in the shell", () => {
  it("names the script wherever it stands at a command position", () => {
    expect(replacedSkill("python3 /app/shared/skills/scout_coord.py show")).toBe("scout_coord.py");
    expect(replacedSkill("cd /app && python3 -u shared/skills/email_monitor.py poll --since-days 1")).toBe("email_monitor.py");
    expect(replacedSkill("x=1; /usr/bin/python3.12 ./feedback_query.py check 42")).toBe("feedback_query.py");
    expect(replacedSkill("python /app/shared/skills/scout_coord.py claim a scout-1 | tee out")).toBe("scout_coord.py");
  });

  it("leaves everything else to the shell", () => {
    expect(replacedSkill("python3 -c 'print(1)'")).toBeNull();
    expect(replacedSkill("python3 /tmp/my_own.py")).toBeNull();
    expect(replacedSkill("echo python3 scout_coord.py")).toBeNull();
    expect(replacedSkill("cat shared/skills/scout_coord.py")).toBeNull();
  });

  it("answers with the tool to use, and runs nothing", async () => {
    let ran = false;
    const shell: ToolHandler = {
      spec: { name: "bash", description: "", schema: undefined as never },
      classify: () => ({ risk: "execute", paths: [], summary: "" }),
      execute: async () => {
        ran = true;
        return { ok: true, content: "ran" };
      },
    };
    const guarded = guardShellTool(shell, (args) => (args as { command: string }).command);
    for (const [script, tool] of Object.entries(PYTHON_SKILLS)) {
      const result = await guarded.execute({ command: `python3 /app/shared/skills/${script} status` }, undefined as never);
      expect(result).toEqual({ ok: false, content: expect.stringContaining(`Use the \`${tool}\` tool instead.`) });
    }
    expect(ran).toBe(false);
    expect((await guarded.execute({ command: "ls" }, undefined as never)).content).toBe("ran");
  });
});

describe("which roles get which skill tools", () => {
  const db = { open: () => openJobsDb(":memory:"), path: ":memory:" };
  const names = (skills: string[], withDb = true) =>
    createSkillTools({ skills, agent: "scout-1", ...(withDb ? { jobsDb: db } : {}) }).map((t) => t.spec.name);

  it("gives a tool only for a skill the role lists", () => {
    expect(names(["scout-coord", "feedback-query", "email-monitor", "db-query"])).toEqual(["scout_coord", "feedback_query", "email_monitor", "db_query"]);
    // T6: scout_dedup comes with db-insert, since the check always precedes an insert.
    expect(names(["db-insert", "db-update"])).toEqual(["db_insert", "db_update", "scout_dedup"]);
    expect(names(["feedback-query"])).toEqual(["feedback_query"]);
    expect(names(["tmux-send", "throttle"])).toEqual([]);
  });

  it("gives the ANALISTA its scripts, and db_insert for companies without the skill listed (T14)", () => {
    const skills = ["tmux-send", "db-query", "db-update", "throttle", "throttle-ack", "location-enrichment", "office-geocoding", "logo-extraction", "recheck-liveness", "chat-worker", "salary-estimate"];
    const tools = createSkillTools({ skills, agent: "analista-2", jobsDb: db, profileDir: "/profile" }).map((t) => t.spec.name);
    expect(tools).toEqual([
      "db_query", "db_insert", "db_update", "recheck_liveness", "safe_fetch", "deadline_extract", "ticket", "role_registry", "salary_estimate", "logo_fetch", "enrichment_policy",
    ]);
    // A SCOUT with the same skills gets no ANALISTA script and no insert it does not list.
    expect(createSkillTools({ skills: ["db-query"], agent: "scout-1", jobsDb: db }).map((t) => t.spec.name)).toEqual(["db_query"]);
    expect(scriptOverrides(skills)).toEqual({ "safe_fetch.py": "safe_fetch" });
    expect(scriptOverrides(["db-query"])).toEqual({});
  });

  it("gives the CAPITANO its scripts, its diary in the runtime's state and not in the profile (T21)", async () => {
    const list = await readFile(join(REPO_ROOT, "agents", "capitano", "skills.list"), "utf8");
    const skills = list.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const stateDir = join(root, "api");
    const profileDir = join(root, "profile");
    const tools = createSkillTools({ skills, agent: "capitano", jobsDb: db, profileDir, stateDir });
    expect(tools.map((t) => t.spec.name)).toEqual([
      "email_monitor", "db_query", "db_update", "ticket", "role_registry", "enrichment_policy", "format_time", "captain_diary", "team_directives",
    ]);
    const diary = tools.find((t) => t.spec.name === "captain_diary")!;
    const r = await diary.execute(diary.spec.schema.parse({ args: ["add", "a lesson"] }), { signal: new AbortController().signal } as never);
    expect(r.ok).toBe(true);
    expect(await readdir(join(stateDir, "team", "logs"))).toEqual([expect.stringMatching(/^captain-diary-\d{4}-\d{2}-\d{2}\.md$/)]);
    await expect(readdir(profileDir)).rejects.toThrow();
  });

  it("offers no database tool when the runtime opened no database", () => {
    expect(names(["scout-coord", "feedback-query", "email-monitor"], false)).toEqual(["email_monitor"]);
  });
});

describe("a mock SCOUT on its native skills", () => {
  it("coordinates, claims and reads feedback in the runtime's jobs.db, and is turned away from python3", async () => {
    const env = { JHT_API_HOME: join(root, "api") };
    const config = loadConfig(env, "scout-1");
    const dbFile = jobsDbPath(env, config.apiHome);
    let opened: Database | undefined;
    const jobsDb = { path: dbFile, open: () => (opened ??= openJobsDb(dbFile)) };

    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: "scout_coord", args: { command: "assign", scout: "scout-1", cerchi: "1,2", fonti: "linkedin" } },
          { name: "scout_coord", args: { command: "claim", job_id: "https://jobs.example/7", scout: "scout-1" } },
          { name: "feedback_query", args: { command: "check", legacy_id: "7" } },
          { name: "email_monitor", args: { command: "status" } },
          // What the TUI prompt says, typed by a model that has not read the tool list.
          { name: "bash", args: { command: "python3 /app/shared/skills/scout_coord.py show" } },
        ],
      },
      { toolCalls: [{ name: "scout_coord", args: { command: "show" } }] },
      { text: "Split recorded, one position claimed." },
    ];
    const provider = new MockProvider(script);
    await prepareAgentHome({ dir: config.agentHome, role: config.role, fresh: true });
    const role = await prepareProductRole({
      appRoot: REPO_ROOT,
      role: "scout",
      agent: "scout-1",
      homeDir: config.agentHome,
      apiHome: config.apiHome,
      jhtHome: join(root, "jht"),
      env: {},
      jobsDb,
    });
    const toolkit = await buildToolkit(config, { provider });
    const events: SessionEvent[] = [];
    const session = new RoleSession({
      provider,
      guardrails: new Guardrails({ limits: config.limits, pricing: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 } }),
      audit: new NullAuditLog(),
      systemPrompt: role.systemPrompt,
      tools: role.tools(toolkit.tools),
      permissions: toolkit.permissions,
      onEvent: (e) => events.push(e),
    });

    expect(session.toolNames).toEqual(expect.arrayContaining(["scout_coord", "feedback_query", "email_monitor"]));
    await session.send("[@capitano -> @scout-1] [INFO] Start.");

    const finished = events.flatMap((e) => (e.type === "tool_finished" ? [e] : []));
    expect(finished.filter((e) => e.name !== "bash").map((e) => [e.name, e.outcome])).toEqual([
      ["scout_coord", "accepted"],
      ["scout_coord", "accepted"],
      ["feedback_query", "accepted"],
      ["email_monitor", "accepted"],
      ["scout_coord", "accepted"],
    ]);
    const bash = finished.find((e) => e.name === "bash");
    expect(bash?.outcome).toBe("failed");
    expect(bash?.result).toContain("Use the `scout_coord` tool instead. Nothing was run.");
    expect(finished.at(-1)?.result).toContain("scout-1\n    Search areas: 1,2\n    Sources:      linkedin");

    const db = opened!;
    expect(db.prepare("SELECT scout, cerchi, fonti FROM scout_coordination").all()).toEqual([
      { scout: "scout-1", cerchi: "1,2", fonti: "linkedin" },
    ]);
    expect(db.prepare("SELECT job_id, scout FROM scout_claims").all()).toEqual([{ job_id: "https://jobs.example/7", scout: "scout-1" }]);
    db.close();
    await toolkit.close();
  });
});
