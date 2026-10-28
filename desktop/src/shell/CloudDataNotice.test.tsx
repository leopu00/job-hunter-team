import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutContext } from "../lib/account-actions";
import { registerAuthStorageProbe } from "../lib/auth-storage-lock";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import { setLocalTeamData } from "../lib/local-team-data";
import CloudDataNotice from "./CloudDataNotice";
import { CLOUD_DATA_NOTICE_TEXT } from "./cloud-data-notice.i18n";
import ServerPage from "./server-page";

// With a local profile there is no cloud session: the pages that read the cloud say where their data
// comes from and where the team's work is, never «session expired», never an empty page with no word.
beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
});
afterEach(() => {
  cleanup();
  leaveExistingTeamReadOnly();
  setLocalTeamData(null);
  registerAuthStorageProbe(() => true);
});

const IT = CLOUD_DATA_NOTICE_TEXT.it;

describe("the line of the pages that read the cloud, for a profile with no sign-in", () => {
  it("says the data comes from the cloud and offers the sign-in", async () => {
    registerAuthStorageProbe(() => false);
    const signOut = vi.fn().mockResolvedValue(undefined);
    render(<SignOutContext.Provider value={signOut}><CloudDataNotice /></SignOutContext.Provider>);
    expect(screen.getByRole("note")).toHaveTextContent("Questi dati arrivano dal cloud");
    expect(screen.getByRole("note")).toHaveTextContent("Messaggi e Agenti");
    await userEvent.setup().click(screen.getByRole("button", { name: IT.signIn }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("has no button where the shell gives no way to sign in", () => {
    registerAuthStorageProbe(() => false);
    render(<CloudDataNotice />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is not there with a cloud session, nor while a team is read on its VPS", () => {
    registerAuthStorageProbe(() => true);
    const { unmount } = render(<CloudDataNotice />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    unmount();
    registerAuthStorageProbe(() => false);
    enterExistingTeamReadOnly(true);
    render(<CloudDataNotice />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("is the whole of a server page: not its skeleton, nor the empty states of the page it would draw", async () => {
    registerAuthStorageProbe(() => false);
    render(<ServerPage render={() => <h1>no positions yet</h1>} fallback={<p>skeleton</p>} />);
    await act(async () => undefined);
    expect(screen.getByRole("note")).toHaveTextContent("Questi dati arrivano dal cloud");
    expect(screen.queryByRole("heading", { name: "no positions yet" })).not.toBeInTheDocument();
    expect(screen.queryByText("skeleton")).not.toBeInTheDocument();
  });

  it("leaves a server page as it is for a local profile: its data is read from the team on this computer", async () => {
    registerAuthStorageProbe(() => false);
    setLocalTeamData("local:synthetic");
    render(<ServerPage render={() => <h1>the team's positions</h1>} fallback={<p>skeleton</p>} />);
    expect(await screen.findByRole("heading", { name: "the team's positions" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("keeps the same hooks when the cloud session goes and comes back under a server page that stays mounted", async () => {
    // a hook called only when the first one says yes is a different number of hooks at the next render
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerAuthStorageProbe(() => true);
    const page = <ServerPage render={() => <h1>page</h1>} fallback={<p>skeleton</p>} />;
    const view = render(page);
    expect(await screen.findByRole("heading", { name: "page" })).toBeInTheDocument();
    registerAuthStorageProbe(() => false);
    view.rerender(<ServerPage render={() => <h1>page</h1>} fallback={<p>skeleton</p>} />);
    await act(async () => undefined);
    expect(screen.getByRole("note")).toHaveTextContent("Questi dati arrivano dal cloud");
    registerAuthStorageProbe(() => true);
    view.rerender(<ServerPage render={() => <h1>page</h1>} fallback={<p>skeleton</p>} />);
    await act(async () => undefined);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    // and the same for a local profile coming in and going out
    setLocalTeamData("local:synthetic");
    registerAuthStorageProbe(() => false);
    view.rerender(<ServerPage render={() => <h1>page</h1>} fallback={<p>skeleton</p>} />);
    await act(async () => undefined);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    setLocalTeamData(null);
    await act(async () => undefined);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(errors.mock.calls.some(([message]) => String(message).includes("hooks"))).toBe(false);
    errors.mockRestore();
  });

  it("leaves a server page as it is with a cloud session", async () => {
    registerAuthStorageProbe(() => true);
    render(<ServerPage render={() => <h1>page</h1>} fallback={<p>skeleton</p>} />);
    expect(await screen.findByRole("heading", { name: "page" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("is said in every language, and the Portuguese is that of Portugal", () => {
    for (const [locale, text] of Object.entries(CLOUD_DATA_NOTICE_TEXT)) {
      expect(text.notice, `${locale}.notice`).toMatch(/\S/);
      expect(text.signIn, `${locale}.signIn`).toMatch(/\S/);
      // the button leads to the choice of how to sign in, not to Google's page
      expect(text.signIn, `${locale}.signIn names no provider`).not.toMatch(/google/i);
      if (locale !== "it") expect(text.notice, `${locale} is not the Italian one`).not.toBe(IT.notice);
    }
    expect(CLOUD_DATA_NOTICE_TEXT.pt.notice).toMatch(/equipa/);
    expect(CLOUD_DATA_NOTICE_TEXT.pt.notice).not.toMatch(/equipe/i);
  });
});
