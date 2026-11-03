import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWebActionLog } from "@/lib/web-action-log";
import ActionLogSection, { appLogClient } from "../pages/agents/ActionLogSection";
import { localActionLogClient } from "./local-action-log";
import { setLocalTeamData } from "./local-team-data";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

// The action log of a profile with no cloud account: the native log read through the site log's own list. Synthetic rows only.
afterEach(() => {
  cleanup();
  setLocalTeamData(null);
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});

const rows = [
  { id: "2-1", action: "team.restart", level: "L2", params: { target: "scout-1" }, summary: "restart", status: "done", created_at: "2026-11-03T09:30:00Z" },
  { id: "1-1", action: "exclusion.decide", level: "L1", params: { legacy_id: 12 }, summary: "exclusion decided", status: "done", created_at: "2026-11-03T09:00:00Z" },
];

describe("the client of the app's own action log", () => {
  it("answers the list's read from the native command and gives the rows the site log's clean-up", async () => {
    native.invoke.mockResolvedValue({ ok: true, rows });
    const read = await readWebActionLog(localActionLogClient());
    expect(native.invoke).toHaveBeenCalledWith("local_action_log_read");
    expect(read.ok && read.rows.map((row) => [row.action, row.target, row.ref, row.status])).toEqual([
      ["team.restart", "scout-1", null, "done"],
      ["exclusion.decide", null, 12, "done"],
    ]);
  });

  it("says «unavailable» for a refusal, a bad answer, an error or a window that is not the app's, never the native message", async () => {
    for (const answer of [{ ok: false, error: "action_log_window_refused" }, { ok: true }, { ok: true, rows: "x" }, null, "text"]) {
      native.invoke.mockResolvedValueOnce(answer);
      expect(await readWebActionLog(localActionLogClient())).toEqual({ ok: false, reason: "unavailable" });
    }
    native.invoke.mockRejectedValueOnce(new Error("/Users/someone/secret"));
    expect(await readWebActionLog(localActionLogClient())).toEqual({ ok: false, reason: "unavailable" });
    native.isTauri.mockReturnValue(false);
    expect(await readWebActionLog(localActionLogClient())).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("the action log in the agents panel with a local profile", () => {
  it("takes the app's own log instead of the account's, and does not touch the account", async () => {
    setLocalTeamData("local:abc");
    expect(await appLogClient()).not.toBeNull();
    setLocalTeamData(null);
  });

  it("lists what the app did, in the app's words and not the site's", async () => {
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({ ok: true, rows });
    render(<ActionLogSection locale="en" />);
    const details = screen.getByTestId("panel-action-log") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const list = await screen.findByTestId("action-log-list");
    expect(list).toHaveAttribute("aria-label", "Actions done by the app on the team");
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("scout-1");
    expect(items[1]).toHaveTextContent("12");
    expect(screen.getByText(/What the app did on the team of this computer/)).toBeInTheDocument();
    expect(screen.queryByText(/the site asked/i)).toBeNull();
    expect(screen.queryByText(/Sign in/i)).toBeNull();
  });

  it("says the app has done nothing yet, not that the site has asked nothing", async () => {
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({ ok: true, rows: [] });
    render(<ActionLogSection locale="it" />);
    const details = screen.getByTestId("panel-action-log") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("L’app non ha ancora fatto nessuna azione sul team.")).toBeInTheDocument();
  });
});
