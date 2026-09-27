import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  agentsStatusWriter,
  createHeartbeatCarrier,
  buildAgentsStatus,
  canonicalAgentId,
  createAgentsStatusReader,
  createSmoother,
  parseThrottles,
  SINGLE_ROLES,
  startAgentsStatusPublisher,
  statusKey,
} from "../../../cli/src/lib/agents-status.js";

// The rule is the Godot game's (vps_backend.gd): these cases are its.

describe("parseThrottles (vps_backend.gd _parse_throttles)", () => {
  const now = 1_790_000_000;
  const line = (o: object) => JSON.stringify(o);

  it("a start whose window covers now is a throttle in progress", () => {
    const raw = [line({ event: "start", agent: "SCOUT-1", ts_unix: now - 30, applied_sec: 120 })].join("\n");
    expect(parseThrottles(raw, now)).toEqual({ "scout-1": { left: 90, total: 120 } });
  });

  it("only the last event of an agent counts, and an ended or expired one is none", () => {
    const raw = [
      line({ event: "start", agent: "scout-1", ts_unix: now - 30, applied_sec: 120 }),
      line({ event: "end", agent: "scout-1", ts_unix: now - 10 }),
      line({ event: "start", agent: "analista-1", ts_unix: now - 300, applied_sec: 60 }),
      "not json",
      line({ event: "start", ts_unix: now, applied_sec: 60 }),
    ].join("\n");
    expect(parseThrottles(raw, now)).toEqual({});
  });
});

describe("the hysteresis (vps_backend.gd _smooth_activity)", () => {
  it("a working drops to idle only at the second idle reading in a row", () => {
    const smooth = createSmoother();
    expect(smooth({ "SCOUT-1": { status: "working" } })).toEqual({ "SCOUT-1": "working" });
    expect(smooth({ "SCOUT-1": { status: "idle" } })).toEqual({ "SCOUT-1": "working" });
    expect(smooth({ "SCOUT-1": { status: "idle" } })).toEqual({ "SCOUT-1": "idle" });
  });

  it("an unreadable pane keeps the last status, or idle without one", () => {
    const smooth = createSmoother();
    expect(smooth({ A: { status: "unknown" } })).toEqual({ A: "idle" });
    smooth({ B: { status: "paused" } });
    expect(smooth({ B: { status: "unknown" } })).toEqual({ B: "paused" });
  });
});

describe("the published map", () => {
  it("keys by the session in lower case, a throttle wins, since moves only on a change", () => {
    const changedAt = new Map();
    const t0 = new Date("2026-09-27T20:00:00Z");
    const t1 = new Date("2026-09-27T20:00:20Z");
    const first = buildAgentsStatus({ CAPITANO: "working", "SCOUT-1": "idle" }, {}, changedAt, t0);
    expect(first).toEqual({
      capitano: { status: "working", since: t0.toISOString() },
      "scout-1": { status: "idle", since: t0.toISOString() },
    });
    const second = buildAgentsStatus({ CAPITANO: "working", "SCOUT-1": "idle" }, { "scout-1": { left: 89.6, total: 120 } }, changedAt, t1);
    expect(second.capitano.since).toBe(t0.toISOString());
    expect(second["scout-1"]).toEqual({ status: "throttled", since: t1.toISOString(), throttle_left_s: 90 });
  });

  it("an unknown pane status is idle, as the game's roster reads it", () => {
    expect(buildAgentsStatus({ "SCOUT-2": "weird" }, {}, new Map())["scout-2"].status).toBe("idle");
  });

  it("a session whose name is not an agent's is left out, told once, and the others are published", async () => {
    const dropped = vi.fn();
    const map = buildAgentsStatus({ "SCOUT-1": "working", my_shell: "idle", "sess 2": "idle" }, {}, new Map(), new Date(), dropped);
    expect(Object.keys(map)).toEqual(["scout-1"]);
    expect(dropped.mock.calls.map((c) => c[0])).toEqual(["my_shell", "sess 2"]);

    const log = vi.fn();
    const reader = createAgentsStatusReader({ jhtHome: "/nowhere", run: async () => ({ "SCOUT-1": { status: "working" }, my_shell: { status: "idle" } }), readThrottles: async () => "", log });
    expect(Object.keys((await reader.read())!)).toEqual(["scout-1"]);
    await reader.read();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "agents-status.name-dropped", { name: "my_shell" });
  });

  it("a session that is gone leaves the map", () => {
    const changedAt = new Map();
    buildAgentsStatus({ "SCOUT-1": "working", "SCOUT-2": "idle" }, {}, changedAt);
    const next = buildAgentsStatus({ "SCOUT-1": "working" }, {}, changedAt);
    expect(Object.keys(next)).toEqual(["scout-1"]);
    expect([...changedAt.keys()]).toEqual(["scout-1"]);
  });
});

describe("one name per agent, whoever publishes it (canonicalAgentId)", () => {
  it("the TUI's sessions and the JHT API's numbered ids land on the same key", () => {
    expect(canonicalAgentId("CAPITANO")).toBe("capitano");
    expect(canonicalAgentId("capitano-1")).toBe("capitano");
    expect(canonicalAgentId("SCOUT-1")).toBe("scout-1");
    expect(canonicalAgentId("scout")).toBe("scout-1");
    expect(canonicalAgentId("scout-3")).toBe("scout-3");
    expect(canonicalAgentId("CRITICO-S2")).toBe("critico-s2");
    expect(canonicalAgentId("critico-1")).toBe("critico");
    expect(canonicalAgentId("capitano-2")).toBe("capitano-2");
  });

  it("the roles without a number are the launcher's (spawn-lib.sh)", () => {
    const lib = readFileSync(join(resolve(__dirname, "../../.."), ".launcher/spawn-lib.sh"), "utf8");
    const body = lib.slice(lib.indexOf("jht_spawn_session_name()"));
    const singles = /\n\s+([a-z|]+)\)\n\s+printf '%s' "\$prefix"/.exec(body);
    expect(singles, "jht_spawn_session_name no longer names its single roles the same way").not.toBeNull();
    expect(singles![1].split("|").sort()).toEqual([...SINGLE_ROLES].sort());
  });

  it("the pacing log's names are the same keys", () => {
    const now = 1_790_000_000;
    const raw = JSON.stringify({ event: "start", agent: "CAPITANO", ts_unix: now - 10, applied_sec: 60 });
    expect(Object.keys(parseThrottles(raw, now))).toEqual(["capitano"]);
  });
});

describe("the reader and the publisher", () => {
  it("a rule that cannot run publishes nothing", async () => {
    const reader = createAgentsStatusReader({ jhtHome: "/nowhere", run: async () => null, readThrottles: async () => "" });
    expect(await reader.read()).toBeNull();
  });

  it("writes on a change and as a keepalive, not on every reading", async () => {
    vi.useFakeTimers();
    try {
      let status = "working";
      const reader = { read: async () => ({ a: { status, since: "x", source: "tui" } }) };
      const write = vi.fn(async () => {});
      const stop = startAgentsStatusPublisher({ reader, write, every: 1000, keepalive: 10_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(write).toHaveBeenCalledTimes(1);
      status = "idle";
      await vi.advanceTimersByTimeAsync(1000);
      expect(write).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(write).toHaveBeenCalledTimes(3);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a route that refuses the field: one warning, then quiet, and a retry only after the long wait", async () => {
    vi.useFakeTimers();
    try {
      const reader = { read: async () => ({ a: { status: "idle", since: "x" } }) };
      const refused = Object.assign(new Error("PATCH /api/team-state → HTTP 403"), { status: 403 });
      const write = vi.fn().mockRejectedValue(refused);
      const log = vi.fn();
      const stop = startAgentsStatusPublisher({ reader, write, every: 1000, keepalive: 60_000, refusedRetry: 30_000, log });
      await vi.advanceTimersByTimeAsync(29_000);
      expect(write).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]![2]).toMatchObject({ status: 403, retry_in_s: 30 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(write).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledTimes(1);
      write.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(write).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenLastCalledWith("info", "agents-status.write-resumed", {});
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a network failure tries again the next round, still with one warning", async () => {
    vi.useFakeTimers();
    try {
      const reader = { read: async () => ({ a: { status: "idle", since: "x" } }) };
      const write = vi.fn().mockRejectedValue(new Error("fetch failed"));
      const log = vi.fn();
      const stop = startAgentsStatusPublisher({ reader, write, every: 1000, keepalive: 60_000, log });
      await vi.advanceTimersByTimeAsync(3000);
      expect(write).toHaveBeenCalledTimes(4);
      expect(log).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes direct with a session, hands the map to the heartbeat without one, only its own source", async () => {
    const map = { "scout-1": { status: "working", since: "x" } };
    const direct = { patchTeamState: vi.fn(async () => {}) };
    const carrier = createHeartbeatCarrier({ source: "api" });
    const hold = vi.spyOn(carrier, "hold");
    await agentsStatusWriter({ source: "tui", direct, carrier })(map);
    expect(direct.patchTeamState).toHaveBeenCalledWith({ agents_status: { tui: { agents: map } } });
    expect(hold).not.toHaveBeenCalled();
    expect(carrier.fields()).toEqual({});
    await agentsStatusWriter({ source: "api", direct: null, carrier })(map);
    expect(carrier.fields()).toEqual({ agents_status: { api: { agents: map } } });
  });

  it("the heartbeat carrier gives the last map, and nothing for a while after a refusal", async () => {
    let now = 1_000;
    const carrier = createHeartbeatCarrier({ source: "tui", refusedRetry: 30_000, now: () => now });
    expect(carrier.fields()).toEqual({});
    await carrier.hold({ a: { status: "idle", since: "1" } });
    await carrier.hold({ a: { status: "working", since: "2" } });
    expect(carrier.fields()).toEqual({ agents_status: { tui: { agents: { a: { status: "working", since: "2" } } } } });
    carrier.refused();
    now += 29_999;
    expect(carrier.fields()).toEqual({});
    now += 1;
    expect(carrier.fields()).toHaveProperty("agents_status");
  });

  it("the change key ignores `since`", () => {
    expect(statusKey({ a: { status: "idle", since: "1", source: "tui" } })).toBe(statusKey({ a: { status: "idle", since: "2", source: "tui" } }));
  });
});
