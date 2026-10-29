import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { readTeamStart } from "./team-start";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
});

describe("where the team's first start stands", () => {
  it("asks with nothing and hands on the phase, the workers and the plan", async () => {
    for (const phase of ["awaiting_profile", "burst", "steady"]) {
      vi.mocked(invoke).mockResolvedValueOnce({ ok: true, phase, workers: 4, planDeclared: true });
      expect(await readTeamStart()).toEqual({ phase, workers: 4, planDeclared: true });
    }
    expect(invoke).toHaveBeenCalledWith("team_start_read");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
  });

  it("silence is null and workers without a phase are none: unreadable is never started", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true, phase: null, workers: 5, planDeclared: false });
    expect(await readTeamStart()).toEqual({ phase: null, workers: 0, planDeclared: false });
  });

  it("is null for a failure, a malformed answer, a rejection and outside the desktop", async () => {
    for (const bad of [undefined, null, "x", { ok: false, error: "team_start_unavailable" }, { ok: true },
      { ok: true, phase: "running", workers: 1, planDeclared: true }, { ok: true, phase: "burst", workers: -1, planDeclared: true },
      { ok: true, phase: "burst", workers: 1.5, planDeclared: true }, { ok: true, phase: "burst", workers: 2000, planDeclared: true },
      { ok: true, phase: "burst", workers: 1, planDeclared: "yes" }]) {
      vi.mocked(invoke).mockResolvedValueOnce(bad);
      expect(await readTeamStart(), JSON.stringify(bad)).toBeNull();
    }
    vi.mocked(invoke).mockRejectedValueOnce({ code: "disconnected" });
    expect(await readTeamStart()).toBeNull();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(invoke).mockClear();
    expect(await readTeamStart()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
