import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../test-support/fake-supabase";
import { loadAgentStatuses, parseAgentStatuses, STATUS_STALE_MS, tagOf } from "./status";

const AT = "2026-09-27T20:00:00Z";
const NOW = Date.parse(AT) + 30_000;

describe("the agents' statuses from team_state (migration 089)", () => {
  const OLD = new Date(Date.parse(AT) - STATUS_STALE_MS - 1).toISOString();

  it("reads every source's map, keyed by uid", () => {
    const s = parseAgentStatuses(
      {
        agents_status: {
          tui: {
            at: AT,
            agents: {
              capitano: { status: "working", since: AT },
              "SCOUT-1": { status: "idle", since: AT },
              "scorer-2": { status: "throttled", since: AT, throttle_left_s: 95 },
            },
          },
          api: { at: AT, agents: { "analista-1": { status: "throttled", since: AT } } },
        },
      },
      NOW,
    );
    expect(s?.agents.capitano).toEqual({ status: "working" });
    expect(s?.agents["scout-1"]).toEqual({ status: "idle" });
    expect(s?.agents["scorer-2"].throttleUntil).toBe(Date.parse(AT) + 95_000);
    expect(s?.agents["analista-1"]).toEqual({ status: "throttled" });
    expect(s?.at).toBe(Date.parse(AT));
  });

  it("an old source, a missing stamp or a non-object gives no status from it", () => {
    const agents = { capitano: { status: "working" } };
    expect(parseAgentStatuses({ agents_status: { tui: { at: OLD, agents } } }, NOW)).toBeNull();
    expect(parseAgentStatuses({ agents_status: { tui: { agents } } }, NOW)).toBeNull();
    expect(parseAgentStatuses({ agents_status: [1] }, NOW)).toBeNull();
    // the old one goes, the fresh one stays
    const s = parseAgentStatuses({ agents_status: { tui: { at: OLD, agents }, api: { at: AT, agents: { "scout-1": { status: "idle" } } } } }, NOW);
    expect(s?.agents).toEqual({ "scout-1": { status: "idle" } });
  });

  it("an agent in two fresh sources takes the newer", () => {
    const later = new Date(Date.parse(AT) + 10_000).toISOString();
    const s = parseAgentStatuses(
      { agents_status: { api: { at: later, agents: { "scout-1": { status: "working" } } }, tui: { at: AT, agents: { "scout-1": { status: "idle" } } } } },
      NOW,
    );
    expect(s?.agents["scout-1"]).toEqual({ status: "working" });
  });

  it("an unknown status word is left out, never shown as something else", () => {
    const s = parseAgentStatuses({ agents_status: { tui: { at: AT, agents: { a: { status: "sleeping" }, b: { status: "paused" } } } } }, NOW);
    expect(Object.keys(s!.agents)).toEqual(["b"]);
  });

  it("a query refused (column not on the cloud yet) costs the tags only", async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: "column team_state.agents_status does not exist" } }));
    expect(await loadAgentStatuses(client, NOW)).toBeNull();
    const ok = fakeSupabase(() => ({ data: { agents_status: { tui: { at: AT, agents: { a: { status: "working" } } } } }, error: null }));
    expect((await loadAgentStatuses(ok.client, NOW))?.agents.a.status).toBe("working");
  });

  it("reads the user's own row, and nothing without a session", async () => {
    const ok = fakeSupabase(() => ({ data: { agents_status: {} }, error: null }), "user-a");
    await loadAgentStatuses(ok.client, NOW);
    expect(ok.queries[0].op("eq")).toEqual(["user_id", "user-a"]);
    const none = fakeSupabase(() => ({ data: { agents_status: {} }, error: null }), null);
    expect(await loadAgentStatuses(none.client, NOW)).toBeNull();
    expect(none.queries).toHaveLength(0);
  });
});

describe("the tag (AgentStateTag._label/_color)", () => {
  it("names and colours the statuses as the game, idle as WAITING", () => {
    expect(tagOf({ status: "working" })).toEqual({ label: "WORKING", color: 0x58e68b });
    expect(tagOf({ status: "idle" })).toEqual({ label: "WAITING", color: 0x7a7a96 });
    expect(tagOf({ status: "paused" })).toEqual({ label: "PAUSED", color: 0xff7a65 });
  });

  it("a throttle counts down to 0:00", () => {
    expect(tagOf({ status: "throttled", throttleUntil: NOW + 95_000 }, NOW).label).toBe("THROTTLED  1:35");
    expect(tagOf({ status: "throttled", throttleUntil: NOW - 5_000 }, NOW).label).toBe("THROTTLED  0:00");
  });

  it("a throttle of unknown length has no clock", () => {
    expect(tagOf({ status: "throttled" }, NOW)).toEqual({ label: "THROTTLED", color: 0xf5c518 });
  });
});
