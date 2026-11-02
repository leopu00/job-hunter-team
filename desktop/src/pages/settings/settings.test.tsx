import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_CURRENCY_COOKIE } from "@/lib/display-currency";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { NOTIFY_PREFS_KEY, readNotifyPrefs, writeNotifyPrefs } from "../../lib/notify/prefs";
import { ProviderSetupContext } from "../../lib/provider-setup";
import { LocalProfileLinkContext } from "../../lib/local-profile-link";
import { BACKUP_TEXT } from "../backup/backup.i18n";
import { EXPORT_TEXT } from "../export/export.i18n";
import { TEAM_SETTINGS_TEXT } from "../team-settings/team-settings.i18n";
import { WORK_HOURS_TEXT } from "../work-hours/work-hours.i18n";
import { SECTION_IDS } from "./sections";
import SettingsPage from "./index";
import { SETTINGS_TEXT, VPS_CONNECTION_TEXT } from "./settings.i18n";

const props = { params: {}, search: new URLSearchParams() };
/** The page of one section: /settings/<section>. */
const inSection = (section: string, search = "") => ({ params: { section }, search: new URLSearchParams(search) });
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
  it("lets the person turn the new-version check off and on again, and says what it sends", async () => {
    const user = userEvent.setup();
    render(<SettingsPage {...inSection("account")} />);
    const card = screen.getByTestId("settings-update-check");
    expect(card).toHaveTextContent("GitHub sees the IP address");
    expect(localStorage.getItem("jht-update-check")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Do not check" }));
    expect(localStorage.getItem("jht-update-check")).toBe("off");
    expect(screen.getByRole("button", { name: "Do not check" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Check at startup" }));
    expect(localStorage.getItem("jht-update-check")).toBeNull();
    localStorage.removeItem("jht-update-check");
  });

  it("offers the provider only where the dashboard provides it, and opens the setup's Provider step", async () => {
    const user = userEvent.setup();
    const view = render(<SettingsPage {...inSection("team")} />);
    expect(screen.queryByTestId("settings-provider")).not.toBeInTheDocument();
    view.unmount();

    const open = vi.fn();
    render(
      <ProviderSetupContext.Provider value={{ open }}>
        <SettingsPage {...inSection("team")} />
      </ProviderSetupContext.Provider>,
    );
    const card = screen.getByTestId("settings-provider");
    expect(card).toHaveTextContent("Provider");
    expect(card).toHaveTextContent(/provider \(Codex\)/);
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

  it("has the VPS connection in the «Where it runs» section, with the title one level under the page's", async () => {
    render(<SettingsPage {...inSection("where")} />);
    expect(screen.getByRole("heading", { level: 2, name: VPS_CONNECTION_TEXT.en.title })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([SETTINGS_TEXT.en.title]);
    // a page on its own has no «back» inside a section: the column of sections is the way around
    expect(screen.queryByRole("button", { name: /^←/ })).toBeNull();
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

  it("has the team's working hours and its models in the Team section, except in the read-only view", async () => {
    const view = render(<SettingsPage {...inSection("team")} />);
    expect(screen.getByRole("heading", { name: WORK_HOURS_TEXT.en.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: TEAM_SETTINGS_TEXT.en.title })).toBeInTheDocument();
    expect(screen.getByTestId("settings-team")).toBeInTheDocument();
    view.unmount();
    enterExistingTeamReadOnly(false);
    try {
      render(<SettingsPage {...inSection("team")} />);
      expect(screen.queryByRole("heading", { name: WORK_HOURS_TEXT.en.title })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: TEAM_SETTINGS_TEXT.en.title })).not.toBeInTheDocument();
      // the read-only view says why they do not open, and where to go
      expect(screen.getByTestId("linked-gate")).toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it("has the export and the backup in the Data section, in the read-only view too", async () => {
    const view = render(<SettingsPage {...inSection("data")} />);
    expect(screen.getByRole("heading", { name: EXPORT_TEXT.en.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: BACKUP_TEXT.en.title })).toBeInTheDocument();
    view.unmount();
    enterExistingTeamReadOnly(false);
    try {
      render(<SettingsPage {...inSection("data")} />);
      expect(screen.getByRole("heading", { name: EXPORT_TEXT.en.title })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: BACKUP_TEXT.en.title })).toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it("offers to link the local profile only to an account that went in without linking it", async () => {
    const user = userEvent.setup();
    const link = vi.fn();
    const without = render(<SettingsPage {...inSection("account")} />);
    expect(screen.queryByTestId("settings-local-link")).toBeNull();
    without.unmount();
    render(
      <LocalProfileLinkContext.Provider value={{ link }}>
        <SettingsPage {...inSection("account")} />
      </LocalProfileLinkContext.Provider>,
    );
    const card = screen.getByTestId("settings-local-link");
    expect(card).toHaveTextContent("Local profile not linked");
    await user.click(screen.getByRole("button", { name: "Link the local profile" }));
    expect(link).toHaveBeenCalledOnce();
  });
});

describe("the settings page, report a problem", () => {
  it("has the Report a problem card, with its preview button off until something is written", () => {
    render(<SettingsPage {...inSection("account")} />);
    expect(screen.getByRole("heading", { name: "Report a problem" })).toBeInTheDocument();
    expect(screen.getByTestId("report-problem-preview-button")).toBeDisabled();
  });

  it("has it in the read-only view of an existing team too: reporting writes nothing to the team", () => {
    enterExistingTeamReadOnly(false);
    try {
      render(<SettingsPage {...inSection("account")} />);
      expect(screen.getByRole("heading", { name: "Report a problem" })).toBeInTheDocument();
    } finally { leaveExistingTeamReadOnly(); }
  });
});

describe("the sections of the settings page", () => {
  it("lists the five sections in a column, lights the one that is open and opens the first when none is named", async () => {
    render(<SettingsPage {...props} />);
    const column = screen.getByTestId("settings-sections");
    expect(within(column).getAllByRole("link").map((link) => link.textContent)).toEqual(["Appearance", "Team", "Where it runs", "Data", "Account"]);
    expect(within(column).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(SECTION_IDS.map((id) => `#/settings/${id}`));
    expect(within(column).getByRole("link", { name: "Appearance" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("settings-theme")).toBeInTheDocument();
  });

  it("opens an unknown section as the first one and remembers the last one that was open", () => {
    const view = render(<SettingsPage {...inSection("nonsense")} />);
    expect(screen.getByTestId("settings-section-appearance")).toHaveAttribute("aria-current", "page");
    view.unmount();
    render(<SettingsPage {...inSection("data")} />);
    expect(localStorage.getItem("jht-settings-section")).toBe("data");
    localStorage.removeItem("jht-settings-section");
  });

  it("scrolls to the piece an old address meant (?at=)", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<SettingsPage {...inSection("data", "?at=backup")} />);
      expect(scroll).toHaveBeenCalledOnce();
      expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("settings-at-backup"));
    } finally {
      // @ts-expect-error jsdom has none: put it back as it was
      delete Element.prototype.scrollIntoView;
    }
  });
});
