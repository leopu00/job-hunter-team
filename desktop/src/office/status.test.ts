import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../test-support/fake-supabase";
import { loadAgentStatuses, parseAgentStatuses, STATUS_STALE_MS, tagOf } from "./status";

const AT = "2026-09-27T20:00:00Z";
const NOW = Date.parse(AT) + 30_000;

describe("the agents' statuses from team_state (migration 089)", () => {
  it("reads the published map, keyed by uid", () => {
    const s = parseAgentStatuses(
      {
        agents_status: {
          capitano: { status: "working", since: AT, source: "tui" },
          "SCOUT-1": { status: "idle", since: AT, source: "tui" },
          "scorer-2": { status: "throttled", since: AT, source: "tui", throttle_left_s: 95 },
        },
        agents_status_at: AT,
      },
      NOW,
    );
    expect(s?.agents.capitano).toEqual({ status: "working" });
    expect(s?.agents["scout-1"]).toEqual({ status: "idle" });
    expect(s?.agents["scorer-2"].throttleUntil).toBe(Date.parse(AT) + 95_000);
  });

  it("an old map, a missing stamp or a non-object is no status at all", () => {
    const agents_status = { capitano: { status: "working" } };
    expect(parseAgentStatuses({ agents_status, agents_status_at: AT }, Date.parse(AT) + STATUS_STALE_MS + 1)).toBeNull();
    expect(parseAgentStatuses({ agents_status }, NOW)).toBeNull();
    expect(parseAgentStatuses({ agents_status: [1], agents_status_at: AT }, NOW)).toBeNull();
  });

  it("an unknown status word is left out, never shown as something else", () => {
    const s = parseAgentStatuses({ agents_status: { a: { status: "sleeping" }, b: { status: "paused" } }, agents_status_at: AT }, NOW);
    expect(Object.keys(s!.agents)).toEqual(["b"]);
  });

  it("a query refused (columns not on the cloud yet) costs the tags only", async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: { message: 'column team_state.agents_status does not exist' } }));
    expect(await loadAgentStatuses(client, NOW)).toBeNull();
    const ok = fakeSupabase(() => ({ data: { agents_status: { a: { status: "working" } }, agents_status_at: AT }, error: null }));
    expect((await loadAgentStatuses(ok.client, NOW))?.agents.a.status).toBe("working");
  });

  it("reads the user's own row, and nothing without a session", async () => {
    const ok = fakeSupabase(() => ({ data: { agents_status: {}, agents_status_at: AT }, error: null }), "user-a");
    await loadAgentStatuses(ok.client, NOW);
    expect(ok.queries[0].op("eq")).toEqual(["user_id", "user-a"]);
    const none = fakeSupabase(() => ({ data: { agents_status: {}, agents_status_at: AT }, error: null }), null);
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
});
