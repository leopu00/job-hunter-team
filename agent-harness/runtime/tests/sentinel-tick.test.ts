/**
 * T37-3: the tick the harness composes, against the skills that read it.
 *
 * The numbers are the runtime's (the ledger and the window's budget); the
 * arithmetic is `decision-throttle`'s and S-05's, and this file holds it to
 * those tables rather than to itself. What is checked: the ideal pace, the
 * proj→state bands at their boundaries, the ladder from proj to seconds, the
 * reset edge where the projection stops being actionable, each agent's share,
 * and the line that carries all of it in the bridge's own words — including
 * what is missing from it, which the prompt says to report rather than read
 * as calm.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendLedger, LEDGER_HEADER } from "../src/core/ledger.ts";

import { computeTick, readLedgerSpend, renderTick, suggestedThrottle, tickFromLedger, tickStatus, type SpendRow, type TickInput } from "../src/parity/sentinel-tick.ts";

const START = new Date("2026-09-21T09:00:00Z");
const END = new Date("2026-09-21T14:00:00Z");

const input = (over: Partial<TickInput> = {}): TickInput => ({
  now: new Date("2026-09-21T11:00:00Z"),
  windowStart: START,
  windowEnd: END,
  budgetUsd: 1,
  spend: [],
  ...over,
});

const rows = (...pairs: [string, number][]): SpendRow[] =>
  pairs.map(([agent, usd], i) => ({ agent, usd, at: new Date(START.getTime() + i * 60_000) }));

describe("the numbers the tick carries", () => {
  it("spends two of five hours: usage, velocity, the ideal pace and where it lands", () => {
    const tick = computeTick(input({ spend: rows(["scout-1", 0.2]) }));
    // 0.20 of 1.00 in 2h of a 5h window: 10%/h, three hours left.
    expect(tick.usage).toBe(20);
    expect(tick.vel).toBe(10);
    // (92 - 20) / 3 = 24%/h would land on the target; we are well under it.
    expect(tick.ideal).toBe(24);
    expect(tick.proj).toBe(50);
    expect(tick.status).toBe("SOTTOUTILIZZO");
    expect(tick.suggestedThrottleS).toBe(0);
    expect(tick.phase).toBe(1);
  });

  it("a window that has just opened has no velocity: a few seconds are not a catastrophe", () => {
    const tick = computeTick(input({ now: new Date("2026-09-21T09:00:20Z"), spend: rows(["scout-1", 0.05]) }));
    expect(tick.vel).toBe(0);
    expect(tick.proj).toBe(5);
    // S-04's lesson: EMERGENZA on five windows out of five came from reading a
    // spike at the start of a window as the rate of the whole window.
    expect(tick.status).toBe("SOTTOUTILIZZO");
  });

  it("the very first tick of a window is OK, whatever the projection says", () => {
    expect(computeTick(input()).status).toBe("OK");
    expect(tickStatus(400, true)).toBe("OK");
    expect(tickStatus(400, false)).toBe("CRITICO");
  });

  it("the proj bands, at their edges (decision-throttle)", () => {
    expect(tickStatus(100.1, false)).toBe("CRITICO");
    expect(tickStatus(100, false)).toBe("ATTENZIONE");
    expect(tickStatus(95, false)).toBe("ATTENZIONE");
    expect(tickStatus(94.9, false)).toBe("STEADY");
    expect(tickStatus(90, false)).toBe("STEADY");
    expect(tickStatus(89.9, false)).toBe("SOTTOUTILIZZO");
  });

  it("the S-05 ladder, and the freeze past 200", () => {
    expect(suggestedThrottle(94, false)).toBe(0);
    expect(suggestedThrottle(96, false)).toBe(60);
    expect(suggestedThrottle(105, false)).toBe(120);
    expect(suggestedThrottle(120, false)).toBe(240);
    expect(suggestedThrottle(140, false)).toBe(360);
    expect(suggestedThrottle(199, false)).toBe(600);
    expect(suggestedThrottle(201, false)).toBe(-1);
    // The last half hour: the projection is diagnostic only, so nothing brakes on it.
    expect(suggestedThrottle(400, true)).toBe(0);
  });

  it("the reset edge turns the phase to 3 and holds the brake", () => {
    const tick = computeTick(input({ now: new Date("2026-09-21T13:45:00Z"), spend: rows(["scout-1", 0.9]) }));
    expect(tick.resetEdgeGuard).toBe(true);
    expect(tick.phase).toBe(3);
    expect(tick.suggestedThrottleS).toBe(0);
    // The number is still there to read: diagnostic, not silent.
    expect(tick.proj).toBeGreaterThan(90);
  });

  it("over the projection, out of the edge: phase 2 and a number to act on", () => {
    const tick = computeTick(input({ spend: rows(["scout-1", 0.5]) }));
    expect(tick.proj).toBe(125);
    expect(tick.phase).toBe(2);
    expect(tick.status).toBe("CRITICO");
    expect(tick.suggestedThrottleS).toBe(240);
  });

  it("who is burning: the share, largest first, and each one's own pace", () => {
    const tick = computeTick(input({ spend: rows(["scout-1", 0.2], ["analista-1", 0.05], ["scout-1", 0.05], ["dottore-1", 0.1]) }));
    expect(tick.shares).toEqual([
      { agent: "scout-1", usd: 0.25, share: 62.5, velPctH: 12.5 },
      { agent: "dottore-1", usd: 0.1, share: 25, velPctH: 5 },
      { agent: "analista-1", usd: 0.05, share: 12.5, velPctH: 2.5 },
    ]);
  });

  it("a target the window was given replaces the historical 92", () => {
    const base = input({ spend: rows(["scout-1", 0.2]) });
    expect(computeTick(base).ideal).toBe(24);
    expect(computeTick({ ...base, target: 50 }).ideal).toBe(10);
  });

  it("an empty window answers zeros instead of dividing by nothing", () => {
    const tick = computeTick(input({ budgetUsd: 0 }));
    expect([tick.usage, tick.vel, tick.proj]).toEqual([0, 0, 0]);
    expect(tick.shares).toEqual([]);
  });
});

describe("the line the role reads", () => {
  it("is the bridge's own, and says where the numbers came from", () => {
    const given = input({ spend: rows(["scout-1", 0.5], ["analista-1", 0.1]) });
    const text = renderTick(computeTick(given), given);
    expect(text.split("\n")[0]).toBe(
      "[BRIDGE TICK] ts=11:00:00 usage=60% proj=150% status=CRITICO reset=14:00 target=92% phase=2 " +
        "vel=30%/h ideal=10.7%/h suggested_throttle_s=600 reset_edge_guard=false src=harness.",
    );
    expect(text).toContain("[BRIDGE PACING] 11:00 UTC agenti: scout-1=25%/h share 83.3% analista-1=5%/h share 16.7%");
  });

  it("names what no bridge here computes, so its absence is not read as calm", () => {
    const given = input({ spend: rows(["scout-1", 0.1]) });
    const text = renderTick(computeTick(given), given);
    for (const field of ["weekly", "daily", "cadenza", "burst_transient", "debt"]) expect(text).toContain(field);
    expect(text).toMatch(/riferiscilo invece di leggerne l'assenza come calma/);
  });

  it("says plainly when nobody has spent yet", () => {
    const given = input();
    expect(renderTick(computeTick(given), given)).toContain("agenti: nessuno ha speso in questa finestra");
  });
});

describe("the window read off the team's ledger", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "jht-tick-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const ledger = () => join(root, "spesa.tsv");
  const entry = (role: string, usd: number, at: string) =>
    appendLedger(ledger(), {
      at: new Date(at),
      role,
      model: "anthropic/claude-sonnet-5",
      usage: { inputTokens: 1000, outputTokens: 100 },
      costUsd: usd,
      runId: `run-${role}-${at}`,
      note: "completed",
    });

  it("takes the rows of the window and leaves the others where they are", () => {
    entry("scout", 0.1, "2026-09-21T08:30:00Z"); // before the window
    entry("scout", 0.2, "2026-09-21T09:30:00Z");
    entry("analista", 0.05, "2026-09-21T10:30:00Z");
    entry("scout", 0.3, "2026-09-21T13:00:00Z"); // after `now`
    const rows = readLedgerSpend(ledger(), START, new Date("2026-09-21T11:00:00Z"));
    expect(rows.map((r) => [r.agent, r.usd])).toEqual([
      ["scout", 0.2],
      ["analista", 0.05],
    ]);
  });

  it("a ledger it cannot read is an empty window, never a guess", () => {
    expect(readLedgerSpend(join(root, "nothing.tsv"), START, END)).toEqual([]);
    // The header, a half-written line and a hand edit: counted out, not thrown on.
    writeFileSync(ledger(), `${LEDGER_HEADER.join("\t")}\n2026-09-21T09:30:00.000Z\tscout\tm\t1\t0\t1\tnot-a-number\trun\tnote\nbroken line\n`);
    expect(readLedgerSpend(ledger(), START, END)).toEqual([]);
  });

  it("composes the line a run would hand the role", () => {
    entry("scout", 0.5, "2026-09-21T09:30:00Z");
    entry("analista", 0.1, "2026-09-21T10:30:00Z");
    const text = tickFromLedger({
      ledger: ledger(),
      now: new Date("2026-09-21T11:00:00Z"),
      windowStart: START,
      windowEnd: END,
      budgetUsd: 1,
    });
    expect(text).toContain("usage=60% proj=150% status=CRITICO");
    expect(text).toContain("agenti: scout=25%/h share 83.3% analista=5%/h share 16.7%");
  });
});
