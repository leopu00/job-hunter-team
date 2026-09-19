/**
 * The CAPITANO's launcher, the deciding half (SICUREZZA §9, T22): every limit
 * in §9 is the launcher's, checked here one by one; the order it hands the
 * host's executor carries only fields the launcher set.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HubClient } from "../src/hub/client.ts";
import { Launcher, LauncherConfigSchema, type LauncherConfig } from "../src/hub/launcher.ts";
import { HUB_PATHS } from "../src/hub/protocol.ts";
import { createHub } from "../src/hub/server.ts";
import { prepareProductRole } from "../src/parity/product-role.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const REPO_ROOT = join(RUNTIME, "..", "..");
const CONFIG: LauncherConfig = {
  session: "s1",
  sessionUsd: 1.5,
  captainUsd: 0.3,
  roles: { scout: { capUsd: 0.4, instances: 2 }, analista: { capUsd: 0.4, instances: 1 }, scorer: { capUsd: 0.4, instances: 1 } },
  maxActive: 3,
  maxSpawns: 6,
  maxFailures: 3,
  maxMinutes: 30,
  models: ["gpt-5.6-luna", "gpt-5-mini"],
  taskChars: 2_000,
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-launcher-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function launcher(config: Partial<LauncherConfig> = {}) {
  return new Launcher({
    config: { ...CONFIG, ...config },
    stateDir: join(root, "state"),
    spoolDir: join(root, "spool"),
    stopFile: join(root, "STOP"),
    now: () => Date.parse("2026-09-19T20:00:00Z"),
  });
}

const ask = (l: Launcher, role: string, extra: Record<string, unknown> = {}) =>
  l.spawn("capitano-1", { role, cap_usd: 0.4, model: "gpt-5.6-luna", task: "Find three positions.", ...extra });

/** What the host's executor writes back when a child ends. */
function report(id: string, state: string, extra: Record<string, unknown> = {}) {
  mkdirSync(join(root, "spool", "results"), { recursive: true });
  writeFileSync(join(root, "spool", "results", `${id}.json`), JSON.stringify({ spawn_id: id, state, ...extra }));
}

describe("what the launcher starts", () => {
  it("hands the executor an order made of its own fields, the task as data", () => {
    const l = launcher();
    const answer = ask(l, "scout", { task: "Line one.\nLine two; $(rm -rf /) `x`" });
    expect(answer).toMatchObject({ ok: true, agent: "scout-1", booked_usd: 0.4, left_usd: 0.8 });
    if (!answer.ok) throw new Error("refused");
    const order = JSON.parse(readFileSync(join(root, "spool", "requests", `${answer.spawn_id}.json`), "utf8"));
    expect(order).toEqual({
      spawn_id: answer.spawn_id,
      session: "s1",
      role: "scout",
      agent: "scout-1",
      model: "gpt-5.6-luna",
      cap_usd: 0.4,
      max_minutes: 30,
      task: "Line one.\nLine two; $(rm -rf /) `x`",
    });
    expect(answer.spawn_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses what is not in the allowlist, a model not allowed, a cap above the role's, and says why", () => {
    const l = launcher();
    expect(ask(l, "capitano")).toMatchObject({ ok: false, reason: expect.stringContaining("not a role the launcher starts") });
    expect(ask(l, "scrittore")).toMatchObject({ ok: false, reason: expect.stringContaining("not a role the launcher starts") });
    expect(ask(l, "../scout")).toMatchObject({ ok: false });
    expect(ask(l, "toString")).toMatchObject({ ok: false });
    expect(ask(l, "scout", { model: "gpt-5" })).toMatchObject({ ok: false, reason: expect.stringContaining("not an allowed model") });
    // Refused, not lowered: the CAPITANO learns what happened.
    expect(ask(l, "scout", { cap_usd: 0.5 })).toMatchObject({ ok: false, reason: expect.stringContaining("it is not lowered for you") });
    expect(ask(l, "scout", { cap_usd: 0 })).toMatchObject({ ok: false });
    expect(ask(l, "scout", { cap_usd: -1 })).toMatchObject({ ok: false });
    expect(ask(l, "scout", { task: "x".repeat(2_001) })).toMatchObject({ ok: false, reason: expect.stringContaining("limit is 2000") });
    expect(ask(l, "scout", { instance: 3 })).toMatchObject({ ok: false, reason: expect.stringContaining("at most 2") });
    expect(readdirSync(join(root, "spool", "requests"))).toEqual([]);
  });

  it("never lets capitano into its allowlist", () => {
    expect(LauncherConfigSchema.safeParse({ ...CONFIG, roles: { ...CONFIG.roles, capitano: { capUsd: 0.3, instances: 1 } } }).success).toBe(false);
  });
});

describe("how many", () => {
  it("runs at most maxActive children, one agent per instance, the free instance first", () => {
    const l = launcher({ sessionUsd: 10 });
    expect(ask(l, "scout")).toMatchObject({ ok: true, agent: "scout-1" });
    expect(ask(l, "scout")).toMatchObject({ ok: true, agent: "scout-2" });
    expect(ask(l, "scout")).toMatchObject({ ok: false, reason: expect.stringContaining("all its 2 instance(s)") });
    expect(ask(l, "analista")).toMatchObject({ ok: true, agent: "analista-1" });
    expect(ask(l, "scorer")).toMatchObject({ ok: false, reason: expect.stringContaining("the most at once is 3") });
  });

  it("stops at maxSpawns in a session, and at maxFailures for a role", () => {
    const l = launcher({ sessionUsd: 10, maxSpawns: 4, maxFailures: 2 });
    for (let i = 0; i < 2; i++) {
      const a = ask(l, "scorer");
      if (!a.ok) throw new Error(a.reason);
      report(a.spawn_id, "failed", { exit_code: 1, spent_usd: 0.01 });
    }
    expect(ask(l, "scorer")).toMatchObject({ ok: false, reason: expect.stringContaining("failed 2 times") });
    const a = ask(l, "analista");
    if (!a.ok) throw new Error(a.reason);
    report(a.spawn_id, "done", { exit_code: 0, spent_usd: 0.1 });
    expect(ask(l, "analista")).toMatchObject({ ok: true });
    expect(ask(l, "scout")).toMatchObject({ ok: false, reason: expect.stringContaining("its 4 spawns") });
  });
});

describe("how much", () => {
  it("books a child's cap in the piggy bank, and gives back what it did not spend, as the key proxy measured it", () => {
    const l = launcher({ sessionUsd: 1.1 });
    // 1.1 − the CAPITANO's 0.3 = 0.8: two children at 0.4, then nothing.
    const first = ask(l, "scout");
    expect(first).toMatchObject({ ok: true, left_usd: 0.4 });
    expect(ask(l, "analista")).toMatchObject({ ok: true, left_usd: 0 });
    expect(ask(l, "scorer", { cap_usd: 0.1 })).toMatchObject({ ok: false, reason: expect.stringContaining("does not fit") });
    if (!first.ok) throw new Error("refused");
    // The scout ends having spent 0.12: 0.28 comes back.
    report(first.spawn_id, "done", { exit_code: 0, spent_usd: 0.12 });
    expect(l.list("capitano-1").left_usd).toBeCloseTo(0.28, 6);
    expect(ask(l, "scorer", { cap_usd: 0.28 })).toMatchObject({ ok: true, left_usd: 0 });
  });

  it("keeps a child that ended without a measured spend at its full cap", () => {
    const l = launcher({ sessionUsd: 0.7 });
    const a = ask(l, "scout");
    if (!a.ok) throw new Error(a.reason);
    report(a.spawn_id, "stopped");
    expect(l.list("capitano-1").left_usd).toBeCloseTo(0, 6);
  });

  it("starts over with a new session", () => {
    expect(ask(launcher({ sessionUsd: 0.7 }), "scout")).toMatchObject({ ok: true });
    expect(ask(launcher({ sessionUsd: 0.7 }), "scorer")).toMatchObject({ ok: false });
    expect(ask(launcher({ sessionUsd: 0.7, session: "s2" }), "scorer")).toMatchObject({ ok: true });
  });
});

describe("who stops what", () => {
  it("starts nothing while the operator's STOP exists", () => {
    const l = launcher();
    writeFileSync(join(root, "STOP"), "");
    expect(ask(l, "scout")).toMatchObject({ ok: false, reason: expect.stringContaining("STOP") });
  });

  it("lets a CAPITANO stop only its own children, and only while they run", () => {
    const l = launcher();
    const a = ask(l, "scout");
    if (!a.ok) throw new Error(a.reason);
    expect(l.stop("capitano-2", a.spawn_id)).toMatchObject({ ok: false });
    expect(l.stop("capitano-1", "0000000000000000")).toMatchObject({ ok: false });
    expect(l.stop("capitano-1", a.spawn_id)).toEqual({ ok: true });
    expect(existsSync(join(root, "spool", "stops", a.spawn_id))).toBe(true);
    report(a.spawn_id, "stopped", { spent_usd: 0.01 });
    expect(l.stop("capitano-1", a.spawn_id)).toMatchObject({ ok: false, reason: expect.stringContaining("already ended") });
    expect(l.list("capitano-2").spawns).toEqual([]);
  });

  it("logs every spawn, refusal and end on one line each, the task cut to 200 characters", () => {
    const l = launcher();
    const a = ask(l, "scout", { task: `Line one\n\n${"y".repeat(300)}` });
    ask(l, "capitano");
    if (!a.ok) throw new Error(a.reason);
    report(a.spawn_id, "done", { exit_code: 0, spent_usd: 0.2 });
    l.list("capitano-1");
    const log = readFileSync(join(root, "state", "launcher.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(log.map((e) => e.event)).toEqual(["spawned", "refused", "ended"]);
    expect(log[0].task).toHaveLength(200);
    expect(log[0].task).not.toContain("\n");
    expect(log[2]).toMatchObject({ spawn_id: a.spawn_id, state: "done", spent_usd: 0.2 });
  });
});

describe("through the hub", () => {
  const CAPITANO = "k".repeat(40);
  const SCOUT = "s".repeat(40);

  it("takes spawns from the CAPITANO's token only, and the CAPITANO's runtime has the tools", async () => {
    const server = createHub({
      tokens: new Map([
        [CAPITANO, "capitano-1"],
        [SCOUT, "scout-1"],
      ]),
      dbPath: join(root, "hub", "jobs.db"),
      channelsDir: join(root, "hub", "channels"),
      stateDir: join(root, "hub", "state"),
      appRoot: REPO_ROOT,
      launcher: launcher(),
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const post = (token: string, path: string, body: unknown) =>
        fetch(`${url}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const request = { role: "scorer", cap_usd: 0.2, model: "gpt-5-mini", task: "Score the queue." };
      // A child never starts anyone: the tree is one deep.
      expect((await post(SCOUT, HUB_PATHS.spawn, request)).status).toBe(403);
      expect((await post(SCOUT, HUB_PATHS.spawnList, {})).status).toBe(403);
      // No field beyond the closed request: no mounts, images, flags or variables.
      expect((await post(CAPITANO, HUB_PATHS.spawn, { ...request, image: "x" })).status).toBe(400);

      const hub = new HubClient({ url, token: CAPITANO });
      const common = { appRoot: REPO_ROOT, apiHome: join(root, "api"), jhtHome: join(root, "jht"), env: {} };
      const captain = await prepareProductRole({ ...common, role: "capitano", agent: "capitano-1", homeDir: join(root, "api", "agents", "c"), hub });
      const spawn = captain.tools([]).find((t) => t.spec.name === "spawn_agent")!;
      expect(spawn.classify(request)).toMatchObject({ risk: "execute" });
      const answer = await spawn.execute(request, { account: undefined as never, remainingMs: () => 60_000 });
      expect(answer).toMatchObject({ ok: true, content: expect.stringContaining('"agent": "scorer-1"') });
      const refused = await spawn.execute({ ...request, role: "capitano" }, { account: undefined as never, remainingMs: () => 60_000 });
      expect(refused).toMatchObject({ ok: false, content: expect.stringContaining("not a role the launcher starts") });

      // No other role has them, and a CAPITANO without a hub has no way to start anyone.
      const scout = await prepareProductRole({ ...common, role: "scout", agent: "scout-1", homeDir: join(root, "api", "agents", "s"), hub: new HubClient({ url, token: SCOUT }) });
      expect(scout.tools([]).map((t) => t.spec.name)).not.toContain("spawn_agent");
      const alone = await prepareProductRole({ ...common, role: "capitano", agent: "capitano-1", homeDir: join(root, "api", "agents", "d") });
      expect(alone.tools([]).map((t) => t.spec.name)).not.toContain("spawn_agent");
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
