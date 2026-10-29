import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ list: vi.fn(), team: vi.fn() }));
vi.mock("../../lib/agent-control", () => ({ readPanelList: control.list, readTeamState: control.team }));

import { LOCAL_TEAM_STATE_READ_MS, localTeamState } from "./local-team-state";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the status card's row for the team on this computer", () => {
  it("says the team is not available, instead of waiting for ever, when the native read does not answer", async () => {
    control.list.mockReturnValue(new Promise(() => undefined));
    control.team.mockResolvedValue({ ok: true, at: 0, value: { halted: false } });
    const row = localTeamState();
    await vi.advanceTimersByTimeAsync(LOCAL_TEAM_STATE_READ_MS + 1);
    await expect(row).resolves.toBeNull();
  });

  it("answers at once when the reads do, and leaves no timer behind", async () => {
    control.list.mockResolvedValue({ ok: true, at: 0, value: { agents: [{ state: { state: "attivo" } }] } });
    control.team.mockResolvedValue({ ok: true, at: 0, value: { halted: false } });
    const row = await localTeamState();
    expect(row).toMatchObject({ is_running: true, should_run: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
