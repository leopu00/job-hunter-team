import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { TeamUpdateNotice, teamIsOlderThanApp } from "./TeamUpdateNotice";

const setLang = (lang: string) => {
  localStorage.setItem("jht-lang", lang);
  document.cookie = `NEXT_LOCALE=${lang}; path=/`;
};
beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
  localStorage.clear();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

const reply = (changed: boolean, imageId = "aaaaaaaaaaaa:bbbbbbbbbbbb") => ({
  ok: true, changed, phase: "check", reason: null, rolledBack: false, restartRequired: false,
  previousVersion: "", currentVersion: "", imageId, mode: "upgrade",
});

describe("the notice that the team is older than the app", () => {
  it("shows nothing when the team is up to date", async () => {
    const check = vi.fn(async () => false);
    const view = render(<TeamUpdateNotice check={check} />);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(view.container).toBeEmptyDOMElement();
  });

  it("says it, offers the update and can be put off until the next start", async () => {
    render(<TeamUpdateNotice check={async () => true} />);
    expect(await screen.findByTestId("team-update-notice")).toHaveTextContent("The team runs an older version than this app.");
    fireEvent.click(screen.getByTestId("team-update-notice-button"));
    expect(screen.getByTestId("team-update-confirm")).toBeInTheDocument();
    expect(screen.queryByTestId("team-update-notice-button")).toBeNull();
    fireEvent.click(screen.getByTestId("team-update-close"));
    expect(screen.queryByTestId("team-update-notice")).toBeNull();
  });

  it("keeps the outcome on screen after a finished update, without saying the team is older, until it is closed", async () => {
    native.invoke.mockResolvedValue({ ...reply(true), phase: "complete", previousVersion: "0.4.0", currentVersion: "0.4.1" });
    render(<TeamUpdateNotice check={async () => true} />);
    fireEvent.click(await screen.findByTestId("team-update-notice-button"));
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(screen.getByTestId("team-update-done")).toHaveTextContent("Team updated."));
    expect(screen.getByTestId("team-update-notice")).not.toHaveTextContent("older version");
    fireEvent.click(screen.getByTestId("team-update-close"));
    expect(screen.queryByTestId("team-update-notice")).toBeNull();
  });

  it("can be put off without opening the update", async () => {
    render(<TeamUpdateNotice check={async () => true} />);
    fireEvent.click(await screen.findByTestId("team-update-notice-later"));
    expect(screen.queryByTestId("team-update-notice")).toBeNull();
  });

  it("asks the native side once a day, only for a check, and never outside the desktop app", async () => {
    native.invoke.mockResolvedValue(reply(true));
    expect(await teamIsOlderThanApp()).toBe(true);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("onboarding_team_update", { action: "check" });
    // asked today: not again
    expect(await teamIsOlderThanApp()).toBe(false);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    localStorage.clear();
    native.isTauri.mockReturnValue(false);
    expect(await teamIsOlderThanApp()).toBe(false);
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not tell again a difference the person already updated to, and tells a new one", async () => {
    native.invoke.mockResolvedValue(reply(true, "aaaaaaaaaaaa:bbbbbbbbbbbb"));
    localStorage.setItem("jht-team-update-acked", "aaaaaaaaaaaa:bbbbbbbbbbbb");
    expect(await teamIsOlderThanApp()).toBe(false);
    localStorage.removeItem("jht-team-update-checked");
    native.invoke.mockResolvedValue(reply(true, "aaaaaaaaaaaa:cccccccccccc"));
    expect(await teamIsOlderThanApp()).toBe(true);
  });

  it("says nothing, and asks again next time, when the check fails or the team is not older", async () => {
    native.invoke.mockRejectedValue({ code: "agent_control_read_only" });
    expect(await teamIsOlderThanApp()).toBe(false);
    expect(localStorage.getItem("jht-team-update-checked")).toBeNull();
    native.invoke.mockResolvedValue(reply(false));
    expect(await teamIsOlderThanApp()).toBe(false);
    expect(localStorage.getItem("jht-team-update-checked")).not.toBeNull();
  });
});
