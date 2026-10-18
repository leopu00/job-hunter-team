import { describe, expect, it } from "vitest";
import { fakeSupabase } from "../test-support/fake-supabase";
import { loadAgentStatuses, parseAgentStatuses, STATUS_STALE_MS, stateOf, tagOf } from "./status";

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

describe("the state a box publishes next to the old status", () => {
  const UNTIL = new Date(Date.parse(AT) + 3_600_000).toISOString();
  const read = (entry: object) =>
    parseAgentStatuses({ agents_status: { tui: { at: AT, agents: { capitano: { status: "paused", since: AT, ...entry } } } } }, NOW)?.agents.capitano;

  it("reads state, reason, since and until when they are there", () => {
    expect(read({ state: "bloccato", reason: "limite_5h", until: UNTIL })).toEqual({
      status: "paused",
      state: "bloccato",
      reason: "limite_5h",
      since: Date.parse(AT),
      until: Date.parse(UNTIL),
    });
  });

  it("an older box has only the old keys and gets nothing new", () => {
    expect(read({})).toEqual({ status: "paused" });
  });

  it("a state word this desktop does not know drops the new keys and keeps the old status", () => {
    expect(read({ state: "dormiente", reason: "limite_5h", until: UNTIL })).toEqual({ status: "paused" });
  });

  it("a reason the catalog has no sentence for is not shown", () => {
    expect(read({ state: "bloccato", reason: "colpa_del_gatto" })?.reason).toBeUndefined();
  });

  it("an unreadable date is left out, not turned into a time", () => {
    const a = read({ state: "bloccato", reason: "limite_5h", until: "domani" });
    expect(a?.until).toBeUndefined();
  });

  it("stateOf: the box's state first; a throttle of an older box is a block for pacing; nothing else is guessed", () => {
    expect(stateOf({ status: "idle", state: "avviato_mai_partito" })).toMatchObject({ state: "avviato_mai_partito" });
    expect(stateOf({ status: "throttled", throttleUntil: 5 })).toEqual({ state: "bloccato", reason: "pausa_pacing", until: 5 });
    expect(stateOf({ status: "idle" })).toBeNull();
    expect(stateOf({ status: "working" })).toBeNull();
  });
});

describe("the tag of a published state", () => {
  it("one label and colour per state: green work, amber blocked, blue waits for the person, grey the rest", () => {
    expect(tagOf({ status: "working", state: "lavora" })).toEqual({ label: "WORKING", color: 0x58e68b });
    expect(tagOf({ status: "paused", state: "bloccato", reason: "limite_5h" })).toEqual({ label: "BLOCKED", color: 0xf5c518 });
    expect(tagOf({ status: "idle", state: "aspetta_umano" })).toEqual({ label: "WAITING FOR YOU", color: 0x5aa0ff });
    expect(tagOf({ status: "idle", state: "avviato_mai_partito" }).label).toBe("NEVER STARTED");
    expect(tagOf({ status: "idle", state: "sconosciuto", reason: "turno_silenzioso" }).label).toBe("UNKNOWN");
    expect(tagOf({ status: "idle", state: "idle" }).label).toBe("IDLE");
    expect(tagOf({ status: "idle", state: "spento" }).label).toBe("OFF");
  });

  it("a pacing block still counts down", () => {
    expect(tagOf({ status: "throttled", state: "bloccato", reason: "pausa_pacing", until: NOW + 95_000 }, NOW).label).toBe("THROTTLED  1:35");
  });

  it("never-started and unknown are grey, and never the colour of work or of a wait", () => {
    const grey = tagOf({ status: "idle", state: "avviato_mai_partito" }).color;
    expect(grey).toBe(tagOf({ status: "idle", state: "sconosciuto" }).color);
    for (const other of [0x58e68b, 0x7a7a96, 0xf5c518, 0xff7a65, 0x5aa0ff]) expect(grey).not.toBe(other);
  });

  it("a status this file does not know is UNKNOWN, never WAITING", () => {
    const t = tagOf({ status: "sleeping" as never });
    expect(t.label).toBe("UNKNOWN");
    expect(t.color).not.toBe(0x7a7a96);
  });
});

