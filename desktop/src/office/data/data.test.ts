import { describe, expect, it } from "vitest";
import { fakeSupabase, type FakeQuery } from "../../test-support/fake-supabase";
import type { OfficeSnapshot, Piles } from "../contract";
import { agentOf, diffOfficeSnapshots, loadOfficeSnapshot, TRANSITIONS_LIMIT } from "./index";

// Synthetic rows only.
const NOW = Date.parse("2026-09-27T18:00:00Z");

const all = (q: FakeQuery, name: string) => q.ops.filter(([op]) => op === name).map(([, args]) => args);
const has = (q: FakeQuery, name: string, ...args: unknown[]) => all(q, name).some((a) => JSON.stringify(a) === JSON.stringify(args));

const TRANSITIONS = [
  { position_legacy_id: 7, from_state: "new", to_state: "checked", ts: "2026-09-27T17:50:00Z", by_agent: "analista-1" },
  { position_legacy_id: 8, from_state: "checked", to_state: "new", ts: "2026-09-27T17:40:00Z", by_agent: "unstuck" },
  { position_legacy_id: 8, from_state: null, to_state: "new", ts: "2026-09-27T17:30:00Z", by_agent: "scout-2" },
  { position_legacy_id: 7, from_state: null, to_state: "new", ts: "2026-09-27T09:00:00Z", by_agent: "scout-1" },
];

/** The count each pile's head request answers, told apart by its filters. */
function pileCount(q: FakeQuery): number {
  if (has(q, "ilike", "applications.critic_verdict", "pass")) return 2;
  const status = all(q, "eq").find(([col]) => col === "status")?.[1];
  return ({ new: 11, checked: 5, scored: 4, review: 3, ready: 6 } as Record<string, number>)[String(status)] ?? -1;
}

function answer(heartbeat: string | null, running = true) {
  return (q: FakeQuery) => {
    if (q.table === "team_state")
      return { data: heartbeat === undefined ? null : { is_running: running, last_heartbeat_at: heartbeat }, error: null };
    if (q.table === "position_transitions") return { data: TRANSITIONS, error: null };
    if (q.table === "positions") {
      const [columns, options] = q.op("select") as [string, { head?: boolean } | undefined];
      if (options?.head) return { data: null, error: null, count: pileCount(q) };
      expect(columns).toBe("id, legacy_id, title, company");
      return { data: [{ id: "uuid-7", legacy_id: 7, title: "Ruolo sintetico", company: "Azienda finta" }], error: null };
    }
    return { data: null, error: { message: "unexpected " + q.table } };
  };
}

describe("loadOfficeSnapshot", () => {
  it("builds the roster from the last 24 h of transitions, plus the core roles of an online team", async () => {
    const { client, queries } = fakeSupabase(answer("2026-09-27T17:58:00Z"));
    const snap = await loadOfficeSnapshot(client, NOW);

    expect(snap.teamOnline).toBe(true);
    expect(snap.heartbeatAt).toBe("2026-09-27T17:58:00Z");
    // the agents page's role order, then the instance number; «unstuck» is not an agent
    expect(snap.roster.map((a) => a.uid)).toEqual(["capitano", "scout-1", "scout-2", "analista-1", "sentinella", "assistente", "mentor"]);
    expect(snap.roster.every((a) => a.sheet === "")).toBe(true);

    const t = queries.find((q) => q.table === "position_transitions")!;
    expect(has(t, "gte", "ts", "2026-09-26T18:00:00.000Z")).toBe(true);
    expect(has(t, "order", "ts", { ascending: false })).toBe(true);
    expect(has(t, "limit", TRANSITIONS_LIMIT)).toBe(true);

    // newest first, the position resolved by legacy_id as on the agents page
    expect(snap.transitions[0]).toEqual({
      ts: "2026-09-27T17:50:00Z",
      byAgent: "analista-1",
      from: "new",
      to: "checked",
      position: { id: "uuid-7", legacyId: 7, title: "Ruolo sintetico", company: "Azienda finta" },
    });
    expect(snap.transitions[2]!.position).toEqual({ id: null, legacyId: 8, title: null, company: null });
  });

  it("counts the piles as pipeline_queue_defs.gd, on the positions not deleted", async () => {
    const { client, queries } = fakeSupabase(answer("2026-09-27T17:58:00Z"));
    const snap = await loadOfficeSnapshot(client, NOW);
    // Scrittori = review 3 + ready 6 without the PASS (6 - 2); Critici = the 2 PASS
    expect(snap.piles).toEqual({ scout: 11, analisti: 5, scorer: 4, scrittori: 7, critici: 2 });

    const counts = queries.filter((q) => q.table === "positions" && (q.op("select") as unknown[])[1] !== undefined);
    expect(counts).toHaveLength(6);
    for (const q of counts) expect(has(q, "is", "deleted_at", null)).toBe(true);
    const scorer = counts.find((q) => has(q, "eq", "status", "scored"))!;
    expect(has(scorer, "eq", "write_requested", false)).toBe(true);
    const passed = counts.find((q) => has(q, "ilike", "applications.critic_verdict", "pass"))!;
    expect((passed.op("select") as unknown[])[0]).toBe("id, applications!inner(id)");
    expect(has(passed, "is", "applications.deleted_at", null)).toBe(true);
  });

  it("leaves the core roles out when the heartbeat is stale or the team stopped", async () => {
    for (const [beat, running] of [
      ["2026-09-27T17:50:00Z", true],
      ["2026-09-27T17:59:00Z", false],
    ] as const) {
      const { client } = fakeSupabase(answer(beat, running));
      const snap = await loadOfficeSnapshot(client, NOW);
      expect(snap.teamOnline).toBe(false);
      expect(snap.roster.map((a) => a.uid)).toEqual(["scout-1", "scout-2", "analista-1"]);
    }
  });

  it("says null when the team never wrote its state", async () => {
    const { client } = fakeSupabase((q) => (q.table === "team_state" ? { data: null, error: null } : answer(null)(q)));
    const snap = await loadOfficeSnapshot(client, NOW);
    expect(snap.teamOnline).toBeNull();
    expect(snap.heartbeatAt).toBeNull();
  });

  it("fails loudly on a cloud error instead of drawing an empty office", async () => {
    const { client } = fakeSupabase((q) => (q.table === "position_transitions" ? { data: null, error: { message: "boom" } } : answer(null)(q)));
    await expect(loadOfficeSnapshot(client, NOW)).rejects.toThrow("boom");
  });

  it("reads an agent from by_agent: role and instance, or nothing", () => {
    expect(agentOf("scout-2")).toEqual({ role: "scout", n: 2 });
    expect(agentOf("capitano")).toEqual({ role: "capitano", n: 1 });
    expect(agentOf("unstuck")).toBeNull();
    expect(agentOf("scout-0")).toBeNull();
    expect(agentOf("sentinella-worker")).toBeNull();
  });
});

const PILES: Piles = { scout: 11, analisti: 5, scorer: 4, scrittori: 7, critici: 2 };

function snap(over: Partial<OfficeSnapshot>): OfficeSnapshot {
  return { teamOnline: true, heartbeatAt: null, roster: [], piles: { ...PILES }, transitions: [], ...over };
}
const agent = (uid: string, role: "scout" | "analista" | "capitano") => ({ uid, role, sheet: "" });
const move = (ts: string, byAgent: string, to: string | null, legacyId = 1) => ({
  ts,
  byAgent,
  from: null,
  to,
  position: { id: null, legacyId, title: null, company: null },
});

describe("diffOfficeSnapshots", () => {
  it("seats everyone of the first snapshot at once and sets the piles, no trips", () => {
    const first = snap({ roster: [agent("capitano", "capitano"), agent("scout-1", "scout")], transitions: [move("2026-09-27T17:00:00Z", "scout-1", "new")] });
    expect(diffOfficeSnapshots(null, first)).toEqual([
      { type: "enter", agent: agent("capitano", "capitano"), atOnce: true },
      { type: "enter", agent: agent("scout-1", "scout"), atOnce: true },
      { type: "piles", piles: PILES },
    ]);
  });

  it("walks out who left, walks in who arrived, then the new transitions oldest first, then the piles", () => {
    const old = move("2026-09-27T17:00:00Z", "scout-1", "new", 1);
    const prev = snap({ roster: [agent("capitano", "capitano"), agent("scout-1", "scout")], transitions: [old] });
    const next = snap({
      roster: [agent("scout-1", "scout"), agent("analista-1", "analista")],
      piles: { ...PILES, scout: 10, analisti: 6 },
      transitions: [
        move("2026-09-27T17:10:00Z", "analista-1", "checked", 2),
        move("2026-09-27T17:05:00Z", "scout-1", "new", 3),
        move("2026-09-27T17:06:00Z", "unstuck", "new", 4),
        move("2026-09-27T17:07:00Z", "scout-1", null, 5),
        old,
      ],
    });
    expect(diffOfficeSnapshots(prev, next)).toEqual([
      { type: "leave", uid: "capitano" },
      { type: "enter", agent: agent("analista-1", "analista"), atOnce: false },
      { type: "pipeline", uid: "scout-1", toState: "new", position: next.transitions[1]!.position, ts: "2026-09-27T17:05:00Z" },
      { type: "pipeline", uid: "analista-1", toState: "checked", position: next.transitions[0]!.position, ts: "2026-09-27T17:10:00Z" },
      { type: "piles", piles: { ...PILES, scout: 10, analisti: 6 } },
    ]);
  });

  it("says nothing when nothing changed", () => {
    const s = snap({ roster: [agent("scout-1", "scout")], transitions: [move("2026-09-27T17:00:00Z", "scout-1", "new")] });
    expect(diffOfficeSnapshots(s, structuredClone(s))).toEqual([]);
  });

  it("does not replay a transition older than all the previous read saw", () => {
    const prev = snap({ roster: [agent("scout-1", "scout")], transitions: [move("2026-09-27T17:00:00Z", "scout-1", "new", 1)] });
    const next = snap({
      roster: [agent("scout-1", "scout")],
      transitions: [move("2026-09-27T17:00:00Z", "scout-1", "new", 1), move("2026-09-27T16:00:00Z", "scout-1", "new", 9)],
    });
    expect(diffOfficeSnapshots(prev, next)).toEqual([]);
  });
});
