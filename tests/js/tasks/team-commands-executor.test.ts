/**
 * The executor of the site's team commands, inside the cloud daemon.
 *
 * Since the door (migration 098) a start, stop or restart asked on the site is
 * a row of `team_commands`. The standalone poller that ran them was retired on
 * 25/06 (it polled the site every 5 s), so nothing ran them: the page waited
 * three minutes and said the device was silent. The daemon now owns them:
 * the Realtime INSERT wakes one pass, and a slow round recovers a lost event,
 * asking the user's own session before it asks the site.
 *
 * Here the executor runs as the daemon builds it (`createTeamCommandsExecutor`),
 * with a fake Realtime, a fake session, a fake site and a fake `jht`: the
 * assertions are on what RAN and what the row was closed with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDoneStore } from "../../../cli/src/lib/team-command-guard.js";
import {
  PENDING_COMMANDS_PATH,
  commandFailure,
  createTeamCommandsExecutor,
} from "../../../cli/src/lib/team-commands-poller.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SERVER_NOW = Date.parse("2026-10-22T12:00:00Z");
const SITE = "https://site.example";
const CONFIG = { enabled: true, base_url: SITE, token: "jht_sync_test", user_id: OWNER };

let seq = 0;
function row(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(seq).padStart(12, "0")}`,
    user_id: OWNER,
    action: "start",
    payload: { target: "all" },
    requested_at: new Date(SERVER_NOW - 20_000).toISOString(),
    status: "pending",
    ...over,
  };
}

type Sub = { name: string; opts: { table: string; event: string }; handler: () => void };

describe("the daemon's executor of the site's team commands", () => {
  let dir: string;
  let pending: ReturnType<typeof row>[];
  let gets: number;
  let patches: Array<{ id: string; status: string; error?: string }>;
  let runs: Array<[string, string]>;
  let notices: Array<{ code: string; key: string }>;
  let subs: Sub[];

  const fetchFn = vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
    if ((init.method || "GET") === "GET") {
      expect(url).toBe(`${SITE}${PENDING_COMMANDS_PATH}`);
      gets += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h.toLowerCase() === "date" ? new Date(SERVER_NOW).toUTCString() : null) },
        json: async () => ({ commands: pending }),
      };
    }
    const id = url.split("/").pop() as string;
    const body = JSON.parse(init.body || "{}");
    patches.push({ id, ...body });
    // The site's route closes the row: a done or error row is no longer pending.
    if (body.status === "done" || body.status === "error") pending = pending.filter((r) => r.id !== id);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  const rt = { subscribe: (name: string, opts: Sub["opts"], handler: () => void) => { subs.push({ name, opts, handler }); } };

  function executor(over: Record<string, unknown> = {}) {
    return createTeamCommandsExecutor({
      config: CONFIG,
      haltGate: () => false,
      slowMs: 300_000,
      done: createDoneStore(join(dir, "done.json")),
      fetchFn,
      exec: async (action: string, target: string) => {
        runs.push([action, target]);
        return { ok: true, exitCode: 0, stdout: "", stderr: "" };
      },
      notice: async (n: { code: string; key: string }) => {
        notices.push(n);
        return { notified: true };
      },
      ...over,
    } as never);
  }

  const session = (answer: boolean | null) => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => (answer === null ? { data: null, error: { message: "down" } } : { data: answer ? [{ id: "x" }] : [], error: null }),
        }),
      }),
    }),
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "team-exec-"));
    pending = [];
    gets = 0;
    patches = [];
    runs = [];
    notices = [];
    subs = [];
    fetchFn.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("listens to the INSERT on team_commands, and a command from the site runs once", async () => {
    const ex = executor();
    ex.subscribe(rt);
    expect(subs.map((s) => [s.name, s.opts.table, s.opts.event])).toEqual([["team-commands", "team_commands", "INSERT"]]);

    const cmd = row({ action: "restart", payload: { target: "scout" } });
    pending = [cmd];
    subs[0].handler(); // the event
    await vi.waitFor(() => expect(patches.map((p) => p.status)).toEqual(["running", "done"]));
    expect(runs).toEqual([["restart", "scout"]]);
    expect(notices).toEqual([{ code: "team_restarted_from_web", key: `cmd:${cmd.id}` }]);

    // The same row shown again (an event twice, a recovery round, a restart of
    // the daemon with the same done file): never run a second time.
    pending = [{ ...cmd }];
    subs[0].handler();
    await vi.waitFor(() => expect(patches).toHaveLength(3));
    await createTeamCommandsExecutor({
      config: CONFIG, haltGate: () => false, slowMs: 300_000, fetchFn,
      done: createDoneStore(join(dir, "done.json")),
      exec: async () => { throw new Error("must not run"); },
      notice: async () => ({ notified: true }),
      getClient: () => session(true),
    } as never).run("fallback");
    expect(runs).toEqual([["restart", "scout"]]);
    expect(notices).toHaveLength(1);
    expect(patches.slice(2).map((p) => p.error)).toEqual(["refused by the box: already_executed"]);
  });

  it("a burst of events while a pass runs gets one more pass, and every row runs once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const ex = executor({
      exec: async (action: string, target: string) => {
        runs.push([action, target]);
        await gate;
        return { ok: true, exitCode: 0, stdout: "", stderr: "" };
      },
    });
    ex.subscribe(rt);
    const first = row();
    pending = [first];
    subs[0].handler();
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    const second = row({ action: "stop" });
    pending.push(second); // inserted while the first runs
    subs[0].handler();
    subs[0].handler();
    release();
    await vi.waitFor(() => expect(runs).toEqual([["start", "all"], ["stop", "all"]]));
    await vi.waitFor(() => expect(patches.filter((p) => p.status === "done").map((p) => p.id)).toEqual([first.id, second.id]));
    expect(gets).toBe(2);
  });

  it("the slow round asks the user's session first: nothing pending, the site is not asked", async () => {
    const ex = executor({ getClient: () => session(false) });
    pending = [row()];
    await ex.run("fallback");
    await ex.run("fallback");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  it("the slow round runs a row the event missed, when the session says one is pending", async () => {
    const ex = executor({ getClient: () => session(true) });
    pending = [row({ action: "stop" })];
    await ex.run("fallback");
    expect(runs).toEqual([["stop", "all"]]);
    expect(notices.map((n) => n.code)).toEqual(["team_stopped_from_web"]);
  });

  it("without an answer from the session, the site is read at most once per slow period", async () => {
    let clock = 1_000_000;
    const ex = executor({ getClient: () => session(null), now: () => clock });
    await ex.run("fallback");
    await ex.run("fallback");
    clock += 299_000;
    await ex.run("fallback");
    expect(gets).toBe(1);
    clock += 1_000;
    await ex.run("fallback");
    expect(gets).toBe(2);
    // The event is never held back by the slow period.
    pending = [row()];
    await ex.run("realtime");
    expect(gets).toBe(3);
    expect(runs).toEqual([["start", "all"]]);
  });

  it("a command that fails tells the site a fixed sentence, never its output, and sends no notice", async () => {
    const ex = executor({
      exec: async (action: string, target: string) => {
        runs.push([action, target]);
        return { ok: false, exitCode: 3, stdout: "✗ CAPITANO /home/user/.jht/secrets/key sk-live-abc", stderr: "token=xyz" };
      },
    });
    pending = [row()];
    await ex.run("realtime");
    const closed = patches.find((p) => p.status === "error");
    expect(closed?.error).toBe(commandFailure(3));
    expect(closed!.error!.length).toBeLessThanOrEqual(200);
    expect(closed!.error).not.toMatch(/\/|sk-|token/);
    expect(notices).toEqual([]);
  });

  it("an old row is refused and closed, never run (P6: ten minutes by the server's clock)", async () => {
    const ex = executor();
    pending = [row({ requested_at: new Date(SERVER_NOW - 11 * 60_000).toISOString() })];
    await ex.run("realtime");
    expect(runs).toEqual([]);
    expect(patches.map((p) => [p.status, p.error])).toEqual([["error", "refused by the box: expired"]]);
  });

  it("the door's cap holds on the box too: the seventh start or restart in an hour is refused, not run", async () => {
    let clock = SERVER_NOW;
    const store = () => createDoneStore(join(dir, "done.json"), { now: () => clock });
    const ex = executor({ done: store() });
    const ups = [row(), row(), row(), row({ action: "restart" }), row({ action: "restart", payload: { target: "scout" } }), row(), row()];
    pending = ups;
    await ex.run("realtime");
    expect(runs).toHaveLength(6);
    const seventh = ups[6];
    expect(patches.filter((p) => p.id === seventh.id)).toEqual([
      { id: seventh.id, status: "error", error: "refused by the box: rate_limited" },
    ]);
    expect(notices).toHaveLength(6);
    expect(notices.some((n) => n.key === `cmd:${seventh.id}`)).toBe(false);

    // Stops have their own cap (12), untouched by the starts.
    pending = Array.from({ length: 13 }, () => row({ action: "stop" }));
    const stops = [...pending];
    await ex.run("realtime");
    expect(runs.filter(([a]) => a === "stop")).toHaveLength(12);
    expect(patches.filter((p) => p.id === stops[12].id).map((p) => p.error)).toEqual(["refused by the box: rate_limited"]);

    // The count is kept on disk: a new executor (a restart of the daemon) still sees it.
    pending = [row()];
    await executor({ done: store() }).run("realtime");
    expect(runs.filter(([a]) => a !== "stop")).toHaveLength(6);

    // An hour later the share is back (the fake site keeps the rows fresh by the server's clock).
    clock += 60 * 60_000 + 1;
    pending = [row()];
    await executor({ done: store() }).run("realtime");
    expect(runs.filter(([a]) => a !== "stop")).toHaveLength(7);
  });

  it("the halt gate stops the pass: nothing is read or run", async () => {
    const ex = executor({ haltGate: () => true });
    pending = [row()];
    await ex.run("realtime");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  it("the daemon builds it: the realtime loop subscribes it and runs it in the slow round, the loop without realtime too", () => {
    const src = readFileSync(join(__dirname, "../../../cli/src/commands/cloud.js"), "utf8");
    const loop = src.slice(src.indexOf("async function runRealtimeLoop"));
    expect(loop).toMatch(/const teamCommands = createTeamCommandsExecutor\(\{/);
    expect(loop).toMatch(/teamCommands\.subscribe\(rt\);/);
    const fallback = loop.slice(loop.indexOf("const pollFallback"), loop.indexOf("const realtimeStatus"));
    expect(fallback).toMatch(/await teamCommands\.run\('fallback'\);/);
    const daemon = src.slice(src.indexOf("const teamCommandsSlow = createLane("), src.indexOf("async function runRealtimeLoop"));
    expect(daemon).toMatch(/await teamCommandsSlow\('fallback'\);/);
  });
});
