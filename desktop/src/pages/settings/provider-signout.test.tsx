import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { ProviderSetupContext } from "../../lib/provider-setup";
import type { ProviderOutcome } from "../../lib/team-provider";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import ProviderSignOut from "./ProviderSignOut";
import SettingsPage from "./index";

// «Disconnect the account» in the Settings «Provider» card: only where the team is signed in, asks first,
// sends the request only after «Yes», and tells what the team holds afterwards. Synthetic replies only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

const signedIn = (provider: "claude" | "codex" | "kimi" = "codex"): ProviderOutcome => ({ ok: true, value: { provider, authenticated: true } });
const signedOut = (provider: "claude" | "codex" | "kimi" = "codex"): ProviderOutcome => ({ ok: true, value: { provider, authenticated: false } });

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});
afterEach(cleanup);

describe("ProviderSignOut", () => {
  it("shows nothing where the team is not signed in, or where it cannot be read", async () => {
    for (const read of [async () => signedOut(), async () => ({ ok: false, code: "team_provider_read_only" }) as ProviderOutcome, async () => Promise.reject(new Error("x"))]) {
      const view = render(<ProviderSignOut read={read} signOut={vi.fn()} />);
      await waitFor(() => expect(read).toBeDefined());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByTestId("provider-signout")).toBeNull();
      view.unmount();
    }
  });

  it("names the provider, asks first, and sends nothing until «Sì, disconnetti»", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => signedOut());
    render(<ProviderSignOut read={async () => signedIn("claude")} signOut={signOut} />);
    expect(await screen.findByText("Accesso effettuato a Claude.")).toBeInTheDocument();
    await user.click(screen.getByTestId("provider-signout-open"));
    const confirm = screen.getByTestId("provider-signout-confirm");
    expect(within(confirm).getByText("Disconnettere l’account di Claude?")).toBeInTheDocument();
    expect(confirm).toHaveTextContent("Gli agenti in corso si fermano");
    expect(confirm).toHaveTextContent("non viene revocato");
    expect(signOut).not.toHaveBeenCalled();
    // «Annulla» goes back and still sends nothing
    await user.click(screen.getByTestId("provider-signout-no"));
    expect(screen.queryByTestId("provider-signout-confirm")).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("provider-signout-open"));
    await user.click(screen.getByTestId("provider-signout-yes"));
    expect(await screen.findByTestId("provider-signout-done")).toHaveTextContent("Account disconnesso");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("provider-signout-open")).toBeNull();
  });

  it("a sign-in that is still there is an error with the catalog's words, never «disconnected»", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async (): Promise<ProviderOutcome> => ({ ok: false, code: "provider_logout_incomplete" }));
    render(<ProviderSignOut read={async () => signedIn()} signOut={signOut} />);
    await user.click(await screen.findByTestId("provider-signout-open"));
    await user.click(screen.getByTestId("provider-signout-yes"));
    const told = describeError("provider_logout_incomplete", { locale: "it" });
    expect(await screen.findByTestId("provider-signout-error")).toHaveTextContent(told.text);
    expect(screen.queryByTestId("provider-signout-done")).toBeNull();
    // the person is where the sign-in still is, and can try again
    expect(screen.getByTestId("provider-signout-open")).toBeEnabled();
  });

  it("an answer that says «ok» and still signed in is not «disconnected» either", async () => {
    const user = userEvent.setup();
    render(<ProviderSignOut read={async () => signedIn()} signOut={async () => signedIn()} />);
    await user.click(await screen.findByTestId("provider-signout-open"));
    await user.click(screen.getByTestId("provider-signout-yes"));
    expect(await screen.findByTestId("provider-signout-error")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-signout-done")).toBeNull();
  });

  it("an error with a code the catalog does not know falls back to the generic words, with no file name", async () => {
    const user = userEvent.setup();
    render(<ProviderSignOut read={async () => signedIn()} signOut={async () => ({ ok: false, code: "something_new_from_the_box" })} />);
    await user.click(await screen.findByTestId("provider-signout-open"));
    await user.click(screen.getByTestId("provider-signout-yes"));
    const error = await screen.findByTestId("provider-signout-error");
    expect(error).not.toHaveTextContent("jht_home");
    expect(error.textContent?.length).toBeGreaterThan(10);
  });
});

describe("the Provider card of the Settings page", () => {
  it("carries the button where the team is signed in, and the request goes out only after the confirmation", async () => {
    const restore = installApiBridge(shellApi(notInDesktop));
    try {
      const user = userEvent.setup();
      let signed = true;
      native.invoke.mockImplementation(async (command: string, args: { request: { op: string; confirmed?: boolean } }) => {
        // the page's other cards read the team's state through the panel; only the provider's command is the subject
        if (command === "agent_control") return { ok: false, error: "agent_control_no_team" };
        if (command !== "team_provider") throw new Error(`unexpected native command ${command}`);
        if (args.request.op === "logout") signed = false;
        return { ok: true, provider: "codex", authenticated: signed, ...(args.request.op === "logout" ? { removed: 1 } : {}) };
      });
      render(
        <ProviderSetupContext.Provider value={{ open: vi.fn() }}>
          <SettingsPage params={{}} search={new URLSearchParams()} />
        </ProviderSetupContext.Provider>,
      );
      const card = screen.getByTestId("settings-provider");
      await user.click(await within(card).findByTestId("provider-signout-open"));
      const asked = () => native.invoke.mock.calls.filter(([command]) => command === "team_provider").map(([, args]) => args.request);
      expect(asked()).toEqual([{ op: "status" }]);
      await user.click(screen.getByTestId("provider-signout-yes"));
      expect(await screen.findByTestId("provider-signout-done")).toBeInTheDocument();
      expect(asked()).toEqual([{ op: "status" }, { op: "logout", confirmed: true }]);
    } finally {
      restore();
    }
  });

  it("outside the desktop app, or without the card, there is no button", async () => {
    const restore = installApiBridge(shellApi(notInDesktop));
    try {
      native.isTauri.mockReturnValue(false);
      render(
        <ProviderSetupContext.Provider value={{ open: vi.fn() }}>
          <SettingsPage params={{}} search={new URLSearchParams()} />
        </ProviderSetupContext.Provider>,
      );
      await screen.findByTestId("settings-provider");
      expect(screen.queryByTestId("provider-signout")).toBeNull();
      expect(native.invoke.mock.calls.filter(([command]) => command === "team_provider")).toEqual([]);
    } finally {
      restore();
    }
  });
});
