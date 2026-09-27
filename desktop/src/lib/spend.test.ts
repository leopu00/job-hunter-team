import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { readSpend, type SpendReport } from "./spend";

const report: SpendReport = { found: false, teamCapUsd: 0.1, agentCapUsd: 0.02, runs: [], agents: [] };

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReset();
});

describe("readSpend", () => {
  it("asks the Tauri command api_team_spend", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(report);
    expect(await readSpend()).toEqual({ state: "ready", report });
    expect(invoke).toHaveBeenCalledWith("api_team_spend");
  });

  it("outside the app there is nothing to read, and it does not try", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await readSpend()).toEqual({ state: "unavailable" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a command that fails is a failed read, not an exception", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue({ code: "read_failed" });
    expect(await readSpend()).toEqual({ state: "failed" });
  });
});
