import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { TEAM_STATUS_FIELDS } from "../../lib/existing-team-status";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { realSnapshotReply } from "../../test-support/snapshot-command-reply";
import { EXISTING_TEAM_ASSISTANT_TEXT } from "./existing-team-assistant.i18n";
import { EXISTING_TEAM_STATUS_TEXT } from "./existing-team-status.i18n";

// «Squadra» on an existing team that is only read: the six fields the refresh
// command prints, read again on Aggiorna with the time of the read, and the two
// sessions it does NOT print, shown as the connection's own value with its time.
// The reply is built from the keys snapshot_command really prints, the way the
// native parser fills the rest (absent = false). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

const T = EXISTING_TEAM_STATUS_TEXT.it;
const COMMAND = "onboarding_resume_snapshot";
const SNAPSHOT = realSnapshotReply({ providerAuthenticated: false, profileReady: false, assistantWelcomed: false });
const CONNECTION = { at: Date.UTC(2026, 9, 14, 9, 30, 0), captainRunning: true, assistantRunning: false };
// a sentence with the time the connection probed, formatted as the page does
const CONNECTION_TEXT = (text: string, at = CONNECTION.at) =>
  text.replace("{time}", new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" }));

let restoreBridge: () => void;
let answer: () => Promise<unknown>;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  answer = async () => SNAPSHOT;
  native.invoke.mockImplementation(async (command: string) => {
    if (command === COMMAND) return answer();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  restoreBridge = installApiBridge(shellApi(notInDesktop));
  enterExistingTeamReadOnly(false, CONNECTION);
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reads = () => native.invoke.mock.calls.filter(([command]) => command === COMMAND);
// the page's own button and the navbar's carry the same word
const pageRefresh = () => within(screen.getByRole("main")).getByRole("button", { name: T.refresh });
const navbarRefresh = () => within(screen.getByRole("banner")).getByRole("button", { name: "Aggiorna" });
const ROWS = ["runtimeInstalled", "containerRunning", "providerConfigured", "providerAuthenticated", "captainRunning", "assistantRunning", "profileReady", "assistantWelcomed"];
const value = (field: string) => screen.getByTestId(`team-status-${field}`).getAttribute("data-value");

describe("Squadra on an existing team read only", () => {
  it("is in the navigation, reads the state when opened and draws the eight rows, yes or no, with what each means", async () => {
    navigate("/team", { replace: true });
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getByRole("link", { name: "Squadra" })).toHaveAttribute("aria-current", "page");

    expect(await screen.findByTestId("team-status-read")).toBeInTheDocument();
    expect(reads()).toHaveLength(1);
    expect(native.invoke).toHaveBeenCalledWith(COMMAND);
    expect(ROWS.map(value)).toEqual(["yes", "yes", "yes", "no", "yes", "no", "no", "no"]);
    // six rows are this read's; the two sessions are the connection's
    expect(ROWS.map((field) => screen.getByTestId(`team-status-${field}`).getAttribute("data-source"))).toEqual([
      "read", "read", "read", "read", "connection", "connection", "read", "read",
    ]);
    for (const session of ["captainRunning", "assistantRunning"]) {
      expect(screen.getByTestId(`team-status-${session}-source`)).toHaveTextContent(CONNECTION_TEXT(T.atConnection));
    }
    for (const field of TEAM_STATUS_FIELDS) expect(screen.queryByTestId(`team-status-${field}-source`)).not.toBeInTheDocument();
    // each says what it means for the person
    expect(screen.getByTestId("team-status-assistantRunning")).toHaveTextContent(T.fields.assistantRunning.no);
    expect(screen.getByTestId("team-status-captainRunning")).toHaveTextContent(T.fields.captainRunning.yes);
    expect(screen.getByTestId("team-status-actions")).toHaveTextContent(CONNECTION_TEXT(T.actionsAssistantOff));
  });

  it("never turns the sessions the command does not print into a «no» read now: a refresh leaves them as the connection said", async () => {
    const user = userEvent.setup();
    // the connection saw both sessions running; the refresh's reply carries false for both, because it never prints them
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true, { ...CONNECTION, captainRunning: true, assistantRunning: true });
    expect(SNAPSHOT).toMatchObject({ captainRunning: false, assistantRunning: false });
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");
    expect([value("captainRunning"), value("assistantRunning")]).toEqual(["yes", "yes"]);
    await user.click(pageRefresh());
    await waitFor(() => expect(reads()).toHaveLength(2));
    await screen.findByTestId("team-status-read");
    expect([value("captainRunning"), value("assistantRunning")]).toEqual(["yes", "yes"]);
    expect(screen.getByTestId("team-status-assistantRunning-source")).toHaveTextContent(CONNECTION_TEXT(T.atConnection));
  });

  it("shows no value for a session the connection gave none for, never a «no»", async () => {
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(false, null);
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");
    for (const session of ["captainRunning", "assistantRunning"]) {
      expect(value(session)).toBe("unknown");
      expect(screen.getByTestId(`team-status-${session}`)).not.toHaveTextContent(T.no);
      expect(screen.getByTestId(`team-status-${session}-source`)).toHaveTextContent(T.noConnectionValue);
    }
  });

  it("says the actions stay disabled for the read-only connection when the assistant is running", async () => {
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true, { ...CONNECTION, assistantRunning: true });
    navigate("/team", { replace: true });
    render(<Shell />);
    expect(await screen.findByTestId("team-status-actions")).toHaveTextContent(CONNECTION_TEXT(T.actionsReadOnly));
    expect(value("assistantRunning")).toBe("yes");
  });

  it("shows the time of the read, and a newer one after Aggiorna", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");
    const first = screen.getByTestId("team-status-time").textContent;
    expect(first).toContain(T.readAt.replace("{time}", ""));
    vi.setSystemTime(new Date("2026-10-14T12:05:30Z"));
    await user.click(pageRefresh());
    await waitFor(() => expect(screen.getByTestId("team-status-time").textContent).not.toBe(first));
  });

  it("reads again on Aggiorna through the command, not from memory", async () => {
    const user = userEvent.setup();
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");
    expect(value("profileReady")).toBe("no");

    answer = async () => ({ ...SNAPSHOT, profileReady: true });
    await user.click(pageRefresh());
    await waitFor(() => expect(value("profileReady")).toBe("yes"));
    expect(reads()).toHaveLength(2);

    // the navbar's Aggiorna asks the page for a fresh read too
    answer = async () => ({ ...SNAPSHOT, profileReady: false });
    await user.click(navbarRefresh());
    await waitFor(() => expect(value("profileReady")).toBe("no"));
    expect(reads()).toHaveLength(3);
  });

  it("tells what it has not read yet, and shows nothing as the state until a read succeeds", async () => {
    answer = () => new Promise(() => undefined);
    navigate("/team", { replace: true });
    render(<Shell />);
    expect(await screen.findByTestId("team-status-unknown")).toHaveTextContent(T.unknown);
    expect(screen.queryByTestId("team-status-read")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-status-assistantRunning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-status-captainRunning")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.refreshing })).toBeDisabled();
  });

  it("shows the real code of a failed read and never an older state as the present", async () => {
    const user = userEvent.setup();
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");

    answer = async () => {
      throw { code: "snapshot_failed" };
    };
    await user.click(pageRefresh());
    const alert = await screen.findByTestId("team-status-error");
    expect(alert).toHaveTextContent("(snapshot_failed)");
    expect(alert).toHaveTextContent(describeError("snapshot_failed", { fallback: "existing_team_unavailable", locale: "it" }).text);
    expect(alert).toHaveTextContent(T.failed);
    // the last good reading is gone, not offered as current
    expect(screen.queryByTestId("team-status-read")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-status-containerRunning")).not.toBeInTheDocument();

    // and a later read that works replaces the error
    answer = async () => SNAPSHOT;
    await user.click(pageRefresh());
    expect(await screen.findByTestId("team-status-read")).toBeInTheDocument();
    expect(screen.queryByTestId("team-status-error")).not.toBeInTheDocument();
  });

  it("calls a reply without all the fields a bad reply, not a state of «no»", async () => {
    answer = async () => ({ runtimeInstalled: true });
    navigate("/team", { replace: true });
    render(<Shell />);
    expect(await screen.findByTestId("team-status-error")).toHaveTextContent("(desktop_bad_reply)");
    expect(screen.queryByTestId("team-status-read")).not.toBeInTheDocument();
  });

  it("marks the previous values as such while it reads again", async () => {
    const user = userEvent.setup();
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");
    let release!: (value: unknown) => void;
    answer = () => new Promise((resolve) => { release = resolve; });
    await user.click(pageRefresh());
    await waitFor(() => expect(screen.getByTestId("team-status-time").textContent).toContain("aggiornamento in corso"));
    expect(screen.getByTestId("team-status-read")).toHaveAttribute("aria-busy", "true");
    release(SNAPSHOT);
    await waitFor(() => expect(screen.getByTestId("team-status-time").textContent).not.toContain("aggiornamento in corso"));
  });

  it("never lets a slow older read overwrite a newer one", async () => {
    const user = userEvent.setup();
    let releaseOld!: (value: unknown) => void;
    let call = 0;
    answer = () => {
      call += 1;
      if (call === 1) return new Promise((resolve) => { releaseOld = resolve; });
      return Promise.resolve({ ...SNAPSHOT, profileReady: true });
    };
    navigate("/team", { replace: true });
    render(<Shell />);
    // the first read is still out; the navbar's Aggiorna starts a second one that answers at once
    await waitFor(() => expect(reads()).toHaveLength(1));
    await user.click(navbarRefresh());
    await waitFor(() => expect(value("profileReady")).toBe("yes"));
    // the old read now answers, with the opposite value: it is not shown
    releaseOld({ ...SNAPSHOT, profileReady: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(value("profileReady")).toBe("yes");
  });

  it("starts, stops and asks nothing by itself: the page has no control but the refresh and the one that asks to activate the assistant, and only the read-only command runs", async () => {
    navigate("/team", { replace: true });
    render(<Shell />);
    const read = await screen.findByTestId("team-status-read");
    const page = read.parentElement!;
    expect(within(page).getAllByRole("button").map((button) => button.textContent)).toEqual([T.refresh, EXISTING_TEAM_ASSISTANT_TEXT.it.activate]);
    expect(native.invoke.mock.calls.every(([command]) => command === COMMAND)).toBe(true);
    expect(fake.current!.calls).toEqual([]);
  });

  it("shows no provider name, account or path, even if the reply carried them", async () => {
    answer = async () => ({ ...SNAPSHOT, providerName: "synthetic-provider-name", account: "synthetic-account-name", credentialsPath: "/synthetic/creds" });
    navigate("/team", { replace: true });
    render(<Shell />);
    await screen.findByTestId("team-status-read");
    expect(document.body.textContent).not.toContain("synthetic-provider-name");
    expect(document.body.textContent).not.toContain("synthetic-account-name");
    expect(document.body.textContent).not.toContain("/synthetic/creds");
  });
});
