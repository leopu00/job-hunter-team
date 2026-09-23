/**
 * The dashboard's START page (B-02, round 4): the one place of the dashboard
 * that can spend money. Each of the MASTER's six conditions has its test
 * here: what the page shows is what the launcher will start, the most it can
 * cost is the configuration's own figure, the only call is `/v1/team/start`
 * once, its refusals come back as they are, and who asked is written down
 * before the call.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Board } from "../src/cli/dashboard.ts";
import { hubAccess, onStartKey, readStarts, readTeamPlan, startAndRecord, startPageLines, startsFile, startTeam, type HubAccess, type StartStep, type TeamPlan } from "../src/cli/start-page.ts";
import { Launcher, type LauncherConfig } from "../src/hub/launcher.ts";
import { createHub } from "../src/hub/server.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const REPO_ROOT = join(RUNTIME, "..", "..");
const TEAM_TOKEN = "t".repeat(40);
const CONFIG: LauncherConfig = {
  session: "2026-09-24-a",
  sessionUsd: 0.6,
  captainUsd: 0.3,
  roles: { scout: { capUsd: 0.4, instances: 2 }, analista: { capUsd: 0.2, instances: 1 } },
  maxActive: 3,
  maxSpawns: 6,
  maxFailures: 3,
  maxMinutes: 30,
  models: ["gpt-5.6-luna", "gpt-5-mini"],
  taskChars: 2_000,
  spawnReserveUsd: 0,
  team: [
    { role: "scout", instances: 1, cap_usd: 0.1 },
    { role: "analista", instances: 1, model: "gpt-5-mini" },
    { role: "capitano", instances: 1, delay_s: 5 },
  ],
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-start-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const configFile = (config: unknown = CONFIG, name = "launcher.json") => {
  const file = join(root, name);
  writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
  return file;
};
const plain = (lines: string[]) => lines.join("\n");
const okPlan = (plan: TeamPlan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};

describe("the page shows what the launcher will start, read from its configuration", () => {
  it("resolves each member's cap and model exactly as the launcher orders them", () => {
    const plan = okPlan(readTeamPlan(configFile()));
    // The launcher itself, on the same configuration: the orders it writes are the truth.
    const launcher = new Launcher({ config: CONFIG, stateDir: join(root, "state"), spoolDir: join(root, "spool") });
    expect(launcher.startTeam("host").ok).toBe(true);
    const orders = readdirSync(join(root, "spool", "requests"))
      .map((f) => JSON.parse(readFileSync(join(root, "spool", "requests", f), "utf8")) as { role: string; cap_usd: number; model: string; seq: number })
      .sort((a, b) => a.seq - b.seq);
    expect(plan.members.flatMap((m) => Array.from({ length: m.instances }, () => ({ role: m.role, cap_usd: m.capUsd, model: m.model })))).toEqual(
      orders.map((o) => ({ role: o.role, cap_usd: o.cap_usd, model: o.model })),
    );
  });

  it("says the most it can cost is the configuration's sessionUsd, before a start and when asking to confirm", () => {
    const plan = readTeamPlan(configFile({ ...CONFIG, sessionUsd: 0.75 }));
    const hub: HubAccess = { url: "http://127.0.0.1:1", token: () => TEAM_TOKEN };
    expect(plain(startPageLines(plan, hub, { step: "idle" }, [], true))).toContain("AT MOST $0.7500");
    const confirm = plain(startPageLines(plan, hub, { step: "confirm" }, [], true));
    expect(confirm).toContain("It may spend up to $0.7500");
    expect(confirm).toContain("y to start · any other key cancels");
    // The members as the configuration states them.
    expect(confirm).toMatch(/scout +×1 +cap \$0\.1000 each +gpt-5\.6-luna/);
    expect(confirm).toMatch(/analista +×1 +cap \$0\.2000 each +gpt-5-mini/);
    expect(confirm).toMatch(/capitano +×1 +cap \$0\.3000 each +gpt-5\.6-luna +after 5s/);
  });

  it("starts nothing, and says why, when the configuration is missing, unreadable, invalid or has no team", () => {
    const hub: HubAccess = { url: "http://127.0.0.1:1", token: () => TEAM_TOKEN };
    const cases: Array<[string | undefined, RegExp]> = [
      [undefined, /JHT_LAUNCHER_CONFIG is not set/],
      [join(root, "nope.json"), /cannot be read \(ENOENT\)/],
      [configFile("{not json", "broken.json"), /is not JSON/],
      [configFile({ ...CONFIG, sessionUsd: -1 }, "invalid.json"), /does not pass the launcher's own schema/],
      [configFile({ ...CONFIG, team: [] }, "empty.json"), /has no team to start/],
    ];
    for (const [path, reason] of cases) {
      const plan = readTeamPlan(path);
      expect(plan.ok).toBe(false);
      const page = plain(startPageLines(plan, hub, { step: "idle" }, [], true));
      expect(page).toMatch(reason);
      expect(page).toContain("nothing can start from here");
      expect(page).not.toContain("press s");
      // No figure for the cost when the configuration did not give one.
      expect(page).not.toContain("AT MOST");
    }
  });
});

describe("the one call, and its answer as it came", () => {
  const recording = (status: number, body: unknown) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("posts once to /v1/team/start with an empty body and the host's token, read when asked", async () => {
    let reads = 0;
    const hub: HubAccess = { url: "http://127.0.0.1:8788", token: () => (reads++, TEAM_TOKEN) };
    const { calls, fetchImpl } = recording(200, { ok: true, started: [] });
    expect(reads).toBe(0);
    await startTeam(hub, fetchImpl);
    expect(reads).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8788/v1/team/start");
    expect(calls[0]!.init.body).toBe("{}");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TEAM_TOKEN}`);
  });

  it("brings a refusal back as it is, once, without trying again", async () => {
    const hub: HubAccess = { url: "http://127.0.0.1:8788", token: () => TEAM_TOKEN };
    const refusal = { ok: false, reason: "The team of this session is already up: scout-1. Stop it before starting it again.", started: [] };
    const { calls, fetchImpl } = recording(200, refusal);
    const outcome = await startTeam(hub, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(outcome).toEqual({ answered: true, status: 200, body: refusal });
    const page = plain(startPageLines(readTeamPlan(configFile()), hub, { step: "answered", outcome }, [], true));
    expect(page).toContain("the hub did not start it (200): The team of this session is already up: scout-1. Stop it before starting it again.");
    const denied = recording(403, { error: "The team is started with the host's own token." });
    const forbidden = await startTeam(hub, denied.fetchImpl);
    expect(denied.calls).toHaveLength(1);
    expect(plain(startPageLines(readTeamPlan(configFile()), hub, { step: "answered", outcome: forbidden }, [], true))).toContain(
      "the hub did not start it (403): The team is started with the host's own token.",
    );
  });

  it("reaches the hub on the loopback only, and only with the host's token", () => {
    expect(hubAccess({})).toHaveProperty("reason");
    expect(hubAccess({ JHT_HUB_URL: "http://10.0.0.5:8788", JHT_HUB_TEAM_TOKEN: TEAM_TOKEN })).toMatchObject({ reason: expect.stringContaining("loopback only") });
    expect(hubAccess({ JHT_HUB_URL: "http://127.0.0.1:8788" })).toMatchObject({ reason: expect.stringContaining("only the host starts the team") });
    const file = join(root, "team.token");
    writeFileSync(file, `${TEAM_TOKEN}\n`);
    const access = hubAccess({ JHT_HUB_URL: "http://127.0.0.1:8788/", JHT_HUB_TEAM_TOKEN_FILE: file });
    expect("reason" in access).toBe(false);
    expect((access as HubAccess).token()).toBe(TEAM_TOKEN);
  });
});

describe("who started, and what they were shown, is written down", () => {
  it("writes the request before the call and the answer after it, beside the traces and out of the agents' way", async () => {
    const logs = join(root, "logs");
    const file = startsFile(logs);
    const plan = okPlan(readTeamPlan(configFile()));
    let seenBeforeCall: string[] = [];
    const fetchImpl = (async () => {
      seenBeforeCall = readStarts(file).map((r) => r.type);
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const outcome = await startAndRecord(plan, { url: "http://127.0.0.1:1", token: () => TEAM_TOKEN }, file, "operator", fetchImpl);
    expect(seenBeforeCall).toEqual(["team_start_requested"]);
    expect(outcome).toMatchObject({ answered: false, error: expect.stringContaining("connection refused") });
    const records = readStarts(file);
    expect(records.map((r) => r.type)).toEqual(["team_start_requested", "team_start_answered"]);
    expect(records[0]).toMatchObject({ by: "operator", session: "2026-09-24-a", sessionUsd: 0.6, config: plan.path });
    // The file sits in the logs folder but is no agent's trace: the monitor skips files there.
    expect(readdirSync(logs, { withFileTypes: true }).every((e) => !e.isDirectory())).toBe(true);
    // And the page lists it.
    expect(plain(startPageLines(plan, { url: "http://127.0.0.1:1", token: () => TEAM_TOKEN }, { step: "idle" }, records, true))).toContain("operator  session 2026-09-24-a  up to $0.6000");
  });
});

describe("never one key that starts", () => {
  const KEYS = ["s", "y", "\r", "\n", " ", "a", "q", "1", "4", "\x1b[C", "\x1b[D", "\t", "Y", "S"];

  it("starts from no single key, in any state but the confirmation", () => {
    const states: StartStep[] = [{ step: "idle" }, { step: "asking" }, { step: "answered", outcome: { answered: false, error: "x" } }];
    for (const step of states) for (const key of KEYS) expect(onStartKey(step, key, true).start).toBe(false);
  });

  it("starts on s then y, and on nothing else", () => {
    const armed = onStartKey({ step: "idle" }, "s", true);
    expect(armed).toMatchObject({ step: { step: "confirm" }, start: false });
    expect(onStartKey(armed.step, "y", true)).toMatchObject({ step: { step: "asking" }, start: true });
    for (const key of KEYS.filter((k) => k !== "y")) expect(onStartKey(armed.step, key, true)).toMatchObject({ step: { step: "idle" }, start: false });
  });

  it("does not even ask when the configuration or the hub cannot be read", () => {
    expect(onStartKey({ step: "idle" }, "s", false)).toMatchObject({ step: { step: "idle" }, start: false });
    expect(onStartKey({ step: "confirm" }, "y", false)).toMatchObject({ step: { step: "idle" }, start: false });
  });

  it("lets a dropped confirmation's arrow still move to another page", () => {
    expect(onStartKey({ step: "confirm" }, "\x1b[D", true)).toMatchObject({ step: { step: "idle" }, consumed: false });
    expect(onStartKey({ step: "confirm" }, "a", true)).toMatchObject({ step: { step: "idle" }, consumed: true });
  });
});

describe("the page is interactive only, and the rest of the dashboard never calls", () => {
  it("offers no start where no one can confirm it", () => {
    const hub: HubAccess = { url: "http://127.0.0.1:1", token: () => TEAM_TOKEN };
    const page = plain(startPageLines(readTeamPlan(configFile()), hub, { step: "idle" }, [], false));
    expect(page).toContain("from an interactive terminal only");
    expect(page).not.toContain("press s");
  });

  it("draws the START page's lines inside the dashboard's frame, and only there", () => {
    const board = new Board();
    const lines = ["UNIQUE START LINE"];
    expect(board.frame(0, { cols: 120, rows: 30 }, "", "start", lines).join("\n")).toContain("UNIQUE START LINE");
    expect(board.frame(0, { cols: 120, rows: 30 }, "", "agents", lines).join("\n")).not.toContain("UNIQUE START LINE");
    expect(board.frame(0, { cols: 120, rows: 30 }, "", "start", lines)[1]).toContain("4 ▶ START");
  });

  it("names one hub route in the whole dashboard: the team's start", () => {
    const source = (file: string) => readFileSync(join(RUNTIME, "src", "cli", file), "utf8");
    const routes = [...source("start-page.ts").matchAll(/HUB_PATHS\.(\w+)/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes)).toEqual(new Set(["teamStart"]));
    for (const file of ["dashboard.ts", "monitor.ts", "tail.ts"]) {
      expect(source(file)).not.toMatch(/HUB_PATHS|HubClient|fetch\(/);
    }
  });
});

describe("against a real hub", () => {
  it("starts the configured team through the launcher, and a second start is refused as the launcher says", async () => {
    const server = createHub({
      tokens: new Map([["k".repeat(40), "capitano-1"]]),
      dbPath: join(root, "hub", "jobs.db"),
      channelsDir: join(root, "hub", "channels"),
      stateDir: join(root, "hub", "state"),
      appRoot: REPO_ROOT,
      launcher: new Launcher({ config: CONFIG, stateDir: join(root, "state"), spoolDir: join(root, "spool") }),
      teamToken: TEAM_TOKEN,
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const hub: HubAccess = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: () => TEAM_TOKEN };
    const plan = okPlan(readTeamPlan(configFile()));
    const file = startsFile(join(root, "logs"));
    try {
      const first = await startAndRecord(plan, hub, file, "operator");
      expect(first).toMatchObject({ answered: true, status: 200, body: { ok: true } });
      const page = plain(startPageLines(plan, hub, { step: "answered", outcome: first }, readStarts(file), true));
      expect(page).toContain("the hub started the team (200)");
      for (const agent of ["scout-1", "analista-1", "capitano-1"]) expect(page).toContain(`✓ ${agent}`);
      const second = await startAndRecord(plan, hub, file, "operator");
      expect(plain(startPageLines(plan, hub, { step: "answered", outcome: second }, [], true))).toContain("The team of this session is already up");
      expect(readStarts(file).filter((r) => r.type === "team_start_requested")).toHaveLength(2);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
