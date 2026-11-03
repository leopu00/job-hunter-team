import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocalTeamData } from "../../lib/local-team-data";
import { TeamLogPage } from "./agents";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

// The Activity log of a profile with no cloud account: the web's own page, with the events of the team on this
// computer instead of the cloud's. Synthetic rows only.
afterEach(() => {
  cleanup();
  setLocalTeamData(null);
  native.invoke.mockReset();
  localStorage.removeItem("jht-lang");
});

describe("the Activity log with a local profile", () => {
  it("lists the events the team's database holds, from the native read and not from the cloud", async () => {
    localStorage.setItem("jht-lang", "en");
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({
      ok: true,
      data: {
        items: [
          { role: "scout", actor: "scout-1", ts: "2026-10-03T10:00:00Z", pid: "7", title: "Backend Engineer", company: "Acme", legacyId: 12 },
          { role: "scorer", actor: "scorer-1", ts: "2026-10-02T10:00:00Z", pid: "8", title: "Data Analyst", company: "Globex", legacyId: 13 },
        ],
      },
    });
    render(<TeamLogPage params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByText(/Backend Engineer/)).toBeInTheDocument();
    expect(screen.getByText(/Data Analyst/)).toBeInTheDocument();
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "team_activity_log" } });
    expect(screen.queryByText(/Sign in/i)).not.toBeInTheDocument();
  });

  it("shows an empty log, not an error, when the team has no events or cannot be read", async () => {
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({ ok: false, error: "local_team_not_running", kind: "application" });
    render(<TeamLogPage params={{}} search={new URLSearchParams()} />);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
    expect(screen.queryByText(/Backend Engineer/)).not.toBeInTheDocument();
  });
});
