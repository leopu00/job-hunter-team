import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickAgentsRead, pickUsage, readTeamAgentsShared, resetTeamAgentsShared, SHARED_AGENTS_MS } from "./existing-team-agents";
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

  it("a read that comes back after the view changed is not given to the new one", async () => {
    let answer: (value: unknown) => void = () => undefined;
    native.invoke.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const first = readTeamAgentsShared(T0);
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true);
    answer({ ok: true, data: { agents: [], roles: [], states: true } });
    expect(await first).toMatchObject({ kind: "error", code: "existing_team_target_changed" });
    // the new view reads its own
    expect((await readTeamAgentsShared(T0 + 1)).kind).toBe("read");
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });
});

describe("who an agent is, as the native side lets it through", () => {
  it("keeps only the closed shape: a known cli, a short model, a known effort", async () => {
    const { pickIdentity } = await import("./existing-team-agents");
    expect(pickIdentity({ cli: "codex", model: "gpt-5.6-terra", effort: "high" })).toEqual({ cli: "codex", model: "gpt-5.6-terra", effort: "high" });
    expect(pickIdentity({ cli: "kimi", model: null, effort: null })).toEqual({ cli: "kimi", model: null, effort: null });
    expect(pickIdentity({ cli: "claude", model: "<b>opus</b>", effort: "extreme" })).toEqual({ cli: "claude", model: null, effort: null });
    expect(pickIdentity({ cli: "claude", model: "m".repeat(41), effort: "low" })?.model).toBeNull();
    for (const bad of [{ cli: "gpt" }, { model: "x" }, "codex", null, undefined]) expect(pickIdentity(bad)).toBeNull();
  });
});

describe("an agent's health in small (pickUsage)", () => {
  const UNKNOWN = { contextPct: null, contextTokens: null, contextWindow: null, contextAt: null, tokensHour: null, tokensAt: null };

  it("keeps a zero that was read and turns the native side's seconds into milliseconds", () => {
    expect(pickUsage({ contextPct: 0, contextTokens: 0, contextWindow: 258400, contextAt: 1_790_000_000, tokensHour: 0, tokensAt: 1_790_000_100.5 })).toEqual({
      contextPct: 0, contextTokens: 0, contextWindow: 258400, contextAt: 1_790_000_000_000, tokensHour: 0, tokensAt: 1_790_000_100_500,
    });
  });

  it("says «not known» for what is missing or is not a count, never 0", () => {
    expect(pickUsage(undefined)).toEqual(UNKNOWN);
    expect(pickUsage({ contextPct: 101, contextTokens: -1, contextWindow: "258k", contextAt: true, tokensHour: Number.NaN, tokensAt: null })).toEqual(UNKNOWN);
  });

  it("is on every agent of a list, also of an image that does not send it", () => {
    const read = pickAgentsRead({ agents: [{ name: "SCOUT-1", role: "scout", state: "idle" }], roles: [], states: true });
    expect(read?.agents[0].usage).toEqual(UNKNOWN);
  });
});
