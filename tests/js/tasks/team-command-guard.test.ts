/**
 * The box's executor of team commands treats the row as untrusted input
 * (P6/W5): closed vocabulary, the paired user's rows only, the age from the
 * database's clock against the server's, one run per id.
 *
 * Why each piece: a session with the user's JWT can write `team_commands`
 * straight through PostgREST, with any `requested_at`, and can put a row that
 * already ran back to `pending`. The site cannot stop that; the box can.
 *
 * `processCommand` runs for real here, with a fake network (the PATCH calls
 * are recorded) and a fake executor: the assertions are on what was RUN and
 * what the row was closed with, not on the guard's return value alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DONE_KEEP_MS,
  FUTURE_SKEW_MS,
  MAX_AGE_MS,
  commandRefusal,
  createDoneStore,
  serverClock,
} from "../../../cli/src/lib/team-command-guard.js";
import { processCommand } from "../../../cli/src/lib/team-commands-poller.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SERVER_NOW = Date.parse("2026-10-22T12:00:00Z");
let seq = 0;

function row(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, "0")}`,
    user_id: OWNER,
    action: "start",
    payload: { target: "all" },
    requested_at: new Date(SERVER_NOW - 30_000).toISOString(),
    status: "pending",
    ...over,
  };
}

const at = (offsetMs: number) => new Date(SERVER_NOW + offsetMs).toISOString();

type Patch = { id: string; status: string; error?: string };

describe("team commands on the box", () => {
  let dir: string;
  let patches: Patch[];
  let runs: Array<[string, string]>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "team-guard-"));
    patches = [];
    runs = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { method: string; body?: string }) => {
        const id = url.split("/").pop() as string;
        patches.push({ id, ...JSON.parse(init.body || "{}") });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
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

  function context(over: Record<string, unknown> = {}) {
    return {
      ownerId: OWNER,
      serverNow: () => SERVER_NOW,
      done: createDoneStore(join(dir, "done.json")),
      exec: async (action: string, target: string) => {
        runs.push([action, target]);
        return { ok: true, exitCode: 0, stdout: "", stderr: "" };
      },
      ...over,
    };
  }

  const handle = (command: object, ctx = context()) => processCommand("https://site", "tok", command, ctx);

  it("runs a fresh command of its own user once, claimed first and closed as done", async () => {
    const command = row({ action: "restart", payload: { target: "scout" } });
    await handle(command);
    expect(runs).toEqual([["restart", "scout"]]);
    expect(patches.map((p) => p.status)).toEqual(["running", "done"]);
  });

  // ── the age: sentinels on the future and the past ─────────────────────────
  it.each([
    ["two minutes in the future", at(2 * 60_000), "requested_in_future"],
    ["a day in the future", at(24 * 3600_000), "requested_in_future"],
    ["eleven minutes old", at(-11 * 60_000), "expired"],
    ["queued yesterday while the box was off", at(-24 * 3600_000), "expired"],
  ])("refuses a row %s and never runs it", async (_label, requestedAt, reason) => {
    const command = row({ requested_at: requestedAt });
    await handle(command);
    expect(runs).toEqual([]);
    expect(patches).toEqual([{ id: command.id, status: "error", error: `refused by the box: ${reason}` }]);
  });

  it.each([
    ["inside the clocks' margin in the future", at(FUTURE_SKEW_MS - 1000)],
    ["just under ten minutes old", at(-(MAX_AGE_MS - 1000))],
    ["exactly ten minutes old", at(-MAX_AGE_MS)],
  ])("runs a row %s", async (_label, requestedAt) => {
    await handle(row({ requested_at: requestedAt }));
    expect(runs).toEqual([["start", "all"]]);
  });

  it("measures the age on the server's clock, not on the box's", async () => {
    // The box's clock is a day behind: on it, a row from now would look like the future.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW - 24 * 3600_000);
    await handle(row({ requested_at: at(-30_000) }));
    expect(runs).toEqual([["start", "all"]]);
    // and a day ahead: a row eleven minutes old on the server is refused, whatever the box says.
    vi.setSystemTime(SERVER_NOW + 24 * 3600_000);
    await handle(row({ requested_at: at(-11 * 60_000) }));
    expect(runs).toHaveLength(1);
  });

  it("reads the server's clock from the reply's Date header", () => {
    expect(serverClock("Thu, 22 Oct 2026 12:00:00 GMT")).toBe(SERVER_NOW);
    expect(serverClock(null)).toBeNull();
    expect(serverClock("not a date")).toBeNull();
  });

  it("refuses a row without a readable requested_at", async () => {
    for (const requestedAt of [undefined, "", "yesterday", 1760000000]) {
      await handle(row({ requested_at: requestedAt }));
    }
    expect(runs).toEqual([]);
    expect(new Set(patches.map((p) => p.error))).toEqual(new Set(["refused by the box: no_request_time"]));
  });

  // ── ownership ─────────────────────────────────────────────────────────────
  it("refuses another user's row, and every row when the box does not know its user", async () => {
    await handle(row({ user_id: OTHER }));
    await handle(row({ user_id: undefined }));
    await handle(row(), context({ ownerId: null }));
    expect(runs).toEqual([]);
    expect(patches.map((p) => p.error)).toEqual([
      "refused by the box: not_owner",
      "refused by the box: not_owner",
      "refused by the box: owner_unknown",
    ]);
  });

  // ── one run per id ────────────────────────────────────────────────────────
  it("runs an id once, even when the row comes back as pending, and remembers it across restarts", async () => {
    const command = row();
    const ctx = context();
    await handle(command, ctx);
    await handle({ ...command }, ctx);
    // a new poller process: a new store on the same file
    await handle({ ...command }, context());
    expect(runs).toEqual([["start", "all"]]);
    expect(patches.slice(2)).toEqual([
      { id: command.id, status: "error", error: "refused by the box: already_executed" },
      { id: command.id, status: "error", error: "refused by the box: already_executed" },
    ]);
  });

  it("writes the id down before running it", async () => {
    const command = row();
    const ctx = context();
    let knownWhenRun = false;
    ctx.exec = async (action: string, target: string) => {
      knownWhenRun = createDoneStore(join(dir, "done.json")).has(command.id);
      runs.push([action, target]);
      return { ok: true, exitCode: 0, stdout: "", stderr: "" };
    };
    await handle(command, ctx);
    expect(knownWhenRun).toBe(true);
  });

  it("does not run a command whose id cannot be written down", async () => {
    const ctx = context({
      done: { has: () => false, add: () => { throw new Error("ENOSPC"); } },
    });
    const command = row();
    await handle(command, ctx);
    expect(runs).toEqual([]);
    expect(patches.map((p) => p.status)).toEqual(["running", "error"]);
    expect(patches[1].error).toBe("refused by the box: done_store_unwritable");
  });

  it("forgets ids only long after the age has closed them", () => {
    let now = SERVER_NOW;
    const path = join(dir, "done.json");
    createDoneStore(path, { now: () => now }).add("old");
    now += DONE_KEEP_MS + 1;
    createDoneStore(path, { now: () => now }).add("new");
    const kept = JSON.parse(readFileSync(path, "utf-8")).ids;
    expect(Object.keys(kept)).toEqual(["new"]);
    expect(DONE_KEEP_MS).toBeGreaterThan(MAX_AGE_MS + FUTURE_SKEW_MS);
  });

  it("starts empty on an unreadable store, and refuses to run if it cannot write it", async () => {
    const path = join(dir, "done.json");
    writeFileSync(path, "{not json");
    expect(createDoneStore(path).has("x")).toBe(false);
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      const locked = join(dir, "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o500);
      await handle(row(), context({ done: createDoneStore(join(locked, "done.json")) }));
      chmodSync(locked, 0o700);
      expect(runs).toEqual([]);
    }
  });

  // ── the closed vocabulary ─────────────────────────────────────────────────
  it.each([
    [{ action: "delete" }, "invalid_action"],
    [{ payload: { target: "closer" } }, "invalid_target"],
    [{ payload: { target: "all; rm -rf /" } }, "invalid_target"],
    [{ action: "restart", payload: { target: "bridge" } }, "bridge_no_restart"],
  ])("refuses %j", async (over, reason) => {
    await handle(row(over));
    expect(runs).toEqual([]);
    expect(patches[0].error).toBe(`refused by the box: ${reason}`);
  });

  it("does not even close a row whose id is not a uuid", async () => {
    await handle(row({ id: "../../team-commands" }));
    expect(runs).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("checks the id before anything else, so a replay says what it is", () => {
    const done = { has: () => true };
    expect(commandRefusal(row({ user_id: OTHER }), { ownerId: OWNER, serverNow: SERVER_NOW, done })).toBe(
      "already_executed",
    );
  });
});
