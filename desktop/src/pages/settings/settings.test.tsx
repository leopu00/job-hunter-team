import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_CURRENCY_COOKIE } from "@/lib/display-currency";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { NOTIFY_PREFS_KEY, readNotifyPrefs, writeNotifyPrefs } from "../../lib/notify/prefs";
import { ProviderSetupContext } from "../../lib/provider-setup";
import SettingsPage from "./index";

const props = { params: {}, search: new URLSearchParams() };
let restore: () => void;
const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  restore = installApiBridge(shellApi(notInDesktop));
  // jsdom cannot reload; the card reloads the page after the language is kept.
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
  localStorage.setItem("jht-lang", "en");
});
afterEach(() => {
  restore();
  reload.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  localStorage.removeItem("jht-lang");
  localStorage.removeItem(NOTIFY_PREFS_KEY);
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  document.cookie = `${DISPLAY_CURRENCY_COOKIE}=; path=/; max-age=0`;
});

describe("the settings page", () => {
  it("offers the provider only where the dashboard provides it, and opens the setup's Provider step", async () => {
    const user = userEvent.setup();
    const view = render(<SettingsPage {...props} />);
    expect(screen.queryByTestId("settings-provider")).not.toBeInTheDocument();
    view.unmount();

    const open = vi.fn();
    render(
      <ProviderSetupContext.Provider value={{ open }}>
        <SettingsPage {...props} />
      </ProviderSetupContext.Provider>,
    );
    const card = screen.getByTestId("settings-provider");
    expect(card).toHaveTextContent("Provider");
    expect(card).toHaveTextContent(/Claude or Codex/);
    await user.click(screen.getByRole("button", { name: "Set up the provider" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("says what it keeps and where, in the app's language", () => {
    render(<SettingsPage {...props} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/stay on this computer and change nothing on your team/)).toBeInTheDocument();
  });

  it("offers the seven languages and keeps the one picked, then reloads in it", async () => {
    const user = userEvent.setup();
    render(<SettingsPage {...props} />);
    for (const label of ["English", "Italiano", "Magyar", "Español", "Deutsch", "Français", "Português"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.cookie).toContain("NEXT_LOCALE=de");
    expect(localStorage.getItem("jht-lang")).toBe("de");
  });

  it("does not reload when the language is not kept", async () => {
    restore();
    restore = installApiBridge(async () => new Response("{}", { status: 400 }));
    const user = userEvent.setup();
    render(<SettingsPage {...props} />);
    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Deutsch" })).toBeEnabled());
    expect(reload).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain("NEXT_LOCALE=de");
  });

  it("keeps the salary currency in the cookie the position pages read", async () => {
    const user = userEvent.setup();
    render(<SettingsPage {...props} />);
    await user.selectOptions(screen.getByRole("combobox"), "USD");
    expect(document.cookie).toContain(`${DISPLAY_CURRENCY_COOKIE}=USD`);
  });

  it("opens the VPS connection details from settings", async () => {
    // The language tests replace location to make reload observable. Restore the
    // browser location here: the shell router updates its hash through History.
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    const user = userEvent.setup();
    render(<SettingsPage {...props} />);
    await user.click(screen.getByRole("button", { name: /VPS connection/ }));
    expect(window.location.hash).toBe("#/settings/vps-connection");
  });

  it("turns the new-position notifications on and off, with the details only when asked", async () => {
    const user = userEvent.setup();
    render(<SettingsPage {...props} />);
    const card = screen.getByTestId("settings-notify");
    expect(card).toHaveTextContent("Notifications");
    // off until the person turns it on, and it says where the notification shows
    expect(screen.getByTestId("settings-notify-enabled")).not.toBeChecked();
    expect(screen.queryByTestId("settings-notify-details")).not.toBeInTheDocument();
    expect(card).toHaveTextContent(/locked screen/);
    await user.click(screen.getByTestId("settings-notify-enabled"));
    expect(readNotifyPrefs()).toEqual({ enabled: true, details: false });
    expect(screen.getByTestId("settings-notify-details")).not.toBeChecked();
    await user.click(screen.getByTestId("settings-notify-details"));
    expect(readNotifyPrefs()).toEqual({ enabled: true, details: true });
    // off forgets the details
    await user.click(screen.getByTestId("settings-notify-enabled"));
    expect(readNotifyPrefs()).toEqual({ enabled: false, details: false });
    expect(screen.queryByTestId("settings-notify-details")).not.toBeInTheDocument();
  });

  it("follows the switch when something else changes it", async () => {
    render(<SettingsPage {...props} />);
    expect(screen.getByTestId("settings-notify-enabled")).not.toBeChecked();
    act(() => {
      writeNotifyPrefs({ enabled: true, details: true });
    });
    expect(screen.getByTestId("settings-notify-enabled")).toBeChecked();
    expect(screen.getByTestId("settings-notify-details")).toBeChecked();
  });

  it("opens the team's hours and models, except in the read-only view", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    const user = userEvent.setup();
    const view = render(<SettingsPage {...props} />);
    await user.click(screen.getByTestId("settings-team-link"));
    expect(window.location.hash).toBe("#/settings/team");
    view.unmount();
    enterExistingTeamReadOnly(false);
    try {
      render(<SettingsPage {...props} />);
      expect(screen.queryByTestId("settings-team-link")).not.toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it("opens the export page, in the read-only view too", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    const user = userEvent.setup();
    const view = render(<SettingsPage {...props} />);
    await user.click(screen.getByTestId("settings-export-link"));
    expect(window.location.hash).toBe("#/export");
    view.unmount();
    enterExistingTeamReadOnly(false);
    try {
      render(<SettingsPage {...props} />);
      expect(screen.getByTestId("settings-export-link")).toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it("opens the backup page, in the read-only view too", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    const user = userEvent.setup();
    const view = render(<SettingsPage {...props} />);
    await user.click(screen.getByTestId("settings-backup-link"));
    expect(window.location.hash).toBe("#/backup");
    view.unmount();
    enterExistingTeamReadOnly(false);
    try {
      render(<SettingsPage {...props} />);
      expect(screen.getByTestId("settings-backup-link")).toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
  });
});
