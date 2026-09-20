/**
 * The CAPITANO's launcher, the deciding half (SICUREZZA §9, T22): every limit
 * in §9 is the launcher's, checked here one by one; the order it hands the
 * host's executor carries only fields the launcher set.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  spawnReserveUsd: 0,
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

/** The list, or the test fails: the state must be readable here. */
function listed(l: Launcher, by: string) {
  const answer = l.list(by);
  if (!("spawns" in answer)) throw new Error(answer.reason);
  return answer;
}

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
      kind: "spawn",
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
    expect(listed(l, "capitano-1").left_usd).toBeCloseTo(0.28, 6);
    expect(ask(l, "scorer", { cap_usd: 0.28 })).toMatchObject({ ok: true, left_usd: 0 });
  });

  it("keeps a child that ended without a measured spend at its full cap", () => {
    const l = launcher({ sessionUsd: 0.7 });
    const a = ask(l, "scout");
    if (!a.ok) throw new Error(a.reason);
    report(a.spawn_id, "stopped");
    expect(listed(l, "capitano-1").left_usd).toBeCloseTo(0, 6);
  });

  it("starts nothing when its state exists and cannot be read, and says so (L-1)", () => {
    const stateFile = join(root, "state", "state.json");
    for (const [label, spoil] of [
      ["torn", () => writeFileSync(stateFile, '{"session": "s1", "spawns": [')],
      ["not a state", () => writeFileSync(stateFile, JSON.stringify({ session: "s1", spawns: "none" }))],
      ["unreadable", () => chmodSync(stateFile, 0o000)],
    ] as const) {
      const l = launcher({ sessionUsd: 0.7 });
      const first = ask(l, "scout");
      if (!first.ok) throw new Error(first.reason);
      // The piggy bank is full: a fresh start would let this one through.
      spoil();
      const before = label === "unreadable" ? null : readFileSync(stateFile, "utf8");
      expect(ask(l, "scorer"), label).toMatchObject({ ok: false, reason: expect.stringContaining("nothing starts or stops") });
      expect(l.stop("capitano-1", first.spawn_id), label).toMatchObject({ ok: false });
      expect(l.list("capitano-1"), label).toMatchObject({ ok: false });
      // Left as found, for the operator to look at.
      if (before !== null) expect(readFileSync(stateFile, "utf8")).toBe(before);
      else chmodSync(stateFile, 0o600);
      const log = readFileSync(join(root, "state", "launcher.log"), "utf8");
      expect(log, label).toContain('"event":"state_unreadable"');
      rmSync(join(root, "state"), { recursive: true, force: true });
      rmSync(join(root, "spool"), { recursive: true, force: true });
    }
  });

  it("ignores a state of another session, whatever an older launcher wrote in it", () => {
    const stateFile = join(root, "state", "state.json");
    mkdirSync(join(root, "state"), { recursive: true });
    // A leftover from a trial session, in the shape the launcher had before `kind`.
    writeFileSync(stateFile, JSON.stringify({ session: "prova-t22", spawns: [{ id: "a", agent: "scout-1", role: "scout", state: "queued" }] }));
    expect(ask(launcher({ session: "s2" }), "scout")).toMatchObject({ ok: true, agent: "scout-1" });
    // The same file under this session's name is another matter: it is this session's state, and it is unreadable.
    writeFileSync(stateFile, JSON.stringify({ session: "s3", spawns: [{ id: "a", agent: "scout-1", role: "scout", state: "queued" }] }));
    expect(ask(launcher({ session: "s3" }), "scout")).toMatchObject({ ok: false, reason: expect.stringContaining("nothing starts or stops") });
  });

  it("takes in what the executor reported with nobody asking, so a booking comes back inside the session", () => {
    const l = launcher({ sessionUsd: 1.1 });
    const child = ask(l, "scout");
    if (!child.ok) throw new Error(child.reason);
    // The live run of 20/09: the child ends after the CAPITANO's last call.
    report(child.spawn_id, "done", { exit_code: 0, spent_usd: 0.05 });
    // Without the sweep the state would still read the file only on the next call.
    l.sweep();
    const state = JSON.parse(readFileSync(join(root, "state", "state.json"), "utf8")) as { spawns: Array<{ state: string; spentUsd?: number }> };
    expect(state.spawns).toMatchObject([{ state: "done", spentUsd: 0.05 }]);
    expect(listed(l, "host").left_usd).toBeCloseTo(1.1 - 0.3 - 0.05, 6);
    // A state it cannot read is the next real call's to report, not the sweep's to throw on.
    writeFileSync(join(root, "state", "state.json"), "{ torn");
    expect(() => l.sweep()).not.toThrow();
    expect(ask(l, "scorer")).toMatchObject({ ok: false, reason: expect.stringContaining("nothing starts or stops") });
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
    expect(listed(l, "capitano-2").spawns).toEqual([]);
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

describe("the base set (T24 run-team)", () => {
  // As the product's launcher starts it: the same composition, in this order.
  const TEAM = [
    { role: "scout", instances: 2 },
    { role: "analista", instances: 1 },
    { role: "scorer", instances: 1 },
    { role: "capitano", instances: 1, delay_s: 5 },
  ];
  const withTeam = (extra: Partial<LauncherConfig> = {}) => launcher({ sessionUsd: 10, team: TEAM, ...extra });
  /** The orders as the executor reads them: by `seq`, since two written in the same millisecond have no order. */
  const orders = () =>
    readdirSync(join(root, "spool", "requests"))
      .map((f) => JSON.parse(readFileSync(join(root, "spool", "requests", f), "utf8")) as Record<string, number | string>)
      .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));

  it("writes one order per member, in the configured order, each marked as team", () => {
    const l = withTeam();
    const answer = l.startTeam("host");
    expect(answer.ok).toBe(true);
    expect(answer.started.map((a) => (a.ok ? a.agent : a.reason))).toEqual(["scout-1", "scout-2", "analista-1", "scorer-1", "capitano-1"]);
    const written = orders();
    expect(written.map((o) => o.agent)).toEqual(["scout-1", "scout-2", "analista-1", "scorer-1", "capitano-1"]);
    expect(written.map((o) => o.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(written.every((o) => o.kind === "team" && o.session === "s1" && o.max_minutes === 30)).toBe(true);
    // The CAPITANO is a member like the others, at its own cap, with the stagger the config asks for.
    expect(written.at(-1)).toMatchObject({ role: "capitano", cap_usd: 0.3, delay_s: 5, task: "Start your cycle." });
    expect(written.filter((o) => o.delay_s !== undefined)).toHaveLength(1);
    // One piggy bank: four members at 0.4 and the CAPITANO's 0.3, counted once.
    expect(listed(l, "host").left_usd).toBeCloseTo(10 - 1.9, 6);
    expect(answer.left_usd).toBeCloseTo(10 - 1.9, 6);
  });

  it("does not spend the CAPITANO's spawns: the team is peers, and an extra child still starts", () => {
    // One child at a time, one spawn in the session: the team must not use them up.
    const l = withTeam({ maxActive: 1, maxSpawns: 1, roles: { ...CONFIG.roles, scrittore: { capUsd: 0.4, instances: 1 } } });
    expect(l.startTeam("host").ok).toBe(true);
    // No child may double a member that is already running.
    expect(l.spawn("capitano-1", { role: "scout", cap_usd: 0.4, model: "gpt-5.6-luna", task: "More." })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("all its 2 instance(s)"),
    });
    const extra = l.spawn("capitano-1", { role: "scrittore", cap_usd: 0.4, model: "gpt-5.6-luna", task: "Write the CV." });
    expect(extra).toMatchObject({ ok: true, agent: "scrittore-1" });
    // The second child is the CAPITANO's own limit talking, not the team's: one child at
    // a time, and one spawn in the session, both counted over children alone.
    expect(l.spawn("capitano-1", { role: "scorer", cap_usd: 0.4, model: "gpt-5.6-luna", task: "Again." })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("1 children are running, the most at once is 1"),
    });
    report((extra as { spawn_id: string }).spawn_id, "failed", { exit_code: 1 });
    expect(l.spawn("capitano-1", { role: "scorer", cap_usd: 0.4, model: "gpt-5.6-luna", task: "Again." })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("This session has used its 1 spawns"),
    });
  });

  it("keeps the CAPITANO's reserve out of the team's booking, and says when there is no room left", () => {
    // The set costs 0.3 (captain) + 1.6: with 0.4 kept for a spawn, 2.2 is short by one member.
    const tight = withTeam({ sessionUsd: 2.2, spawnReserveUsd: 0.4 });
    const short = tight.startTeam("host");
    expect(short.started.filter((a) => !a.ok).map((a) => (a.ok ? "" : a.reason))).toEqual([
      expect.stringContaining("kept for the CAPITANO's spawns"),
    ]);

    // With room for the whole set and the reserve, the CAPITANO's extra child starts for real.
    const l = withTeam({ sessionUsd: 2.3, spawnReserveUsd: 0.4, roles: { ...CONFIG.roles, scout: { capUsd: 0.4, instances: 3 } } });
    const full = l.startTeam("host");
    expect(full.started.every((a) => a.ok)).toBe(true);
    expect(full.note).toBeUndefined();
    expect(l.spawn("capitano-1", { role: "scout", cap_usd: 0.4, model: "gpt-5.6-luna", task: "One more." })).toMatchObject({ ok: true, agent: "scout-3" });

    // When the set fills every instance, the answer says so instead of leaving it to be found later.
    expect(withTeam({ sessionUsd: 10, session: "s9" }).startTeam("host").note).toContain("No room left for an extra spawn");
  });

  it("counts the CAPITANO's own spend when it passes the reserve", () => {
    // Its reserve is 0.3 and the four other members hold 1.6.
    const ended = (spentUsd: number, session: string) => {
      const l = withTeam({ sessionUsd: 10, session });
      const captain = l.startTeam("host").started.at(-1);
      if (!captain?.ok) throw new Error("no captain");
      report(captain.spawn_id, "done", { exit_code: 0, spent_usd: spentUsd });
      return listed(l, "host").left_usd;
    };
    // Under the reserve, the reserve stands; over it, the money really spent is what counts.
    expect(ended(0.1, "under")).toBeCloseTo(10 - 1.6 - 0.3, 6);
    expect(ended(0.5, "over")).toBeCloseTo(10 - 1.6 - 0.5, 6);
  });

  it("starts the team once per session, and again only when it is down", () => {
    const l = withTeam();
    const first = l.startTeam("host");
    expect(l.startTeam("host")).toMatchObject({ ok: false, reason: expect.stringContaining("already up") });
    for (const a of first.started) if (a.ok) report(a.spawn_id, "done", { exit_code: 0, spent_usd: 0.05 });
    expect(l.startTeam("host").ok).toBe(true);
  });

  it("is not the CAPITANO's to stop, and needs a team in the configuration", () => {
    const l = withTeam();
    const started = l.startTeam("host");
    const member = started.started[0];
    if (!member?.ok) throw new Error("no member");
    expect(l.stop("capitano-1", member.spawn_id)).toMatchObject({ ok: false, reason: expect.stringContaining("ask the operator") });
    // Not even the caller that started it: a member of the base set is stopped by the host, not through here.
    expect(l.stop("host", member.spawn_id)).toMatchObject({ ok: false, reason: expect.stringContaining("ask the operator") });
    expect(launcher().startTeam("host")).toMatchObject({ ok: false, reason: expect.stringContaining("no team in its configuration") });
  });

  it("starts nothing while the operator's STOP is there", () => {
    const l = withTeam();
    writeFileSync(join(root, "STOP"), "");
    expect(l.startTeam("host")).toMatchObject({ ok: false, reason: expect.stringContaining("STOP") });
    expect(existsSync(join(root, "spool", "requests")) ? readdirSync(join(root, "spool", "requests")) : []).toEqual([]);
  });
});

describe("through the hub", () => {
  const CAPITANO = "k".repeat(40);
  const SCOUT = "s".repeat(40);
  const TEAM_TOKEN = "t".repeat(40);

  it("starts the base set with the host's token only, and answers with the members", async () => {
    const server = createHub({
      tokens: new Map([[CAPITANO, "capitano-1"]]),
      dbPath: join(root, "hub", "jobs.db"),
      channelsDir: join(root, "hub", "channels"),
      stateDir: join(root, "hub", "state"),
      appRoot: REPO_ROOT,
      launcher: launcher({ sessionUsd: 10, team: [{ role: "scout", instances: 2 }, { role: "capitano", instances: 1 }] }),
      teamToken: TEAM_TOKEN,
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (token: string, path: string, body: unknown) =>
      fetch(`${url}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      // The CAPITANO's token starts children, never the team.
      expect((await post(CAPITANO, HUB_PATHS.teamStart, {})).status).toBe(403);
      expect((await post("z".repeat(40), HUB_PATHS.teamStart, {})).status).toBe(403);
      const started = await post(TEAM_TOKEN, HUB_PATHS.teamStart, {});
      expect(started.status).toBe(200);
      const answer = (await started.json()) as { ok: boolean; started: Array<{ ok: boolean; agent?: string }> };
      expect(answer.ok).toBe(true);
      expect(answer.started.map((a) => a.agent)).toEqual(["scout-1", "scout-2", "capitano-1"]);
      // And the host's token does nothing else: it is not an agent.
      expect((await post(TEAM_TOKEN, HUB_PATHS.spawnList, {})).status).toBe(401);
      expect((await post(TEAM_TOKEN, HUB_PATHS.drain, {})).status).toBe(401);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

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

      // T24: with no launcher token configured, even the host's token is refused.
      expect((await post(CAPITANO, HUB_PATHS.teamStart, {})).status).toBe(403);
      expect((await post(SCOUT, HUB_PATHS.teamStart, {})).status).toBe(403);
      expect((await post(TEAM_TOKEN, HUB_PATHS.teamStart, {})).status).toBe(403);

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
