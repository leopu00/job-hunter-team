/**
 * The box acts on the desired state of `team_state` under the rules it applies
 * to `team_commands` (team-command-guard.test.ts): the paired user's row only,
 * closed fields, a start or a restart only when the desire is fresh by the
 * database's clock against the server's, and each start, restart and
 * emergency stop once.
 *
 * The desired fields are written by the user's session, and until the
 * database closes them by anyone holding it. A stop is the safe direction: it
 * runs however old the request, with the owner and once per emergency request.
 *
 * reconcile and reconcileEmergencyStop run for real, with a fake network and a
 * fake `jht`: the assertions are on what was run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_AGE_MS, createDoneStore } from "../../../cli/src/lib/team-command-guard.js";
import { reconcile, reconcileEmergencyStop } from "../../../cli/src/lib/team-state-reconciler.js";
import { readRendezvousState } from "../../../cli/src/commands/cloud.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SERVER_NOW = Date.parse("2026-10-22T12:00:00Z");
const at = (offsetMs: number) => new Date(SERVER_NOW + offsetMs).toISOString();
const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function state(over: Record<string, unknown> = {}) {
  return {
    user_id: OWNER,
    should_run: true,
    is_running: false,
    restart_token: null,
    last_restart_token: null,
    desired_changed_at: at(-30_000),
    ...over,
  };
}

describe("the box on team_state", () => {
  let dir: string;
  let runs: string[][];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "team-state-guard-"));
    runs = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const exec = async (args: string[]) => {
    runs.push(args);
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const store = () => createDoneStore(join(dir, "done.json"));
  function ctx(over: Record<string, unknown> = {}) {
    return { ownerId: OWNER, serverNow: () => SERVER_NOW, done: store(), exec, ...over };
  }
  const converge = (row: object, c = ctx()) => reconcile("https://site", "tok", row, c);

  // ── start ─────────────────────────────────────────────────────────────────
  it("starts on a fresh desire of its own user, once", async () => {
    const c = ctx();
    expect(await converge(state(), c)).toBe("started");
    // the box did not get to write is_running: the same row comes back
    expect(await converge(state(), c)).toBeNull();
    // a new poller process: a new store on the same file
    expect(await converge(state())).toBeNull();
    expect(runs).toEqual([["team", "start"]]);
  });

  it.each([
    ["without the database's stamp (before migration 098)", { desired_changed_at: undefined }],
    ["with a stamp that is not a time", { desired_changed_at: "yesterday" }],
    ["two minutes in the future", { desired_changed_at: at(2 * 60_000) }],
    ["eleven minutes old", { desired_changed_at: at(-11 * 60_000) }],
    ["set last week while the box was off", { desired_changed_at: at(-7 * 24 * 3600_000) }],
    ["of another user", { user_id: OTHER }],
    ["with should_run as text", { should_run: "true" }],
  ])("does not start on a desire %s", async (_label, over) => {
    expect(await converge(state(over))).toBeNull();
    expect(runs).toEqual([]);
  });

  it("does not start when the box does not know its user", async () => {
    expect(await converge(state(), ctx({ ownerId: null }))).toBeNull();
    expect(runs).toEqual([]);
  });

  it("starts at exactly ten minutes, not past them", async () => {
    expect(await converge(state({ desired_changed_at: at(-MAX_AGE_MS) }))).toBe("started");
    expect(await converge(state({ desired_changed_at: at(-MAX_AGE_MS - 1000) }))).toBeNull();
    expect(runs).toEqual([["team", "start"]]);
  });

  it("measures the age on the server's clock, not on the box's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW - 24 * 3600_000);
    expect(await converge(state())).toBe("started");
    vi.setSystemTime(SERVER_NOW + 24 * 3600_000);
    expect(await converge(state({ desired_changed_at: at(-11 * 60_000) }))).toBeNull();
    expect(runs).toHaveLength(1);
  });

  // ── restart ───────────────────────────────────────────────────────────────
  it("restarts once per token, even if last_restart_token is put back", async () => {
    const row = state({ is_running: true, restart_token: TOKEN_A });
    const c = ctx();
    expect(await converge(row, c)).toBe("restarted");
    expect(await converge({ ...row, last_restart_token: null }, c)).toBeNull();
    expect(runs).toEqual([["team", "restart"]]);
  });

  it.each([
    ["a token that is not a uuid", { restart_token: "../x" }],
    ["an old desire", { restart_token: TOKEN_A, desired_changed_at: at(-11 * 60_000) }],
    ["no stamp", { restart_token: TOKEN_A, desired_changed_at: null }],
    ["another user's row", { restart_token: TOKEN_A, user_id: OTHER }],
  ])("does not restart on %s", async (_label, over) => {
    expect(await converge(state({ is_running: true, ...over }))).toBeNull();
    expect(runs).toEqual([]);
  });

  // ── stop: the safe direction ──────────────────────────────────────────────
  it("stops however old the desire, on its own user's row", async () => {
    const row = state({ should_run: false, is_running: true, desired_changed_at: undefined });
    expect(await converge(row)).toBe("stopped");
    expect(runs).toEqual([["team", "stop"]]);
  });

  it.each([
    ["of another user", { user_id: OTHER }],
    ["with should_run as text", { should_run: "false" }],
    ["with should_run missing", { should_run: undefined }],
  ])("does not stop on a row %s", async (_label, over) => {
    expect(await converge(state({ is_running: true, ...over }))).toBeNull();
    expect(runs).toEqual([]);
  });

  // ── emergency stop (the one the daemon runs by default) ───────────────────
  const CONFIG = { enabled: true, base_url: "https://site", token: "tok", user_id: OWNER };
  const emergency = (over: Record<string, unknown> = {}) => ({
    user_id: OWNER,
    should_run: false,
    is_running: true,
    emergency_stop_requested_at: at(-24 * 3600_000),
    emergency_stop_completed_at: null,
    ...over,
  });

  it("runs an emergency stop however old the request, once per request", async () => {
    const done = store();
    expect(await reconcileEmergencyStop(CONFIG, emergency(), { done, exec })).toMatchObject({ action: "stopped" });
    // completed_at put back: the same request does not stop twice, not even after a restart of the box
    expect(await reconcileEmergencyStop(CONFIG, emergency(), { done, exec })).toMatchObject({ refused: "already_executed" });
    expect(await reconcileEmergencyStop(CONFIG, emergency(), { done: store(), exec })).toMatchObject({ refused: "already_executed" });
    // a new request is a new stop
    await reconcileEmergencyStop(CONFIG, emergency({ emergency_stop_requested_at: at(-1000) }), { done, exec });
    expect(runs).toEqual([["team", "stop"], ["team", "stop"]]);
  });

  it("refuses an emergency stop on another user's row or when the box does not know its user", async () => {
    expect(await reconcileEmergencyStop(CONFIG, emergency({ user_id: OTHER }), { done: store(), exec })).toMatchObject({
      refused: "not_owner",
    });
    expect(await reconcileEmergencyStop(CONFIG, emergency({ user_id: undefined }), { done: store(), exec })).toMatchObject({
      refused: "not_owner",
    });
    const noOwner = { ...CONFIG, user_id: undefined };
    expect(await reconcileEmergencyStop(noOwner, emergency(), { done: store(), exec })).toMatchObject({
      refused: "owner_unknown",
    });
    expect(runs).toEqual([]);
  });

  it("does not run an emergency stop it cannot write down", async () => {
    const done = { has: () => false, add: () => { throw new Error("ENOSPC"); } };
    expect(await reconcileEmergencyStop(CONFIG, emergency(), { done, exec })).toMatchObject({
      refused: "done_store_unwritable",
    });
    expect(runs).toEqual([]);
  });

  it("reads user_id with the row the emergency stop is decided on", async () => {
    const asked: string[][] = [];
    const reader = {
      async readTeamState(columns: string[]) {
        asked.push(columns);
        return emergency();
      },
    };
    await readRendezvousState(CONFIG, { reader });
    expect(asked[0]).toContain("user_id");
    expect(asked[0]).toContain("emergency_stop_requested_at");
  });
});
