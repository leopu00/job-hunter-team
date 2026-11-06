import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clearWorkStats, pickWorkStats, readWorkStats } from "./work-stats-native";

// The door to the team's work-hours statistics: the closed shape, and nothing else. Synthetic values only.
const night = (fields: Record<string, unknown> = {}) => ({
  date: "2026-10-20",
  hoursActive: 9.5,
  found: 4,
  aboveThreshold: 1,
  scoreThreshold: 75,
  consumptionPct: 3,
  turnMedianSec: null,
  ...fields,
});
const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  nights: [night()],
  from: "2026-10-20",
  to: "2026-10-20",
  lastObservation: "2026-10-21T04:00:00Z",
  retentionDays: 90,
  threshold: 75,
  scheduleState: "valid",
  ...fields,
});

describe("pickWorkStats", () => {
  it("takes the closed shape, nulls included", () => {
    const picked = pickWorkStats(reply({ nights: [night({ aboveThreshold: null, scoreThreshold: null, consumptionPct: null })] }));
    expect(picked.ok).toBe(true);
    expect(pickWorkStats(reply({ nights: [], from: null, to: null, lastObservation: null, threshold: null })).ok).toBe(true);
  });

  it("takes a night with nothing counted as null, and the three states of the hours file", () => {
    expect(pickWorkStats(reply({ nights: [night({ found: null })] })).ok).toBe(true);
    for (const scheduleState of ["undeclared", "valid", "unreadable"]) expect(pickWorkStats(reply({ scheduleState })).ok, scheduleState).toBe(true);
    expect(pickWorkStats(reply({ retentionDays: 366, nights: [night({ hoursActive: 200 })] })).ok).toBe(true);
  });

  it("refuses a field outside the list, a missing one, a value off its range or its type", () => {
    const off = [
      reply({ nights: [night({ note: "x" })] }),
      reply({ nights: [{ date: "2026-10-20" }] }),
      reply({ nights: [night({ found: -1 })] }),
      reply({ nights: [night({ hoursActive: 201 })] }),
      reply({ nights: [night({ found: "4" })] }),
      reply({ nights: [night({ date: "20/10/2026" })] }),
      reply({ nights: [night({ consumptionPct: Number.POSITIVE_INFINITY })] }),
      reply({ extra: 1 }),
      reply({ scheduleState: "stopped" }),
      reply({ scheduleState: undefined }),
      reply({ retentionDays: 0 }),
      reply({ lastObservation: "not a date" }),
      reply({ nights: Array.from({ length: 401 }, () => night()) }),
      { ok: true },
      null,
      "ok",
    ];
    for (const value of off) expect(pickWorkStats(value), JSON.stringify(value).slice(0, 80)).toEqual({ ok: false, error: "stats_reply_unexpected" });
  });

  it("passes the team's own closed errors and turns any other word into «cannot be read», never «the team does not offer it»", () => {
    expect(pickWorkStats({ ok: false, error: "stats_unreadable" })).toEqual({ ok: false, error: "stats_unreadable" });
    expect(pickWorkStats({ ok: false, error: "/home/x/secret" })).toEqual({ ok: false, error: "stats_unreadable" });
    expect(pickWorkStats({ ok: false })).toEqual({ ok: false, error: "stats_unreadable" });
  });

  it("says «the team does not offer it» only when the team's script says the file is missing", () => {
    expect(pickWorkStats({ ok: false, error: "stats_unavailable" })).toEqual({ ok: false, error: "stats_unavailable" });
  });
});

describe("the two commands", () => {
  it("read asks for nothing and clear removes", async () => {
    const seen: string[] = [];
    const call = async (command: string) => {
      seen.push(command);
      return command === "work_stats_read" ? reply() : { ok: true };
    };
    expect((await readWorkStats(call)).ok).toBe(true);
    expect(await clearWorkStats(call)).toEqual({ ok: true });
    expect(seen).toEqual(["work_stats_read", "work_stats_clear"]);
  });

  it("a command that throws or answers off the shape is an error, never a success", async () => {
    const boom = async () => {
      throw new Error("down");
    };
    expect(await readWorkStats(boom)).toEqual({ ok: false, error: "stats_unreadable" });
    expect(await clearWorkStats(boom)).toEqual({ ok: false, error: "stats_clear_failed" });
    expect(await clearWorkStats(async () => ({ ok: true, removed: 3 }))).toEqual({ ok: false, error: "stats_clear_failed" });
    expect(await clearWorkStats(async () => ({ ok: false, error: "stats_clear_failed" }))).toEqual({ ok: false, error: "stats_clear_failed" });
  });
});

describe("a failed read tells its own reason", () => {
  it("says the reason of the native error, by its own code, and never «the team does not offer it» for a failure", async () => {
    for (const code of ["process_timeout", "account_scope_mismatch", "runtime_missing", "invalid_request"]) {
      expect(await readWorkStats(async () => Promise.reject({ code }))).toEqual({ ok: false, error: code });
    }
    // the chat's «cannot read the messages» is the statistics' own «cannot be read»
    expect(await readWorkStats(async () => Promise.reject({ code: "read_failed" }))).toEqual({ ok: false, error: "stats_unreadable" });
    expect(await readWorkStats(async () => Promise.reject("a sentence with spaces"))).toEqual({ ok: false, error: "stats_unreadable" });
    // clearing tells its reason too
    expect(await clearWorkStats(async () => Promise.reject({ code: "read_only_link" }))).toEqual({ ok: false, error: "read_only_link" });
  });

  it("connects the chat again once when it is not connected, then reads again", async () => {
    let connected = false;
    const asked: string[] = [];
    const result = await readWorkStats(
      async () => {
        asked.push(connected ? "read" : "read-disconnected");
        if (!connected) throw { code: "disconnected" };
        return { ok: true, nights: [], from: null, to: null, lastObservation: null, retentionDays: 90, threshold: null, scheduleState: "undeclared" };
      },
      async () => {
        connected = true;
        return { state: "ready" };
      },
    );
    expect(result.ok).toBe(true);
    expect(asked).toEqual(["read-disconnected", "read"]);
  });

  it("tells «not connected» when connecting again does not help, and does not loop", async () => {
    let reads = 0;
    let reconnects = 0;
    const disconnected = async () => {
      reads += 1;
      throw { code: "disconnected" };
    };
    expect(await readWorkStats(disconnected, async () => { reconnects += 1; })).toEqual({ ok: false, error: "disconnected" });
    expect([reads, reconnects]).toEqual([2, 1]);
    reads = 0;
    reconnects = 0;
    expect(await readWorkStats(disconnected, async () => { reconnects += 1; throw { code: "connect_failed" }; })).toEqual({ ok: false, error: "disconnected" });
    expect([reads, reconnects]).toEqual([1, 1]);
  });

  it("does not connect the chat again for any other failure", async () => {
    let reconnects = 0;
    await readWorkStats(async () => Promise.reject({ code: "read_failed" }), async () => { reconnects += 1; });
    expect(reconnects).toBe(0);
  });

  it("takes the answer of a team that has only just started (no night yet, nothing declared) whole, not as a failure", async () => {
    const fresh = { ok: true, nights: [], from: null, to: null, lastObservation: null, retentionDays: 90, threshold: null, scheduleState: "undeclared" };
    const picked = pickWorkStats(fresh);
    expect(picked.ok).toBe(true);
    expect(await readWorkStats(async () => fresh)).toEqual(picked);
  });
});

describe("the answer the team's native side serialises", () => {
  // The same file the Rust test compares the serialised answer with (work_stats.rs): one reply, or several by name.
  // Add a field on the Rust side and the fixture changes with it, and this goes red until the reader knows it.
  const FIXTURE = "src-tauri/tests/fixtures/work_stats_response.json";
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  const replies = Object.entries("ok" in fixture ? { reply: fixture } : fixture);

  it("is taken by the reader, every reply of the fixture", () => {
    expect(replies.length).toBeGreaterThan(0);
    for (const [name, value] of replies) expect(pickWorkStats(value), name).toMatchObject({ ok: true });
  });

  it("has a reply with numbers and one with nothing counted, so both are proved", () => {
    const nights = replies.flatMap(([, value]) => (value as { nights: { found: number | null }[] }).nights);
    expect(nights.some((night) => typeof night.found === "number")).toBe(true);
    expect(nights.some((night) => night.found === null)).toBe(true);
  });

  it("is refused as soon as it carries a field the reader does not know", () => {
    for (const [name, value] of replies) {
      expect(pickWorkStats({ ...(value as object), added: 1 }), name).toEqual({ ok: false, error: "stats_reply_unexpected" });
      const withNight = { ...(value as { nights: object[] }) };
      withNight.nights = withNight.nights.map((night) => ({ ...night, added: 1 }));
      if (withNight.nights.length) expect(pickWorkStats(withNight), name).toEqual({ ok: false, error: "stats_reply_unexpected" });
    }
  });
});
