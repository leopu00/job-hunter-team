import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceRestoredWriteAccess,
  clearWriteAccessNotice,
  reportWriteAccessRemovalFailed,
  writeAccessBridge,
  writeAccessNotice,
} from "../lib/write-access-restored";
import { downgradeExistingTeamToReadOnly, enterExistingTeamReadOnly, existingTeamReadOnly, existingTeamView, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import { vpsLinkStatusBridge } from "../lib/vps-link-status";
import { WriteAccessRestoredBanner } from "./WriteAccessRestoredBanner";
import { WRITE_ACCESS_RESTORED_TEXT } from "./write-access-restored.i18n";

vi.mock("../lib/vps-link", () => ({ startVpsLink: vi.fn(), stopVpsLink: vi.fn() }));

const LOCALES = ["it", "en", "es", "fr", "de", "pt", "hu"] as const;

function openFullView() {
  enterExistingTeamReadOnly(true, { at: 1, captainRunning: true, assistantRunning: true }, "account:x|k", true);
}

beforeEach(() => {
  vi.spyOn(vpsLinkStatusBridge, "status").mockResolvedValue({
    addressMasked: "203.0.xxx.xxx", user: "jht", fingerprint: null, state: "linked", lastOkAt: null,
    lastErrorCode: null, mode: "full", container: null, image: null, revision: null, chatReady: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearWriteAccessNotice();
  leaveExistingTeamReadOnly();
});

describe("the fixed row of a full connection that came back at start-up", () => {
  it("shows nothing when nothing came back", () => {
    render(<WriteAccessRestoredBanner locale="it" />);
    expect(screen.queryByTestId("write-access-restored")).toBeNull();
    expect(screen.queryByTestId("write-access-removal-failed")).toBeNull();
  });

  it("says which team the write access is on, what persists and for how long, in the seven languages", async () => {
    for (const locale of LOCALES) {
      announceRestoredWriteAccess();
      const view = render(<WriteAccessRestoredBanner locale={locale} />);
      const t = WRITE_ACCESS_RESTORED_TEXT[locale];
      const row = screen.getByTestId("write-access-restored");
      await waitFor(() => expect(row).toHaveTextContent("jht · 203.0.xxx.xxx"));
      expect(row).toHaveTextContent(t.title.replace("{where}", "jht · 203.0.xxx.xxx"));
      expect(row).toHaveTextContent(t.note);
      expect(row).toHaveTextContent("30");
      expect(screen.getByTestId("write-access-switch")).toHaveTextContent(t.switchToReadOnly);
      view.unmount();
      clearWriteAccessNotice();
    }
  });

  it("still says which team when the saved connection's address cannot be read", async () => {
    vi.mocked(vpsLinkStatusBridge.status).mockRejectedValue({ code: "existing_team_runtime_unavailable" });
    announceRestoredWriteAccess();
    render(<WriteAccessRestoredBanner locale="en" />);
    expect(screen.getByTestId("write-access-restored")).toHaveTextContent("Write access is on for the connected team");
  });

  it("«Switch to read only» takes the permission away natively and puts the view back to read only", async () => {
    const off = vi.spyOn(writeAccessBridge, "off").mockResolvedValue(undefined);
    openFullView();
    announceRestoredWriteAccess();
    render(<WriteAccessRestoredBanner locale="it" />);
    expect(existingTeamReadOnly()).toBeNull();
    await userEvent.click(screen.getByTestId("write-access-switch"));
    expect(off).toHaveBeenCalledOnce();
    await waitFor(() => expect(writeAccessNotice()).toBeNull());
    expect(screen.queryByTestId("write-access-restored")).toBeNull();
    // the same opening, no longer in full: what writes is disabled again
    expect(existingTeamView()).toMatchObject({ assistantActive: true });
    expect(existingTeamReadOnly()).not.toBeNull();
  });

  it("while the native side works the button is taken: no second call", async () => {
    let done!: () => void;
    const off = vi.spyOn(writeAccessBridge, "off").mockImplementation(() => new Promise<void>((resolve) => { done = resolve; }));
    openFullView();
    announceRestoredWriteAccess();
    render(<WriteAccessRestoredBanner locale="en" />);
    await userEvent.click(screen.getByTestId("write-access-switch"));
    expect(screen.getByTestId("write-access-switch")).toBeDisabled();
    expect(screen.getByTestId("write-access-switch")).toHaveTextContent("Switching to read only…");
    await act(async () => { done(); });
    expect(off).toHaveBeenCalledOnce();
  });

  it("a record that could not be removed is said, and this run is read only anyway", async () => {
    vi.spyOn(writeAccessBridge, "off").mockRejectedValue({ code: "existing_team_full_link_not_removed" });
    openFullView();
    announceRestoredWriteAccess();
    render(<WriteAccessRestoredBanner locale="en" />);
    await userEvent.click(screen.getByTestId("write-access-switch"));
    const failed = await screen.findByTestId("write-access-removal-failed");
    expect(failed).toHaveTextContent(WRITE_ACCESS_RESTORED_TEXT.en.removalFailed);
    expect(failed).toHaveTextContent("could not be removed from this computer");
    // the native side revokes in memory before it touches the file: the view is read only whatever happened
    expect(existingTeamReadOnly()).not.toBeNull();
    expect(screen.queryByTestId("write-access-restored")).toBeNull();
    await userEvent.click(screen.getByText("OK"));
    expect(writeAccessNotice()).toBeNull();
  });

  it("an error with no readable code is still the removal that failed", async () => {
    vi.spyOn(writeAccessBridge, "off").mockRejectedValue(new Error("boom"));
    openFullView();
    announceRestoredWriteAccess();
    render(<WriteAccessRestoredBanner locale="it" />);
    await userEvent.click(screen.getByTestId("write-access-switch"));
    expect(await screen.findByTestId("write-access-removal-failed")).toHaveTextContent("non si è potuto togliere");
    expect(writeAccessNotice()).toEqual({ kind: "removal_failed", code: "existing_team_full_link_not_removed" });
  });

  it("leaving the view, or a new confirmation, takes the row away", () => {
    announceRestoredWriteAccess();
    leaveExistingTeamReadOnly();
    expect(writeAccessNotice()).toBeNull();
    reportWriteAccessRemovalFailed("existing_team_full_link_not_removed");
    clearWriteAccessNotice();
    expect(writeAccessNotice()).toBeNull();
  });

  it("downgrading a read-only view changes nothing", () => {
    enterExistingTeamReadOnly(true, null, "account:x|k");
    const before = existingTeamView();
    downgradeExistingTeamToReadOnly();
    expect(existingTeamView()).toEqual(before);
  });

  it("has the seven languages with every sentence", () => {
    expect(Object.keys(WRITE_ACCESS_RESTORED_TEXT)).toHaveLength(7);
    for (const copy of Object.values(WRITE_ACCESS_RESTORED_TEXT)) {
      for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(8);
      expect(copy.title).toContain("{where}");
    }
  });
});
