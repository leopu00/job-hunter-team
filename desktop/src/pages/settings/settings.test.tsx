import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPLAY_CURRENCY_COOKIE } from "@/lib/display-currency";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
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
    expect(card).toHaveTextContent(/Claude, Codex or Kimi/);
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
});
