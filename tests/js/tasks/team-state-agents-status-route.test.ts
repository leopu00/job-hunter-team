/** Migration 089 — a paired box writes its agents' statuses through PATCH /api/team-state. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTS_STATUS_MAX_AGENTS, sanitizeAgentsStatus } from "@/lib/team-state/agents-status";

const mocks = vi.hoisted(() => ({ resolveUser: vi.fn() }));

vi.mock("@/lib/team-state/auth", () => ({ resolveUser: mocks.resolveUser }));

const SINCE = "2026-09-27T21:00:00.000Z";

function request(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) } as never;
}

describe("sanitizeAgentsStatus", () => {
  it("keeps the shape the producers write, for the tui and the api", () => {
    const value = {
      tui: { agents: { capitano: { status: "working", since: SINCE }, "scorer-2": { status: "throttled", since: SINCE, throttle_left_s: 89.6 } } },
      api: { agents: { "scout-1": { status: "idle", since: SINCE } } },
    };
    expect(sanitizeAgentsStatus(value)).toEqual({
      ok: true,
      value: {
        tui: { agents: { capitano: { status: "working", since: SINCE }, "scorer-2": { status: "throttled", since: SINCE, throttle_left_s: 90 } } },
        api: { agents: { "scout-1": { status: "idle", since: SINCE } } },
      },
    });
  });

  it("an agent with a name outside [a-z0-9-] is left out, the others are kept", () => {
    const agent = { status: "idle", since: SINCE };
    expect(sanitizeAgentsStatus({ tui: { agents: { "Scout 1": agent, test_session: agent, "scout-3": agent } } })).toEqual({
      ok: true,
      value: { tui: { agents: { "scout-3": agent } } },
    });
  });

  it("refuses what is not that shape", () => {
    const agent = { status: "idle", since: SINCE };
    const bad: unknown[] = [
      null,
      [],
      {},
      { other: { agents: {} } },
      { tui: { agents: {}, at: SINCE } },
      { tui: { agents: [] } },
      { tui: { agents: { "scout-1": { ...agent, extra: 1 } } } },
      { tui: { agents: { "scout-1": { ...agent, status: "WORKING!" } } } },
      { tui: { agents: { "scout-1": { ...agent, since: "yesterday" } } } },
      { tui: { agents: { "scout-1": { ...agent, throttle_left_s: -1 } } } },
      { tui: { agents: Object.fromEntries(Array.from({ length: AGENTS_STATUS_MAX_AGENTS + 1 }, (_, i) => [`scout-${i + 1}`, agent])) } },
    ];
    for (const value of bad) expect(sanitizeAgentsStatus(value).ok, JSON.stringify(value).slice(0, 80)).toBe(false);
  });
});

describe("PATCH /api/team-state — agents_status from the box", () => {
  let upsert: ReturnType<typeof vi.fn>;

  function asDevice(activeDeviceId: string | null, source: "token" | "session" = "token") {
    const check = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { active_device_id: activeDeviceId, sync_requested_at: null }, error: null }),
    };
    check.select.mockReturnValue(check);
    check.eq.mockReturnValue(check);
    const write = { select: vi.fn(), single: vi.fn().mockResolvedValue({ data: {}, error: null }) };
    write.select.mockReturnValue(write);
    upsert = vi.fn().mockReturnValue(write);
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: { source, userId: "user-test", token: { tokenId: "device-test" }, supabase: { from: vi.fn(() => ({ ...check, upsert })) } },
    });
  }

  beforeEach(() => mocks.resolveUser.mockReset());

  it("the active device writes its source, rebuilt", async () => {
    asDevice("device-test");
    const { PATCH } = await import("@/app/api/team-state/route");
    const body = { agents_status: { tui: { agents: { capitano: { status: "working", since: SINCE } } } } };
    const response = await PATCH(request(body));
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ user_id: "user-test", ...body }, { onConflict: "user_id" });
  });

  it("a session opened by hand does not take the team's tags with it", async () => {
    asDevice("device-test");
    const { PATCH } = await import("@/app/api/team-state/route");
    const agent = { status: "working", since: SINCE };
    const response = await PATCH(request({ agents_status: { tui: { agents: { capitano: agent, my_shell: agent } } } }));
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ user_id: "user-test", agents_status: { tui: { agents: { capitano: agent } } } }, { onConflict: "user_id" });
  });

  it("a malformed map is refused before any write", async () => {
    asDevice("device-test");
    const { PATCH } = await import("@/app/api/team-state/route");
    const response = await PATCH(request({ agents_status: { tui: { agents: { capitano: { status: "working" } } } } }));
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("another device of the user is refused, as for the heartbeat", async () => {
    asDevice("device-other");
    const { PATCH } = await import("@/app/api/team-state/route");
    const response = await PATCH(request({ agents_status: { tui: { agents: {} } } }));
    expect(response.status).toBe(409);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a browser session cannot write it", async () => {
    asDevice("device-test", "session");
    const { PATCH } = await import("@/app/api/team-state/route");
    const response = await PATCH(request({ agents_status: { tui: { agents: {} } } }));
    expect(response.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
