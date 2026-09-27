import { describe, expect, it, vi } from "vitest";
import {
  buildAgentsStatus,
  createAgentsStatusReader,
  createSmoother,
  parseThrottles,
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
      capitano: { status: "working", since: t0.toISOString(), source: "tui" },
      "scout-1": { status: "idle", since: t0.toISOString(), source: "tui" },
    });
    const second = buildAgentsStatus({ CAPITANO: "working", "SCOUT-1": "idle" }, { "scout-1": { left: 89.6, total: 120 } }, changedAt, t1);
    expect(second.capitano.since).toBe(t0.toISOString());
    expect(second["scout-1"]).toEqual({ status: "throttled", since: t1.toISOString(), source: "tui", throttle_left_s: 90 });
  });

  it("an unknown pane status is idle, as the game's roster reads it", () => {
    expect(buildAgentsStatus({ X: "weird" }, {}, new Map())["x"].status).toBe("idle");
  });

  it("a session that is gone leaves the map", () => {
    const changedAt = new Map();
    buildAgentsStatus({ A: "working", B: "idle" }, {}, changedAt);
    const next = buildAgentsStatus({ A: "working" }, {}, changedAt);
    expect(Object.keys(next)).toEqual(["a"]);
    expect([...changedAt.keys()]).toEqual(["a"]);
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

  it("a failed write only skips a round", async () => {
    const reader = { read: async () => ({ a: { status: "idle", since: "x", source: "tui" } }) };
    const write = vi.fn().mockRejectedValueOnce(new Error("refused")).mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      const stop = startAgentsStatusPublisher({ reader, write, every: 1000, keepalive: 60_000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(write).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the change key ignores `since`", () => {
    expect(statusKey({ a: { status: "idle", since: "1", source: "tui" } })).toBe(statusKey({ a: { status: "idle", since: "2", source: "tui" } }));
  });
});
