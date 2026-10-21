import { describe, expect, it, vi } from "vitest";
import { BACKLOG_MS } from "./fresh";
import { BATCH_MS, stopsTheWatch, VPS_EVERY_MS, VPS_MAX_EVERY_MS, watchCloudPositions, watchVpsPositions } from "./watch";

const START = Date.parse("2026-10-19T12:00:00Z");
const pos = (id: string, foundAtMs = START + 1000) => ({ id, title: "Dev", company: "Acme", found_at: new Date(foundAtMs).toISOString() });

/** A timer the test advances by hand: the waits the watch asks for, in order. */
function manualTimer() {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  return {
    waits: [] as number[],
    set(fn: () => void, ms: number) {
      this.waits.push(ms);
      queue.push({ fn, ms });
      return queue.length;
    },
    clear: vi.fn(),
    async fire() {
      const next = queue.shift();
      next?.fn();
      await new Promise((r) => setTimeout(r, 0));
    },
    pending: () => queue.length,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the VPS watch", () => {
  it("reads every 5 minutes, says nothing on the first read, then only what is new", async () => {
    const reads = [[pos("1"), pos("2")], [pos("3"), pos("1"), pos("2")], [pos("3")]];
    const read = vi.fn(async () => ({ source: "vps" as const, data: (reads.shift() ?? []) as never }));
    const onNew = vi.fn();
    const timer = manualTimer();
    const stop = watchVpsPositions({ read, onNew, now: () => START, timer });
    await flush();
    expect(onNew).not.toHaveBeenCalled();
    await timer.fire();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew.mock.calls[0]![0].map((r: { id: string }) => r.id)).toEqual(["3"]);
    await timer.fire();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(timer.waits.every((w) => w === VPS_EVERY_MS)).toBe(true);
    stop();
    expect(timer.clear).toHaveBeenCalled();
  });

  it("waits longer after each error, up to an hour, and back to 5 minutes after a good read", async () => {
    const results: Array<{ source: "unavailable"; code: string } | { source: "vps"; data: never }> = [
      { source: "unavailable", code: "ssh_unavailable" },
      { source: "unavailable", code: "ssh_unavailable" },
      ...Array.from({ length: 6 }, () => ({ source: "unavailable" as const, code: "desktop_transport_unavailable" })),
      { source: "vps", data: [] as never },
    ];
    const read = vi.fn(async () => results.shift()!);
    const timer = manualTimer();
    watchVpsPositions({ read, onNew: vi.fn(), now: () => START, timer });
    await flush();
    for (let i = 0; i < 8; i++) await timer.fire();
    expect(timer.waits.slice(0, 8)).toEqual([10, 20, 40, 60, 60, 60, 60, 60].map((m) => Math.min(m * 60_000, VPS_MAX_EVERY_MS)));
    expect(timer.waits.at(-1)).toBe(VPS_EVERY_MS);
  });

  it("stops for good on an error about the connection's identity or keys: no retry, no reconnection behind the person's back", async () => {
    for (const code of ["host_key_changed", "host_key_mismatch", "ssh_host_key_invalid", "ssh_auth_failed", "existing_team_target_changed"]) {
      const read = vi.fn(async () => ({ source: "unavailable" as const, code }));
      const timer = manualTimer();
      watchVpsPositions({ read, onNew: vi.fn(), now: () => START, timer });
      await flush();
      expect(read, code).toHaveBeenCalledTimes(1);
      expect(timer.pending(), code).toBe(0);
    }
    expect(stopsTheWatch("ssh_unavailable")).toBe(false);
  });
});

/** A cloud client that records what the watch asks of it. */
function fakeClient(session: { user: { id: string }; access_token: string } | null) {
  const handlers: Array<(payload: { new: unknown }) => void> = [];
  const filters: unknown[] = [];
  const channel = {
    on: vi.fn((_kind: unknown, filter: unknown, cb: (payload: { new: unknown }) => void) => {
      filters.push(filter);
      handlers.push(cb);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return {
    handlers,
    filters,
    client: {
      auth: { getSession: vi.fn(async () => ({ data: { session } })) },
      realtime: { setAuth: vi.fn(async () => {}) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    },
  };
}

describe("the cloud watch", () => {
  it("listens with the person's own session, to their own positions only", async () => {
    const f = fakeClient({ user: { id: "u-1" }, access_token: "token-of-the-session" });
    const stop = watchCloudPositions({ client: f.client as never, onNew: vi.fn(), now: () => START, timer: manualTimer() });
    await flush();
    expect(f.client.realtime.setAuth).toHaveBeenCalledWith("token-of-the-session");
    expect(f.filters).toEqual([{ event: "INSERT", schema: "public", table: "positions", filter: "user_id=eq.u-1" }]);
    stop();
    expect(f.client.removeChannel).toHaveBeenCalled();
  });

  it("without a session it opens nothing", async () => {
    const f = fakeClient(null);
    watchCloudPositions({ client: f.client as never, onNew: vi.fn(), now: () => START, timer: manualTimer() });
    await flush();
    expect(f.client.channel).not.toHaveBeenCalled();
  });

  it("tells inserts close together in one go, and rows found long ago (a sync catching up) not at all", async () => {
    const f = fakeClient({ user: { id: "u-1" }, access_token: "t" });
    const onNew = vi.fn();
    const timer = manualTimer();
    watchCloudPositions({ client: f.client as never, onNew, now: () => START, timer });
    await flush();
    const insert = f.handlers[0]!;
    for (let i = 0; i < 300; i++) insert({ new: pos(`old-${i}`, START - BACKLOG_MS - 60_000) });
    expect(timer.pending()).toBe(0);
    insert({ new: pos("a") });
    insert({ new: pos("b") });
    insert({ new: pos("a") });
    expect(timer.waits).toEqual([BATCH_MS]);
    await timer.fire();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew.mock.calls[0]![0].map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });
});
