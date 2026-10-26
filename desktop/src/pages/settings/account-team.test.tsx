import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { SignOutContext } from "../../lib/account-actions";
import type { TeamControlState } from "../../lib/agent-control";
import AccountCard from "./AccountCard";
import { ACCOUNT_TEXT } from "./account.i18n";
import TeamCard from "./TeamCard";

beforeEach(() => localStorage.setItem("jht-lang", "en"));
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  window.location.hash = "";
});

const state = (patch: Partial<TeamControlState> = {}): TeamControlState => ({
  halted: false,
  standby: { state: "off", until: null, weeklyReset: false },
  held: null,
  burnIntent: { state: "off", expiresAt: null, remainingMin: null },
  ...patch,
});
const ok = (value: TeamControlState) => async () => ({ ok: true as const, at: 1, value });

describe("the Account card", () => {
  it("says who is signed in and signs out with the shell's own function", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    render(
      <SignOutContext.Provider value={signOut}>
        <AccountCard load={async () => ({ kind: "google", label: "someone@example.com" })} />
      </SignOutContext.Provider>,
    );
    expect(await screen.findByTestId("settings-account-who")).toHaveTextContent("Signed in as someone@example.com.");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("names a local profile, says nobody when nobody is, and offers no sign out without the shell", async () => {
    const { unmount } = render(<AccountCard load={async () => ({ kind: "local", label: "Test" })} />);
    expect(await screen.findByTestId("settings-account-who")).toHaveTextContent("Local profile “Test”, saved on this computer.");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    unmount();
    render(<AccountCard load={async () => null} />);
    expect(await screen.findByTestId("settings-account-who")).toHaveTextContent("No account is signed in.");
    cleanup();
    render(<AccountCard load={async () => Promise.reject(new Error("x"))} />);
    expect(await screen.findByTestId("settings-account-who")).toHaveTextContent("No account is signed in.");
  });

  it("says a sign out that did not go through and lets the person try again", async () => {
    const signOut = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(undefined);
    render(
      <SignOutContext.Provider value={signOut}>
        <AccountCard load={async () => null} />
      </SignOutContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("I could not sign out");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("leads to the account's data export", async () => {
    render(<AccountCard load={async () => null} />);
    await userEvent.click(screen.getByRole("button", { name: "Export the account’s data" }));
    expect(window.location.hash).toBe("#/export");
  });
});

describe("the Team card", () => {
  it.each([
    ["running", state(), "The team is running."],
    ["stopped", state({ halted: true }), "The team is stopped."],
    ["paused", state({ standby: { state: "active", until: null, weeklyReset: false } }), "The team is paused."],
  ])("says the team is %s", async (_name, value, text) => {
    render(<TeamCard readOnly={false} read={ok(value)} />);
    await waitFor(() => expect(screen.getByTestId("settings-team-state")).toHaveTextContent(text));
  });

  it("says it cannot read the state, never a state it does not know", async () => {
    render(<TeamCard readOnly={false} read={async () => ({ ok: false as const, at: 1, code: "disconnected" })} />);
    await waitFor(() => expect(screen.getByTestId("settings-team-state")).toHaveTextContent("I cannot read the team’s state."));
    cleanup();
    render(<TeamCard readOnly={false} read={async () => Promise.reject(new Error("x"))} />);
    await waitFor(() => expect(screen.getByTestId("settings-team-state")).toHaveTextContent("I cannot read"));
  });

  it("leads to the agents' panel and, where the team is not only read, to the budget in the hours", async () => {
    render(<TeamCard readOnly={false} read={ok(state())} />);
    await userEvent.click(screen.getByTestId("settings-agents-link"));
    expect(window.location.hash).toBe("#/agents");
    await userEvent.click(screen.getByTestId("settings-budget-link"));
    expect(window.location.hash).toBe("#/settings/hours");
    cleanup();
    render(<TeamCard readOnly read={ok(state())} />);
    expect(screen.getByTestId("settings-agents-link")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-budget-link")).toBeNull();
  });
});

it("is written in the seven languages with the same words filled in", () => {
  for (const locale of locales) {
    const text = ACCOUNT_TEXT[locale];
    expect(Object.keys(text).sort(), locale).toEqual(Object.keys(ACCOUNT_TEXT.it).sort());
    expect(text.signedInGoogle, locale).toContain("{who}");
    expect(text.signedInLocal, locale).toContain("{who}");
    for (const value of Object.values(text)) expect(value.trim().length, locale).toBeGreaterThan(2);
  }
});
