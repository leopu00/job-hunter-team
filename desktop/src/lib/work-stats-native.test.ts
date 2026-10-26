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
  ...fields,
});

describe("pickWorkStats", () => {
  it("takes the closed shape, nulls included", () => {
    const picked = pickWorkStats(reply({ nights: [night({ aboveThreshold: null, scoreThreshold: null, consumptionPct: null })] }));
    expect(picked.ok).toBe(true);
    expect(pickWorkStats(reply({ nights: [], from: null, to: null, lastObservation: null, threshold: null })).ok).toBe(true);
  });

  it("refuses a field outside the list, a missing one, a value off its range or its type", () => {
    const off = [
      reply({ nights: [night({ note: "x" })] }),
      reply({ nights: [{ date: "2026-10-20" }] }),
      reply({ nights: [night({ found: -1 })] }),
      reply({ nights: [night({ hoursActive: 99 })] }),
      reply({ nights: [night({ found: "4" })] }),
      reply({ nights: [night({ date: "20/10/2026" })] }),
      reply({ nights: [night({ consumptionPct: Number.POSITIVE_INFINITY })] }),
      reply({ extra: 1 }),
      reply({ retentionDays: 0 }),
      reply({ lastObservation: "not a date" }),
      reply({ nights: Array.from({ length: 401 }, () => night()) }),
      { ok: true },
      null,
      "ok",
    ];
    for (const value of off) expect(pickWorkStats(value), JSON.stringify(value).slice(0, 80)).toEqual({ ok: false, error: "stats_unavailable" });
  });

  it("passes the team's own closed errors and turns any other word into «unavailable»", () => {
    expect(pickWorkStats({ ok: false, error: "stats_unreadable" })).toEqual({ ok: false, error: "stats_unreadable" });
    expect(pickWorkStats({ ok: false, error: "/home/x/secret" })).toEqual({ ok: false, error: "stats_unavailable" });
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
    expect(await readWorkStats(boom)).toEqual({ ok: false, error: "stats_unavailable" });
    expect(await clearWorkStats(boom)).toEqual({ ok: false, error: "stats_clear_failed" });
    expect(await clearWorkStats(async () => ({ ok: true, removed: 3 }))).toEqual({ ok: false, error: "stats_clear_failed" });
    expect(await clearWorkStats(async () => ({ ok: false, error: "stats_clear_failed" }))).toEqual({ ok: false, error: "stats_clear_failed" });
  });
});
