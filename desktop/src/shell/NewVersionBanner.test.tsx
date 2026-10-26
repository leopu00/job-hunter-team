import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAskedVersion, newerVersion, UPDATE_TEXT } from "../lib/app-update";
import { locales } from "@/i18n/config";
import { NewVersionBanner } from "./NewVersionBanner";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: core.invoke, isTauri: core.isTauri }));

beforeEach(() => {
  core.invoke.mockReset();
  core.isTauri.mockReturnValue(true);
  forgetAskedVersion();
  localStorage.clear();
});
afterEach(cleanup);

describe("the new-version banner", () => {
  it("shows the version, opens the download page through the native word «download» and says when it cannot", async () => {
    core.invoke.mockResolvedValueOnce({ ok: false, error: "browser_failed" });
    render(<NewVersionBanner check={async () => "0.4.1"} locale="en" />);
    const banner = await screen.findByTestId("new-version-banner");
    expect(banner).toHaveTextContent("Job Hunter Team 0.4.1 is available.");
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(core.invoke).toHaveBeenCalledWith("open_public_page", { page: "download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(UPDATE_TEXT.en.failed);
    core.invoke.mockResolvedValueOnce({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("closes for that version only: the same version stays closed, the next one shows", async () => {
    const { unmount } = render(<NewVersionBanner check={async () => "0.4.1"} locale="en" />);
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("new-version-banner")).toBeNull();
    unmount();
    render(<NewVersionBanner check={async () => "0.4.1"} locale="en" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("new-version-banner")).toBeNull();
    cleanup();
    render(<NewVersionBanner check={async () => "0.4.2"} locale="en" />);
    expect(await screen.findByTestId("new-version-banner")).toHaveTextContent("0.4.2");
  });

  it("shows nothing when there is no newer version or the check fails", async () => {
    for (const check of [async () => null, async () => Promise.reject(new Error("offline"))]) {
      const { unmount } = render(<NewVersionBanner check={check} locale="en" />);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId("new-version-banner")).toBeNull();
      unmount();
    }
  });

  it("says it in every language the app has", () => {
    for (const locale of locales) {
      const text = UPDATE_TEXT[locale];
      expect(text.message).toContain("{version}");
      expect(text.download.length).toBeGreaterThan(2);
      expect(text.dismiss.length).toBeGreaterThan(2);
    }
  });
});

describe("asking the native side", () => {
  it("asks once per run of the app, keeps the answer and believes only a plain version", async () => {
    core.invoke.mockResolvedValue({ newer: "0.4.1" });
    expect(await newerVersion()).toBe("0.4.1");
    expect(await newerVersion()).toBe("0.4.1");
    expect(core.invoke).toHaveBeenCalledTimes(1);
    expect(core.invoke).toHaveBeenCalledWith("latest_app_version");
    for (const odd of [{ newer: "0.4.1-rc1" }, { newer: "https://evil.example" }, { newer: 5 }, { newer: null }, {}, null]) {
      forgetAskedVersion();
      core.invoke.mockResolvedValueOnce(odd);
      expect(await newerVersion(), JSON.stringify(odd)).toBeNull();
    }
    forgetAskedVersion();
    core.invoke.mockRejectedValueOnce({ code: "x" });
    expect(await newerVersion()).toBeNull();
  });

  it("asks nothing outside the desktop app", async () => {
    core.isTauri.mockReturnValue(false);
    expect(await newerVersion()).toBeNull();
    expect(core.invoke).not.toHaveBeenCalled();
  });
});
