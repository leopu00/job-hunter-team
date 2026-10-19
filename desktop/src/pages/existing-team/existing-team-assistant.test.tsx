import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, existingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { realSnapshotReply } from "../../test-support/snapshot-command-reply";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { reportVpsRead } from "../../lib/vps-link";
import { VPS_LINK_TEXT } from "../../lib/vps-link.i18n";
import { EXISTING_TEAM_ASSISTANT_TEXT } from "./existing-team-assistant.i18n";
import { EXISTING_TEAM_STATUS_TEXT } from "./existing-team-status.i18n";

// «Attiva assistente» on the Squadra page of an existing team: a confirmation that says what it
// costs before anything is sent, one start command however many clicks, and a result by kind that
// promotes nothing unless the command saw the assistant running. The native side is a stand-in
// that records its calls: no VM, no engine, no SSH. Synthetic data only.
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

const T = EXISTING_TEAM_ASSISTANT_TEXT.it;
const S = EXISTING_TEAM_STATUS_TEXT.it;
const START = "existing_team_assistant_start";
const CONNECTION = { at: Date.UTC(2026, 9, 14, 9, 30, 0), captainRunning: true, assistantRunning: false };

let restoreBridge: () => void;
let startReply: () => Promise<unknown>;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  startReply = async () => ({ outcome: "started", captainRunning: true, assistantRunning: true });
  native.invoke.mockImplementation(async (command: string) => {
    if (command === START) return startReply();
    if (command === "onboarding_resume_snapshot") return realSnapshotReply();
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
  vi.unstubAllGlobals();
});

const starts = () => native.invoke.mock.calls.filter(([command]) => command === START);
const open = async () => {
  navigate("/team", { replace: true });
  render(<Shell />);
  await screen.findByTestId("team-status-read");
};
const card = () => screen.getByTestId("assistant-card");
const asks = async (user: ReturnType<typeof userEvent.setup>) => user.click(within(card()).getByTestId("assistant-activate"));

describe("nothing starts by itself", () => {
  it("opening Squadra, refreshing it and moving around never sends the start command", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: S.refresh }));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Aggiorna" }));
    await waitFor(() => expect(native.invoke.mock.calls.filter(([c]) => c === "onboarding_resume_snapshot").length).toBeGreaterThanOrEqual(3));
    navigate("/dashboard", { replace: true });
    navigate("/team", { replace: true });
    expect(starts()).toHaveLength(0);
  });

  it("offers the action while the assistant is not known to be running, and not when it is", async () => {
    await open();
    expect(within(card()).getByTestId("assistant-activate")).toHaveTextContent(T.activate);
    expect(screen.getByTestId("assistant-status")).toHaveAttribute("data-running", "no");
    cleanup();
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(true, { ...CONNECTION, assistantRunning: true });
    await open();
    expect(within(card()).queryByTestId("assistant-activate")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-status")).toHaveAttribute("data-running", "yes");
  });

  it("says the assistant's state was not read when the connection gave none", async () => {
    leaveExistingTeamReadOnly();
    enterExistingTeamReadOnly(false, null);
    await open();
    expect(screen.getByTestId("assistant-status")).toHaveTextContent(T.unknown);
  });
});

describe("an uncertain link", () => {
  it("never starts the assistant: after a network failure the button is disabled and says why", async () => {
    const user = userEvent.setup();
    await open();
    expect(within(card()).getByTestId("assistant-activate")).toBeEnabled();
    act(() => reportVpsRead({ ok: false, error: "timeout", kind: "network" }));
    expect(within(card()).getByTestId("assistant-activate")).toBeDisabled();
    expect(within(card()).getByTestId("assistant-link-wait")).toHaveTextContent(VPS_LINK_TEXT.it.actionsWait);
    await user.click(within(card()).getByTestId("assistant-activate"));
    expect(screen.queryByTestId("assistant-confirm-panel")).not.toBeInTheDocument();
    expect(starts()).toHaveLength(0);
    // the link back: the action is offered again
    act(() => reportVpsRead({ ok: true, data: {} }));
    expect(within(card()).getByTestId("assistant-activate")).toBeEnabled();
  });

  it("a confirmation already open does not send on a link that dropped meanwhile", async () => {
    const user = userEvent.setup();
    await open();
    await asks(user);
    act(() => reportVpsRead({ ok: false, error: "existing_team_not_active", kind: "application" }));
    expect(within(screen.getByTestId("assistant-confirm-panel")).getByTestId("assistant-confirm")).toBeDisabled();
    expect(starts()).toHaveLength(0);
  });
});

describe("the confirmation", () => {
  it("shows the cost and the effects before anything is sent, and Annulla sends nothing", async () => {
    const user = userEvent.setup();
    await open();
    expect(screen.queryByTestId("assistant-confirm-panel")).not.toBeInTheDocument();
    await asks(user);
    const panel = screen.getByTestId("assistant-confirm-panel");
    expect(starts()).toHaveLength(0);
    expect(within(panel).getByTestId("assistant-effects")).toHaveTextContent(T.effects);
    // the cost and the effects the operator asked to be stated, in words
    expect(panel.textContent).toMatch(/token/);
    expect(panel.textContent).toMatch(/\[WELCOME-USER\]/);
    expect(panel.textContent).toMatch(/provider/);
    expect(within(panel).getByTestId("assistant-no-stop")).toHaveTextContent(T.noStop);
    expect(panel.textContent).toMatch(/watchdog/);
    await user.click(within(panel).getByTestId("assistant-cancel"));
    expect(screen.queryByTestId("assistant-confirm-panel")).not.toBeInTheDocument();
    expect(starts()).toHaveLength(0);
    expect(within(card()).getByTestId("assistant-activate")).toBeInTheDocument();
  });

  it("sends the one command only on Conferma, with the confirmation in the request", async () => {
    const user = userEvent.setup();
    await open();
    await asks(user);
    await user.click(screen.getByTestId("assistant-confirm"));
    await screen.findByTestId("assistant-outcome");
    expect(starts()).toHaveLength(1);
    expect(native.invoke).toHaveBeenCalledWith(START, { request: { confirmed: true } });
  });

  it("sends one command for a double click, and for a second click while it runs", async () => {
    const user = userEvent.setup();
    let release!: (value: unknown) => void;
    startReply = () => new Promise((resolve) => { release = resolve; });
    await open();
    await asks(user);
    const confirm = screen.getByTestId("assistant-confirm");
    await user.dblClick(confirm);
    await user.click(confirm);
    expect(starts()).toHaveLength(1);
    expect(screen.getByTestId("assistant-confirm")).toBeDisabled();
    expect(screen.getByTestId("assistant-confirm")).toHaveTextContent(T.starting);
    expect(screen.getByTestId("assistant-cancel")).toBeDisabled();
    release({ outcome: "started", captainRunning: true, assistantRunning: true });
    await screen.findByTestId("assistant-outcome");
    expect(starts()).toHaveLength(1);
  });

  it("sends one command for two clicks in the same instant, before the screen can disable the button", async () => {
    const user = userEvent.setup();
    let release!: (value: unknown) => void;
    startReply = () => new Promise((resolve) => { release = resolve; });
    await open();
    await asks(user);
    const confirm = screen.getByTestId("assistant-confirm");
    // both clicks land in one batch: the disabled state of the first has not been drawn yet
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(starts()).toHaveLength(1);
    release({ outcome: "started", captainRunning: true, assistantRunning: true });
    await screen.findByTestId("assistant-outcome");
    expect(starts()).toHaveLength(1);
  });

  it("asks again for the next attempt: a result never leaves the confirmation open", async () => {
    const user = userEvent.setup();
    startReply = async () => { throw { code: "assistant_start_failed" }; };
    await open();
    await asks(user);
    await user.click(screen.getByTestId("assistant-confirm"));
    await screen.findByTestId("assistant-outcome");
    expect(screen.queryByTestId("assistant-confirm-panel")).not.toBeInTheDocument();
    await asks(user);
    expect(starts()).toHaveLength(1);
    expect(screen.getByTestId("assistant-confirm-panel")).toBeInTheDocument();
  });
});

describe("the four results", () => {
  const confirmed = async () => {
    const user = userEvent.setup();
    await open();
    await asks(user);
    await user.click(screen.getByTestId("assistant-confirm"));
    return screen.findByTestId("assistant-outcome");
  };

  it("started and checked: the status and the rows take the check's own value, with its own time and source", async () => {
    const before = existingTeamReadOnly();
    const outcome = await confirmed();
    expect(outcome).toHaveAttribute("data-kind", "started");
    expect(outcome.textContent).toContain(T.started.split("{time}")[0]);
    expect(screen.getByTestId("assistant-status")).toHaveAttribute("data-running", "yes");
    expect(within(card()).queryByTestId("assistant-activate")).not.toBeInTheDocument();
    const after = existingTeamReadOnly()!;
    expect(after.assistantActive).toBe(true);
    expect(after.connection).toMatchObject({ assistantRunning: true, captainRunning: true, source: "assistant_start" });
    expect(after.connection!.at).toBeGreaterThan(before!.connection!.at);
    // the rows are the check's, not the connection's, and say so
    expect(screen.getByTestId("team-status-assistantRunning")).toHaveAttribute("data-value", "yes");
    expect(screen.getByTestId("team-status-assistantRunning-source").textContent).toContain(S.atAssistantStart.split("{time}")[0]);
    expect(screen.getByTestId("team-status-actions").textContent).toContain(S.actionsAfterStart.split("{time}")[0]);
  });

  it("already running: says no command was sent, and takes the check's value", async () => {
    startReply = async () => ({ outcome: "already_active", captainRunning: true, assistantRunning: true });
    const outcome = await confirmed();
    expect(outcome).toHaveAttribute("data-kind", "already_active");
    expect(outcome.textContent).toContain(T.alreadyActive.split("{time}")[0]);
    expect(existingTeamReadOnly()!.connection).toMatchObject({ assistantRunning: true, source: "assistant_start" });
  });

  it("timed out: says so with the code, enables nothing and does not send the command again", async () => {
    startReply = async () => { throw { code: "assistant_verify_timeout" }; };
    const before = existingTeamReadOnly();
    const outcome = await confirmed();
    expect(outcome).toHaveAttribute("data-kind", "timeout");
    expect(outcome).toHaveAttribute("role", "alert");
    expect(outcome.textContent).toContain("assistant_verify_timeout");
    expect(outcome.textContent).toContain(T.timedOut.split("{code}")[1].slice(0, 20));
    // nothing was promoted: same store, same status, the action is still on offer
    expect(existingTeamReadOnly()).toBe(before);
    expect(screen.getByTestId("assistant-status")).toHaveAttribute("data-running", "no");
    expect(within(card()).getByTestId("assistant-activate")).toBeInTheDocument();
    expect(screen.getByTestId("team-status-assistantRunning")).toHaveAttribute("data-value", "no");
    expect(starts()).toHaveLength(1);
  });

  it("failed: says so with the real code and its sentence, and enables nothing", async () => {
    startReply = async () => { throw { code: "existing_team_identity_mismatch" }; };
    const before = existingTeamReadOnly();
    const outcome = await confirmed();
    expect(outcome).toHaveAttribute("data-kind", "error");
    expect(outcome.textContent).toContain("existing_team_identity_mismatch");
    expect(existingTeamReadOnly()).toBe(before);
    expect(screen.getByTestId("assistant-status")).toHaveAttribute("data-running", "no");
  });

  it("a reply that is not whole is a bad reply and enables nothing", async () => {
    startReply = async () => ({ outcome: "started", captainRunning: true, assistantRunning: false });
    const before = existingTeamReadOnly();
    const outcome = await confirmed();
    expect(outcome.textContent).toContain("desktop_bad_reply");
    expect(existingTeamReadOnly()).toBe(before);
  });

  it("a refresh after a failed start still reads the connection's value, never a promoted one", async () => {
    const user = userEvent.setup();
    startReply = async () => { throw { code: "assistant_verify_timeout" }; };
    await confirmed();
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: S.refresh }));
    await waitFor(() => expect(native.invoke.mock.calls.filter(([c]) => c === "onboarding_resume_snapshot").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("team-status-assistantRunning")).toHaveAttribute("data-value", "no");
    expect(starts()).toHaveLength(1);
  });
});
