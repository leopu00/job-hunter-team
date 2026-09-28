import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeEvent, OfficeSnapshot } from "./contract";
import { diffOfficeSnapshots } from "./data/diff";
import { createLiveOffice, createReadScheduler, READ_GAP_MS, subscribeOffice, transitionFromRow } from "./live";

describe("the reads: at most one a minute, and one a minute when the channel is down (D09)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const timers = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as never) };
  const scheduler = () => {
    const read = vi.fn(async () => {});
    return { read, s: createReadScheduler(read, { timers }) };
  };

  it("reads at once, then with the channel not up (never came, or fell) once a minute", async () => {
    const { read, s } = scheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * READ_GAP_MS + 10);
    expect(read).toHaveBeenCalledTimes(4);
    s.stop();
  });

  it("with the channel up, only a change asks for a read; many changes in a minute make one read", async () => {
    const { read, s } = scheduler();
    await vi.advanceTimersByTimeAsync(0);
    s.setChannel(true);
    await vi.advanceTimersByTimeAsync(READ_GAP_MS); // the catch-up read at the gap
    expect(read).toHaveBeenCalledTimes(2);
    // ten changes right after a read: one read, when the minute is up
    for (let i = 0; i < 10; i++) {
      s.poke();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(READ_GAP_MS);
    expect(read).toHaveBeenCalledTimes(3);
    // and no change, no read
    await vi.advanceTimersByTimeAsync(5 * READ_GAP_MS);
    expect(read).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it("the channel falls: back to a read a minute; never two reads closer than the gap", async () => {
    const { read, s } = scheduler();
    await vi.advanceTimersByTimeAsync(0);
    s.setChannel(true);
    await vi.advanceTimersByTimeAsync(READ_GAP_MS);
    const starts: number[] = [];
    read.mockImplementation(async () => void starts.push(Date.now()));
    s.setChannel(false);
    s.poke();
    await vi.advanceTimersByTimeAsync(4 * READ_GAP_MS);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(READ_GAP_MS);
    s.stop();
  });

  it("a change during a read makes one more read after it, not two at once", async () => {
    let finish: () => void = () => {};
    const read = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const s = createReadScheduler(read, { timers });
    s.setChannel(true);
    await vi.advanceTimersByTimeAsync(0);
    s.poke();
    s.poke();
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(READ_GAP_MS);
    expect(read).toHaveBeenCalledTimes(2);
    s.stop();
  });
});

const T0 = "2026-09-28T01:00:00.000Z";
const agent = (uid: string) => ({ uid, role: "scorer" as const, sheet: "" });
const tr = (ts: string, byAgent: string, legacyId: number, to = "scored") => ({
  ts,
  byAgent,
  from: "checked",
  to,
  position: { id: null, legacyId, title: null, company: null },
});
const snap = (transitions: OfficeSnapshot["transitions"], roster = [agent("scorer-1")]): OfficeSnapshot => ({
  teamOnline: true,
  heartbeatAt: T0,
  roster,
  piles: { scout: 1, analisti: 2, scorer: 3, scrittori: 0, critici: 0 },
  transitions,
});
const trips = (events: OfficeEvent[]) => events.filter((e) => e.type === "pipeline");

describe("real moves become trips, once (D09)", () => {
  it("the first load moves nobody: the transitions already there are the past", () => {
    const events: OfficeEvent[] = [];
    const live = createLiveOffice(diffOfficeSnapshots, (e) => events.push(e));
    live.snapshot(snap([tr("2026-09-28T00:59:00Z", "scorer-1", 7), tr("2026-09-28T00:58:00Z", "scorer-1", 6)]));
    expect(trips(events)).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["enter", "piles"]);
  });

  it("a transition on the channel is one trip now, and the read that brings it again adds none", () => {
    const events: OfficeEvent[] = [];
    const live = createLiveOffice(diffOfficeSnapshots, (e) => events.push(e));
    live.snapshot(snap([tr("2026-09-28T00:59:00Z", "scorer-1", 6)]));
    // Realtime writes timestamptz its own way
    const fromChannel = transitionFromRow({ ts: "2026-09-28 01:00:05.123+00", by_agent: "scorer-1", from_state: "checked", to_state: "scored", position_legacy_id: 7 })!;
    live.transition(fromChannel);
    live.transition(fromChannel);
    expect(trips(events)).toHaveLength(1);
    // PostgREST writes it another way
    live.snapshot(snap([tr("2026-09-28T01:00:05.123+00:00", "scorer-1", 7), tr("2026-09-28T00:59:00Z", "scorer-1", 6)]));
    expect(trips(events)).toHaveLength(1);
  });

  it("a new transition seen only by a read is one trip", () => {
    const events: OfficeEvent[] = [];
    const live = createLiveOffice(diffOfficeSnapshots, (e) => events.push(e));
    live.snapshot(snap([tr("2026-09-28T00:59:00Z", "scorer-1", 6)]));
    live.snapshot(snap([tr("2026-09-28T01:00:05Z", "scorer-1", 7), tr("2026-09-28T00:59:00Z", "scorer-1", 6)]));
    expect(trips(events)).toEqual([expect.objectContaining({ uid: "scorer-1", toState: "scored" })]);
  });

  it("before the first read, or by an agent not in the office, a channel transition waits for the read", () => {
    const events: OfficeEvent[] = [];
    const live = createLiveOffice(diffOfficeSnapshots, (e) => events.push(e));
    live.transition(tr("2026-09-28T01:00:00Z", "scorer-1", 7));
    live.snapshot(snap([]));
    live.transition(tr("2026-09-28T01:00:01Z", "scout-9", 8));
    expect(trips(events)).toEqual([]);
  });
});

describe("transitionFromRow", () => {
  it("reads a Realtime row, and refuses what is not one", () => {
    expect(transitionFromRow({ ts: "2026-09-28T01:00:00Z", by_agent: "scout-1", from_state: null, to_state: "new", position_legacy_id: 3 })).toEqual({
      ts: "2026-09-28T01:00:00.000Z",
      byAgent: "scout-1",
      from: null,
      to: "new",
      position: { id: null, legacyId: 3, title: null, company: null },
    });
    expect(transitionFromRow({ ts: "x" })).toBeNull();
    expect(transitionFromRow(null)).toBeNull();
  });
});

describe("the channel", () => {
  function fakeClient(session: unknown) {
    const ons: Array<{ filter: Record<string, string>; cb: (p: { new: unknown }) => void }> = [];
    let statusCb: (s: string) => void = () => {};
    const channel = {
      on: vi.fn((_: string, filter: Record<string, string>, cb: (p: { new: unknown }) => void) => {
        ons.push({ filter, cb });
        return channel;
      }),
      subscribe: vi.fn((cb: (s: string) => void) => {
        statusCb = cb;
        return channel;
      }),
    };
    const client = {
      auth: { getSession: async () => ({ data: { session } }) },
      realtime: { setAuth: vi.fn(async () => {}) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    };
    return { client, ons, status: (s: string) => statusCb(s) };
  }
  const session = { access_token: "jwt", user: { id: "user-a" } };

  it("listens to positions, team_state and the new transitions, the user's rows only", async () => {
    const { client, ons, status } = fakeClient(session);
    const h = { onChange: vi.fn(), onTransition: vi.fn(), onStatus: vi.fn() };
    const stop = subscribeOffice(client as never, h);
    await vi.waitFor(() => expect(ons).toHaveLength(3));
    expect(ons.map((o) => [o.filter.table, o.filter.event, o.filter.filter])).toEqual([
      ["positions", "*", "user_id=eq.user-a"],
      ["team_state", "*", "user_id=eq.user-a"],
      ["position_transitions", "INSERT", "user_id=eq.user-a"],
    ]);
    status("SUBSCRIBED");
    expect(h.onStatus).toHaveBeenLastCalledWith(true);
    ons[2]!.cb({ new: { ts: "2026-09-28T01:00:00Z", by_agent: "scout-1", to_state: "new", position_legacy_id: 1 } });
    expect(h.onTransition).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    status("CHANNEL_ERROR");
    expect(h.onStatus).toHaveBeenLastCalledWith(false);
    stop();
    expect(client.removeChannel).toHaveBeenCalled();
  });

  it("without a session there is no channel: the reads fall back to the minute", async () => {
    const { client } = fakeClient(null);
    const onStatus = vi.fn();
    subscribeOffice(client as never, { onChange: vi.fn(), onTransition: vi.fn(), onStatus });
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(false));
    expect(client.channel).not.toHaveBeenCalled();
  });
});
