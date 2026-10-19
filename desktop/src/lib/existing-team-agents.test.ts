import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTeamAgentsShared, resetTeamAgentsShared, SHARED_AGENTS_MS } from "./existing-team-agents";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "./existing-team-readonly";

// One read of the team's agents serves the Agents page and the office of the
// read-only view, and belongs to the opening of that view. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const REPLY = { ok: true, data: { agents: [], roles: [], states: false } };
const T0 = Date.UTC(2026, 9, 19, 2, 0, 0);

beforeEach(() => {
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(REPLY);
  resetTeamAgentsShared();
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  leaveExistingTeamReadOnly();
  resetTeamAgentsShared();
});

describe("readTeamAgentsShared", () => {
  it("serves the page and the office with one read of the VPS", async () => {
    const page = readTeamAgentsShared(T0);
    const office = readTeamAgentsShared(T0 + SHARED_AGENTS_MS - 1);
    expect(office).toBe(page);
    expect((await office).kind).toBe("read");
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_agents_read", { request: { op: "list" } });
  });

  it("reads again once the shared window is over", async () => {
    await readTeamAgentsShared(T0);
    await readTeamAgentsShared(T0 + SHARED_AGENTS_MS);
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it("never serves the read of a view that was left or opened again (another VPS, another team)", async () => {
    await readTeamAgentsShared(T0);
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true);
    await readTeamAgentsShared(T0 + 1);
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });
});
