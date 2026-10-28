import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { tomorrowAtEightUtc } from "../../lib/agent-control";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import { READ_ONLY_NAV, READ_ONLY_ROUTES, ROUTES } from "../../shell/routes";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import type { Locale } from "@/i18n/config";
import { pluralText } from "../../lib/plural";
import AgentsPanel, { identityLine, LIST_REFRESH_LOCAL_MS, LIST_REFRESH_VPS_MS, TerminalText } from "./AgentsPanel";
import { isDirectChatAgentId } from "../messages/DirectChatScreen";
import { START_READ_WAITS } from "../../shell/StartTeamAction";
import { AGENTS_PANEL_TEXT, type AgentsPanelText } from "./AgentsPanel.i18n";

// «Agenti»: the agents' control panel, against a stand-in native side
// (agent_control). Synthetic data only.
// Channel: the start button's progress channel (resumeOnboardingTeamStart) is made with it
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), Channel: class { onmessage: unknown = null } }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));

const COMMAND = "agent_control";
const NOW_S = Math.floor(Date.now() / 1000);
const agent = (name: string, role: string, instance: string | null, state: string, extra: Record<string, unknown> = {}) => ({
  name, role, instance, up: true, created: NOW_S - 3600, activity: NOW_S - 600, state, reason: null, since: null, until: null, ...extra,
});
const ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer", "dottore", "mantenitore"]
  .map((role) => ({ role, multi: ["scout", "analista", "scorer", "scrittore", "closer", "critico"].includes(role) }));
const AGENTS = [
  agent("CAPITANO", "capitano", null, "lavora"),
  agent("SCOUT-1", "scout", "1", "idle"),
  agent("SCORER-1", "scorer", "1", "bloccato", { reason: "limite_5h" }),
  agent("ASSISTENTE", "assistente", null, "aspetta_umano"),
  agent("DOTTORE", "dottore", null, "idle"),
];
let target = "T1";
let where: "vps" | "local" = "vps";
let held: { session: string; byUser: boolean }[] = [];
let standby = { state: "off", until: null as string | null, weeklyReset: false };
let burnIntent: Record<string, unknown> | undefined;
let actionReply: Record<string, unknown> = { ok: true, data: { result: "stopped" } };
let ownVps: string | undefined;
let historyReply: Record<string, unknown> | null = null;
const listReply = () => ({
  ok: true,
  data: { agents: AGENTS, roles: ROLES, states: true, target, where, label: "vps.example", ...(ownVps ? { ownVps } : {}) },
});
const ops = () => native.invoke.mock.calls.filter(([c]) => c === COMMAND).map(([, a]) => (a as { request: Record<string, unknown> }).request);
const ACTIONS = new Set(["start", "stop", "restart", "pause", "resume", "stop_team", "answer"]);

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  target = "T1";
  where = "vps";
  held = [];
  standby = { state: "off", until: null, weeklyReset: false };
  burnIntent = undefined;
  actionReply = { ok: true, data: { result: "stopped" } };
  ownVps = undefined;
  historyReply = null;
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this environment: the panel starts on the list all the same
  }
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
    if (command === "own_vps_claim") {
      ownVps = "marked";
      return undefined;
    }
    if (command !== COMMAND) return { ok: false, error: "not_in_test" };
    const { op } = args.request;
    if (op === "list") return listReply();
    if (op === "team") return { ok: true, data: { halted: false, standby, held, ...(burnIntent ? { burnIntent } : {}) } };
    if (op === "screen") return { ok: true, data: { name: args.request.session, up: true, text: "<b>not html</b>\nworking" } };
    if (op === "history") return historyReply ?? { ok: false, error: "agent_control_unsupported" };
    return actionReply;
  });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network"); }));
  restoreBridge = installApiBridge(shellApi(notInDesktop));
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.unstubAllGlobals();
});

const show = (search = "") => render(<AgentsPanel params={{}} search={new URLSearchParams(search)} />);

describe("«Agenti», the agents' control panel", () => {
  it("is the agents page of the full shell and of the read-only view", () => {
    expect(ROUTES.find((r) => r.path === "/agents")?.page).toBe(AgentsPanel);
    expect(READ_ONLY_ROUTES.find((r) => r.path === "/agents")?.page).toBe(AgentsPanel);
    expect(READ_ONLY_NAV.map((n) => n.href)).toContain("/agents");
  });

  it("lists who needs the person first, then who works, the idle, and the off ones last", async () => {
    show();
    await screen.findByTestId("panel-summary");
    const order = screen.getAllByTestId(/^panel-row-/).map((row) => row.getAttribute("data-testid")!.replace("panel-row-", ""));
    expect(order.slice(0, 5)).toEqual(["ASSISTENTE", "SCORER-1", "CAPITANO", "SCOUT-1", "DOTTORE"]);
    // a role with no session is there, off, after the ones that are up
    expect(order.indexOf("ANALISTA-1")).toBeGreaterThan(order.indexOf("DOTTORE"));
    expect(screen.getByTestId("panel-row-ANALISTA-1")).toHaveAttribute("data-state", "down");
    // one person waiting is singular, five up are plural
    expect(screen.getByTestId("panel-summary")).toHaveTextContent(/^1 ti aspetta · 1 al lavoro · 5 accesi su \d+ · /);
    expect(screen.getByTestId("panel-row-SCORER-1")).toHaveTextContent("limite di 5 ore");
  });

  it("says the summary's counts in the singular or the plural, in every language", () => {
    for (const [locale, text] of Object.entries(AGENTS_PANEL_TEXT) as [Locale, AgentsPanelText][]) {
      for (const forms of [text.summaryWaiting, text.summaryWorking, text.summaryUp]) {
        expect(forms.one, locale).toContain("{count}");
        expect(forms.other, locale).toContain("{count}");
      }
      expect(text.summaryUp.one, locale).toContain("{total}");
      expect(text.summaryUp.other, locale).toContain("{total}");
    }
    const italian = AGENTS_PANEL_TEXT.it;
    expect(pluralText("it", 1, italian.summaryWaiting)).toBe("1 ti aspetta");
    expect(pluralText("it", 2, italian.summaryWaiting)).toBe("2 ti aspettano");
    expect(pluralText("it", 1, italian.summaryUp, { total: 13 })).toBe("1 acceso su 13");
    expect(pluralText("de", 1, AGENTS_PANEL_TEXT.de.summaryWaiting)).toBe("1 wartet auf dich");
    expect(pluralText("fr", 3, AGENTS_PANEL_TEXT.fr.summaryWaiting)).toBe("3 vous attendent");
  });

  it("stops an agent only after the confirmation, which names the VPS, and sends back the list's target", async () => {
    show("agent=SCOUT-1");
    fireEvent.click(await screen.findByTestId("panel-stop"));
    const dialog = screen.getByTestId("panel-confirm");
    expect(dialog).toHaveTextContent("Spegnere Scout-1 sulla VPS vps.example?");
    expect(dialog).toHaveTextContent("resta spento finché non lo riaccendi");
    expect(ops().filter((r) => ACTIONS.has(String(r.op)))).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferma" }));
    expect(await screen.findByTestId("panel-notice")).toHaveTextContent("Scout-1 è spento e resta spento");
    expect(ops().filter((r) => ACTIONS.has(String(r.op)))).toEqual([{ op: "stop", session: "SCOUT-1", target: "T1", confirmed: true }]);
  });

  it("an action goes with the target of the list on screen: after a new read, the new one", async () => {
    show("agent=SCOUT-1");
    await screen.findByTestId("panel-stop");
    target = "T2";
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));
    await waitFor(() => expect(ops().filter((r) => r.op === "list")).toHaveLength(2));
    fireEvent.click(await screen.findByTestId("panel-restart"));
    fireEvent.click(within(screen.getByTestId("panel-confirm")).getByRole("button", { name: "Conferma" }));
    await screen.findByTestId("panel-notice");
    expect(ops().filter((r) => ACTIONS.has(String(r.op)))).toEqual([{ op: "restart", session: "SCOUT-1", target: "T2", confirmed: true }]);
  });

  it("a refusal is said on the agent's row and in its bar, with the catalog's sentence", async () => {
    actionReply = { ok: false, error: "existing_team_runtime_target_changed" };
    show("agent=SCOUT-1");
    fireEvent.click(await screen.findByTestId("panel-stop"));
    fireEvent.click(within(screen.getByTestId("panel-confirm")).getByRole("button", { name: "Conferma" }));
    const notice = await screen.findByTestId("panel-notice");
    expect(notice).toHaveTextContent(describeError("existing_team_runtime_target_changed", { locale: "it" }).text);
    expect(notice).toHaveAttribute("role", "alert");
  });

  it("the captain's stop says what stops with it, and the restart is not red but the stop is", async () => {
    show("agent=CAPITANO");
    expect(await screen.findByTestId("panel-stop")).toHaveStyle({ color: "var(--color-red)" });
    expect(screen.getByTestId("panel-restart")).not.toHaveStyle({ color: "var(--color-red)" });
    fireEvent.click(screen.getByTestId("panel-stop"));
    expect(screen.getByTestId("panel-confirm")).toHaveTextContent("si ferma il coordinamento");
  });

  it("an agent the team put in safety cannot be started from here; one stopped by the person can", async () => {
    held = [{ session: "SCOUT-2", byUser: false }, { session: "ANALISTA-1", byUser: true }];
    show("agent=SCOUT-2");
    await screen.findByTestId("panel-row-SCOUT-2");
    expect(screen.getByTestId("panel-state")).toHaveTextContent("messo in sicurezza dalla squadra");
    expect(screen.queryByTestId("panel-start")).toBeNull();
    fireEvent.click(screen.getByTestId("panel-row-ANALISTA-1"));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("spento da te");
    expect(screen.getByTestId("panel-start")).toBeInTheDocument();
  });

  it("maintenance agents are shown without controls", async () => {
    show("agent=DOTTORE");
    await screen.findByTestId("panel-state");
    expect(screen.queryByTestId("panel-stop")).toBeNull();
    expect(screen.queryByTestId("panel-restart")).toBeNull();
  });

  it("pauses the team until tomorrow at 8 of the person's own day, sent in UTC", async () => {
    show();
    fireEvent.click(await screen.findByTestId("panel-pause"));
    fireEvent.click(screen.getByLabelText("Fino a domani alle 8"));
    actionReply = { ok: true, data: { result: "paused" } };
    fireEvent.click(within(screen.getByTestId("panel-confirm")).getByRole("button", { name: "Conferma" }));
    await screen.findByText("La squadra è in pausa.");
    const [pause] = ops().filter((r) => r.op === "pause");
    expect(pause).toEqual({ op: "pause", exit: { kind: "until", until: tomorrowAtEightUtc() }, target: "T1", confirmed: true });
    expect(String((pause.exit as { until: string }).until)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  });

  it("a paused team offers to resume it, and says until when", async () => {
    standby = { state: "active", until: null, weeklyReset: true };
    show();
    expect(await screen.findByTestId("panel-team-state")).toHaveTextContent("in pausa fino al reset del limite settimanale");
    expect(screen.getByTestId("panel-resume")).toBeInTheDocument();
  });

  it("JHT-T33: says that the full-throttle override is on, when it ends, and that it has ended", async () => {
    burnIntent = { state: "active", expiresAt: "2026-10-21T22:30:00+00:00", remainingMin: 240 };
    const first = show();
    const on = await screen.findByTestId("panel-burn-intent");
    expect(on).toHaveTextContent("A tutto gas fino alle");
    expect(on).toHaveTextContent("restano 240 min");
    first.unmount();

    // Within the hour it says so, and how to go on.
    burnIntent = { state: "active", expiresAt: "2026-10-21T22:30:00+00:00", remainingMin: 59 };
    const second = show();
    expect(await screen.findByTestId("panel-burn-intent")).toHaveTextContent("finisce tra 59 min");
    expect(screen.getByTestId("panel-burn-intent")).toHaveTextContent("Capitano di rinnovarlo");
    second.unmount();

    burnIntent = { state: "expired", expiresAt: "2026-10-21T22:30:00+00:00", remainingMin: 0 };
    show();
    expect(await screen.findByTestId("panel-burn-intent")).toHaveTextContent("Il tutto gas è finito: la squadra è tornata al ritmo normale");
  });

  it("JHT-T33: says nothing about the override when it is off or when the image does not report it", async () => {
    burnIntent = { state: "off", expiresAt: null, remainingMin: null };
    const off = show();
    await screen.findByTestId("panel-team-state");
    expect(screen.queryByTestId("panel-burn-intent")).toBeNull();
    off.unmount();

    burnIntent = undefined;
    show();
    await screen.findByTestId("panel-team-state");
    expect(screen.queryByTestId("panel-burn-intent")).toBeNull();
  });

  it("shows the terminal as text, read when shown", async () => {
    show("agent=SCOUT-1");
    const terminal = await screen.findByTestId("panel-terminal-SCOUT-1");
    expect(terminal.textContent).toBe("<b>not html</b>\nworking");
    expect(terminal.querySelector("b")).toBeNull();
    expect(ops().filter((r) => r.op === "screen")).toEqual([{ op: "screen", session: "SCOUT-1" }]);
  });

  it("has no chat of its own: «Chatta con» opens Messages with that agent chosen, and the terminal is the page", async () => {
    show("agent=CAPITANO");
    const button = await screen.findByTestId("panel-chat-with");
    expect(button).toHaveTextContent("Chatta con Capitano");
    expect(button).toHaveAttribute("href", "#/messages?agent=capitano");
    expect(screen.getByTestId("panel-detail")).toContainElement(button);
    // no chat in the page, no second way to open one
    expect(screen.queryByTestId("panel-chat-pane")).toBeNull();
    expect(screen.queryByTestId("direct-chat-shell")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByTestId("agent-chat-open-full")).toBeNull();
    expect(screen.queryByText("Apri a tutta pagina")).toBeNull();
    // the terminal is not folded away: it is read at once, and it says where to write
    await screen.findByTestId("panel-terminal-CAPITANO");
    expect(screen.queryByTestId("panel-terminal-toggle")).toBeNull();
    expect(screen.getByTestId("panel-terminal-destination")).toHaveTextContent(
      "Nel terminale non si scrive: è solo da guardare. Per scrivere a Capitano usa «Chatta con Capitano».",
    );
    expect(window.localStorage.getItem("jht.agents.terminal")).toBeNull();
    // the controls stay
    expect(screen.getByTestId("panel-stop")).toBeInTheDocument();
    expect(screen.getByTestId("panel-restart")).toBeInTheDocument();
  });

  it("the button leads to Messages with the agent already selected", async () => {
    show("agent=SCOUT-1");
    fireEvent.click(await screen.findByTestId("panel-chat-with"));
    expect(window.location.hash).toBe("#/messages?agent=scout");
  });

  it("every agent Messages lists has «Chatta con», by its role, and the others have none", async () => {
    // Messages' own rule (isDirectChatAgentId), not a list of this page: counted over every role of the team
    const expected = ROLES.map((r) => r.role).filter((role) => isDirectChatAgentId(role));
    expect(expected).toEqual(["capitano", "scout", "analista", "scorer", "scrittore", "critico", "assistente", "mentor"]);
    for (const { role, multi } of ROLES) {
      // the critic is a single session, as in the panel (SINGLE); the multiple roles have their first
      const session = multi && role !== "critico" ? `${role.toUpperCase()}-1` : role.toUpperCase();
      show(`agent=${session}`);
      await screen.findByTestId("panel-detail");
      if (isDirectChatAgentId(role)) {
        expect(screen.getByTestId("panel-chat-with")).toHaveAttribute("href", `#/messages?agent=${role}`);
      } else {
        expect(screen.queryByTestId("panel-chat-with"), session).toBeNull();
        await screen.findByTestId("panel-terminal-destination").catch(() => undefined);
      }
      cleanup();
    }
  });

  it("the button is in every language, with the agent's name as Messages writes it", async () => {
    const names = { it: "Chatta con Scout", en: "Chat with Scout", de: "Mit Scout chatten", es: "Chatear con Scout", fr: "Discuter avec Scout", hu: "Csevegés vele: Felderítő", pt: "Conversar com Scout" } as const;
    for (const [locale, label] of Object.entries(names)) {
      document.cookie = `NEXT_LOCALE=${locale}; path=/`;
      show("agent=SCOUT-1");
      expect(await screen.findByTestId("panel-chat-with")).toHaveTextContent(label);
      cleanup();
    }
  });

  it("an agent Messages does not list has the terminal alone, with no word of chat", async () => {
    show("agent=DOTTORE");
    await screen.findByTestId("panel-terminal-DOTTORE");
    expect(screen.queryByTestId("panel-chat-with")).toBeNull();
    expect(screen.getByTestId("panel-terminal-destination")).toHaveTextContent(/^Nel terminale non si scrive: è solo da guardare\.$/);
  });

  it("in the read-only view: no control at all, and only reads reach the native side", async () => {
    enterExistingTeamReadOnly(false);
    navigate("/agents?agent=SCOUT-1", { replace: true });
    render(<Shell />);
    expect(await screen.findByTestId("panel-read-only")).toHaveTextContent("Conferma e collega");
    await screen.findByTestId("panel-terminal-SCOUT-1");
    for (const id of ["panel-stop", "panel-restart", "panel-start", "panel-pause", "panel-resume"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getByRole("link", { name: "Agenti" })).toHaveAttribute("aria-current", "page");
    expect(ops().every((r) => ["list", "team", "screen", "history"].includes(String(r.op)))).toBe(true);
    expect(fake.current!.calls).toEqual([]);
  });

  it("in the read-only view «Chatta con» is there and leads to a Messages that only reads", async () => {
    expect(READ_ONLY_ROUTES.find((r) => r.path === "/messages")?.page).toBe(ROUTES.find((r) => r.path === "/messages")?.page);
    enterExistingTeamReadOnly(false);
    navigate("/agents?agent=CAPITANO", { replace: true });
    render(<Shell />);
    const button = await screen.findByTestId("panel-chat-with");
    expect(button).toHaveAttribute("href", "#/messages?agent=capitano");
    expect(screen.queryByTestId("panel-chat-pane")).toBeNull();
  });

  it("a VPS of one's own without the mark offers the claim, and writes only after the person confirmed it", async () => {
    ownVps = "claimable";
    show();
    const invite = await screen.findByTestId("own-vps-invite");
    expect(invite).toHaveTextContent("per comandarla o scriverle devi confermare che è la tua");
    expect(native.invoke.mock.calls.some(([c]) => c === "own_vps_claim")).toBe(false);
    fireEvent.click(within(invite).getByTestId("own-vps-claim"));
    // the dialog says what the confirmation allows, and nothing has gone to the native side yet
    expect(within(invite).getByTestId("own-vps-confirm")).toHaveTextContent("scrivere ai tuoi agenti su questa VPS");
    expect(native.invoke.mock.calls.some(([c]) => c === "own_vps_claim")).toBe(false);
    fireEvent.click(within(invite).getByTestId("own-vps-confirm-yes"));
    await waitFor(() => expect(screen.queryByTestId("own-vps-invite")).toBeNull());
    expect(native.invoke).toHaveBeenCalledWith("own_vps_claim", { request: { confirmed: true } });
  });

  it("cancelling the claim sends nothing; a marked VPS or a changed key asks what each asks", async () => {
    ownVps = "claimable";
    show();
    fireEvent.click(within(await screen.findByTestId("own-vps-invite")).getByTestId("own-vps-claim"));
    fireEvent.click(screen.getByTestId("own-vps-cancel"));
    expect(screen.queryByTestId("own-vps-confirm")).toBeNull();
    expect(native.invoke.mock.calls.some(([c]) => c === "own_vps_claim")).toBe(false);
    cleanup();
    ownVps = "key_changed";
    show();
    expect(await screen.findByTestId("own-vps-invite")).toHaveTextContent("La chiave di questa VPS è cambiata");
    cleanup();
    for (const state of ["marked", "not_own", undefined]) {
      ownVps = state;
      show();
      await screen.findByTestId("panel-summary");
      expect(screen.queryByTestId("own-vps-invite")).toBeNull();
      cleanup();
    }
  });

  it("a refused claim says why with the catalog's sentence and the invitation stays", async () => {
    ownVps = "claimable";
    const base = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command === "own_vps_claim") throw "own_vps_claim_refused";
      return base(command, args);
    });
    show();
    fireEvent.click(within(await screen.findByTestId("own-vps-invite")).getByTestId("own-vps-claim"));
    fireEvent.click(screen.getByTestId("own-vps-confirm-yes"));
    expect(await screen.findByTestId("own-vps-failure")).toHaveTextContent(describeError("own_vps_claim_refused", { locale: "it" }).text);
    expect(screen.getByTestId("own-vps-invite")).toBeInTheDocument();
  });

  it("the read-only view of an existing team never offers the claim", async () => {
    ownVps = "claimable";
    enterExistingTeamReadOnly(false);
    navigate("/agents", { replace: true });
    render(<Shell />);
    await screen.findByTestId("panel-read-only");
    await screen.findByTestId("panel-summary");
    expect(screen.queryByTestId("own-vps-invite")).toBeNull();
  });

  it("a failed read says why, with the catalog's sentence", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "agent_control_no_team" }));
    show();
    const alert = await screen.findByTestId("panel-error");
    expect(alert).toHaveTextContent(describeError("agent_control_no_team", { locale: "it" }).text);
    // told by the catalog's sentence alone: the raw code is not on screen
    expect(alert).not.toHaveTextContent("agent_control_no_team");
  });

  it("keeps the code of a failure the catalog has no sentence for, so that a report can name it", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "code_the_catalog_does_not_know" }));
    show();
    expect(await screen.findByTestId("panel-error")).toHaveTextContent("(code_the_catalog_does_not_know)");
  });

  it("with no team running it offers «Avvia la squadra», and reads again once the team is up", async () => {
    let up = false;
    native.invoke.mockImplementation(async (command: string, args: { request?: Record<string, unknown> }) => {
      if (command === "onboarding_resume_team_start") {
        up = true;
        return {};
      }
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      if (!up) return { ok: false, error: "agent_control_no_team" };
      const op = args.request?.op;
      if (op === "list") return listReply();
      if (op === "team") return { ok: true, data: { halted: false, standby, held } };
      return { ok: false, error: "agent_control_unsupported" };
    });
    show();
    await screen.findByTestId("panel-error");
    fireEvent.click(await screen.findByTestId("start-team"));
    await screen.findByTestId("panel-summary");
    expect(screen.queryByTestId("panel-error")).toBeNull();
    expect(native.invoke.mock.calls.filter(([c]) => c === "onboarding_resume_team_start")).toHaveLength(1);
  });

  it("reads the agents again by itself when the first read after the start finds nothing yet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let up = false;
      let lists = 0;
      native.invoke.mockImplementation(async (command: string, args: { request?: Record<string, unknown> }) => {
        if (command === "onboarding_resume_team_start") {
          up = true;
          return {};
        }
        if (command !== COMMAND) return { ok: false, error: "not_in_test" };
        const op = args.request?.op;
        if (op === "list") {
          lists++;
          return up && lists >= 3 ? listReply() : { ok: false, error: "agent_control_no_team" };
        }
        if (op === "team") return { ok: true, data: { halted: false, standby, held } };
        return { ok: false, error: "agent_control_unsupported" };
      });
      show();
      await screen.findByTestId("panel-error");
      fireEvent.click(await screen.findByTestId("start-team"));
      // the first read after the start is too early: the page asks again after a few seconds, with no Refresh
      await waitFor(() => expect(lists).toBe(2));
      expect(screen.getByTestId("panel-error")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      await screen.findByTestId("panel-summary");
      expect(lists).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("after «Avvia la squadra» the page waits for the flag «stopped by you» to fall", () => {
    /** The native side of a team that answers the list at once but lifts the stop only after `lifts` reads of the team. */
    function stopLifting(lifts: number) {
      let up = false;
      const seen = { lists: 0, teams: 0 };
      native.invoke.mockImplementation(async (command: string, args: { request?: Record<string, unknown> }) => {
        if (command === "onboarding_resume_team_start") {
          up = true;
          return {};
        }
        if (command !== COMMAND) return { ok: false, error: "not_in_test" };
        const op = args.request?.op;
        if (!up) return { ok: false, error: "agent_control_no_team" };
        if (op === "list") {
          seen.lists++;
          return listReply();
        }
        if (op === "team") {
          seen.teams++;
          return { ok: true, data: { halted: seen.teams <= lifts, standby, held } };
        }
        return { ok: false, error: "agent_control_unsupported" };
      });
      return seen;
    }

    it("keeps reading until the team no longer shows as stopped, with no Refresh, and keeps the button meanwhile", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const seen = stopLifting(3);
        show();
        await screen.findByTestId("panel-error");
        fireEvent.click(await screen.findByTestId("start-team"));
        // the list answers, the team still shows as stopped by the person: the page says so and keeps the button
        expect(await screen.findByText(/Squadra fermata da te/)).toBeInTheDocument();
        expect(screen.getByTestId("start-team")).toBeInTheDocument();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(await screen.findByText(/Squadra attiva/)).toBeInTheDocument();
        expect(screen.queryByText(/Squadra fermata da te/)).toBeNull();
        expect(screen.queryByTestId("start-team")).toBeNull();
        expect(seen.teams).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up after five more tries when the team stays stopped, and leaves the page as it read it", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const seen = stopLifting(1_000);
        show();
        await screen.findByTestId("panel-error");
        fireEvent.click(await screen.findByTestId("start-team"));
        await screen.findByText(/Squadra fermata da te/);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        // the read of the start's end, then five more; the first read of the page (no team) had no team to read
        expect(seen.teams).toBe(6);
        expect(screen.getByText(/Squadra fermata da te/)).toBeInTheDocument();
        expect(screen.queryByTestId("start-team")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("offers the start only where the sentence says the team is stopped", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "agent_control_read_only" }));
    show();
    await screen.findByTestId("panel-error");
    expect(screen.queryByTestId("start-team")).toBeNull();
  });
});

describe("«until tomorrow at 8» is the person's own 8 o'clock (N1)", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });
  it.each([
    ["Europe/Rome", "2026-10-19T13:00:00Z", "2026-10-20T06:00:00Z"],
    ["America/New_York", "2026-10-19T15:00:00Z", "2026-10-20T12:00:00Z"],
    ["Asia/Tokyo", "2026-10-19T20:00:00Z", "2026-10-20T23:00:00Z"],
    ["UTC", "2026-10-19T23:30:00Z", "2026-10-20T08:00:00Z"],
  ])("in %s, at %s, it is %s", (zone, now, expected) => {
    process.env.TZ = zone;
    expect(tomorrowAtEightUtc(new Date(now))).toBe(expected);
  });
});

describe("«Agenti», how a row reads", () => {
  it("shows and counts an agent whose state says off as off, like a row with no session", async () => {
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      if (args.request.op === "list")
        return { ok: true, data: { agents: [...AGENTS, agent("MENTOR", "mentor", null, "spento")], roles: ROLES, states: true, target, where: "vps", label: "vps.example" } };
      if (args.request.op === "team") return { ok: true, data: { halted: false, standby, held } };
      return { ok: true, data: { name: args.request.session, up: true, text: "" } };
    });
    show();
    await screen.findByTestId("panel-summary");
    // five up, as without MENTOR: an agent off is not up
    expect(screen.getByTestId("panel-summary")).toHaveTextContent(/· 5 accesi su /);
    const mentor = screen.getByTestId("panel-row-MENTOR");
    const absent = screen.getByTestId("panel-row-ANALISTA-1");
    // the same words as a role with no session
    expect(within(mentor).getByText(within(absent).getByText(/spento/).textContent!)).toBeInTheDocument();
  });

  it("says the last activity as how long ago, the full date in the tooltip", async () => {
    show();
    await screen.findByTestId("panel-summary");
    fireEvent.click(screen.getByTestId("panel-row-CAPITANO"));
    const times = await screen.findByTestId("panel-times");
    // the fixture's activity is ten minutes ago
    expect(times).toHaveTextContent("ultima attività 10m fa");
    expect(times.getAttribute("title")).toMatch(/ultima attività \d{2}\/\d{2}\/\d{2}/);
  });

  it("lets a long state wrap in the list instead of cutting it", async () => {
    show();
    await screen.findByTestId("panel-summary");
    const blocked = within(screen.getByTestId("panel-row-SCORER-1")).getByText(/limite di 5 ore/);
    expect(blocked.className).not.toMatch(/\btruncate\b/);
    expect(blocked.className).toMatch(/break-words/);
  });
});

describe("«Agenti», each agent's health in small", () => {
  const usage = (fields: Record<string, number | null>) => ({
    contextPct: null, contextTokens: null, contextWindow: null, contextAt: null, tokensHour: null, tokensAt: null, ...fields,
  });
  beforeEach(() => {
    const agents = [
      agent("CAPITANO", "capitano", null, "lavora", {
        usage: usage({ contextPct: 42.5, contextTokens: 109820, contextWindow: 258400, contextAt: NOW_S - 60, tokensHour: 12345, tokensAt: NOW_S - 120 }),
      }),
      // read and zero for the hour, the context not said (a CLI that writes no window and no call yet)
      agent("SCOUT-1", "scout", "1", "idle", { usage: usage({ tokensHour: 0, tokensAt: NOW_S - 120 }) }),
      agent("SCORER-1", "scorer", "1", "lavora", { usage: usage({ contextPct: 91, contextAt: NOW_S - 60 }) }),
      // an image older than this read: no usage at all
      agent("ASSISTENTE", "assistente", null, "idle"),
    ];
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      if (args.request.op === "list") return { ...listReply(), data: { ...listReply().data, agents } };
      if (args.request.op === "team") return { ok: true, data: { halted: false, standby, held } };
      return { ok: true, data: { name: args.request.session, up: true, text: "" } };
    });
  });

  it("says context and tokens of the hour next to the state, and «?» where the team does not say them, never 0", async () => {
    show();
    await screen.findByTestId("panel-summary");
    const short = (session: string) => within(screen.getByTestId(`panel-row-${session}`)).getByTestId("panel-usage-short");
    expect(short("CAPITANO")).toHaveTextContent("ctx 43% · 12,3K/h");
    expect(short("SCOUT-1")).toHaveTextContent("ctx ? · 0/h");
    expect(short("ASSISTENTE")).toHaveTextContent("ctx ? · ?/h");
    // a context near full stands out
    expect(within(short("SCORER-1")).getByText("ctx 91%")).toHaveStyle({ color: "var(--color-yellow)" });
    expect(within(short("CAPITANO")).getByText("ctx 43%")).not.toHaveStyle({ color: "var(--color-yellow)" });
    // the detail on hover: the whole numbers, when they were read, how they are counted
    expect(short("CAPITANO").title).toContain("contesto usato 43% (109.820 token su 258.400)");
    expect(short("CAPITANO").title).toContain("12.345 token nell'ultima ora (contati dalla Sentinella alle");
    expect(short("CAPITANO").title).toContain("la parte già in cache non conta");
    expect(short("CAPITANO").title).not.toContain("non vuol dire zero");
    expect(short("ASSISTENTE").title).toContain("«Non so» non vuol dire zero");
    // an agent that is off says nothing of it
    expect(within(screen.getByTestId("panel-row-ANALISTA-1")).queryByTestId("panel-usage-short")).toBeNull();
  });

  it("says the whole sentences in the detail of the agent", async () => {
    show("agent=CAPITANO");
    // the bar says it in small, and the whole sentences are on hover
    expect(await screen.findByTestId("panel-bar-context")).toHaveTextContent("Contesto43%");
    expect(screen.getByTestId("panel-bar-usage")).toHaveTextContent("Consumo12,3K/h");
    expect(screen.getByTestId("panel-bar-context").title).toMatch(
      /^contesto usato 43% \(109\.820 token su 258\.400\) \(letto alle .+\)\n12\.345 token nell'ultima ora \(contati dalla Sentinella alle .+\)/,
    );
    cleanup();
    show("agent=SCOUT-1");
    expect(await screen.findByTestId("panel-bar-context")).toHaveTextContent("Contesto?");
    expect(screen.getByTestId("panel-bar-usage")).toHaveTextContent("Consumo0/h");
    expect(screen.getByTestId("panel-bar-usage").title).toMatch(/^contesto: non so\n0 token nell'ultima ora/);
  });

  it("has the same sentences, with their numbers, in every language", () => {
    for (const [locale, text] of Object.entries(AGENTS_PANEL_TEXT) as [Locale, AgentsPanelText][]) {
      expect(text.usageContextShort, locale).toContain("{pct}");
      expect(text.usageContextTokensShort, locale).toContain("{tokens}");
      expect(text.usageHourShort, locale).toContain("{tokens}");
      for (const key of ["{pct}", "{tokens}", "{window}"]) expect(text.usageContext, locale).toContain(key);
      expect(text.usageContextPct, locale).toContain("{pct}");
      expect(text.usageContextTokens, locale).toContain("{tokens}");
      expect(text.usageHour, locale).toContain("{tokens}");
      expect(text.usageReadAt, locale).toContain("{time}");
      expect(text.usageCountedAt, locale).toContain("{time}");
      // «not known» is never written as a zero
      for (const unknown of [text.usageContextUnknownShort, text.usageHourUnknownShort, text.usageContextUnknown, text.usageHourUnknown]) {
        expect(unknown, locale).not.toMatch(/\b0\b/);
      }
    }
  });
});

describe("«Agenti», stopping the whole team", () => {
  it("stops the team only after a confirmation that says what happens, on the team the panel controls", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    actionReply = { ok: true, data: { result: "team_stopped" } };
    show();
    await screen.findByTestId("panel-summary");
    // pause and stop side by side, and a line that tells them apart
    expect(screen.getByTestId("panel-pause")).toBeInTheDocument();
    expect(screen.getByTestId("panel-team-help")).toHaveTextContent("riparte da sola");
    expect(screen.getByTestId("panel-team-help")).toHaveTextContent("non riparte finché");
    fireEvent.click(screen.getByTestId("panel-stop-team"));
    const dialog = screen.getByTestId("panel-confirm");
    expect(dialog).toHaveTextContent("Fermare la squadra sulla VPS vps.example?");
    expect(dialog).toHaveTextContent("L’assistente resta acceso.");
    expect(ops().filter((r) => ACTIONS.has(String(r.op)))).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferma" }));
    // the native command, on the target the list gave: never the cloud's request, which only a
    // team linked to the cloud reads (JHT-T54)
    await waitFor(() => expect(ops().filter((r) => ACTIONS.has(String(r.op)))).toEqual([
      { op: "stop_team", target: "T1", confirmed: true },
    ]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("La squadra è ferma. L’assistente resta acceso.")).toBeInTheDocument();
  });

  it("says when the team was already stopped, and a stop that failed in the catalog's words", async () => {
    actionReply = { ok: true, data: { result: "team_already_stopped" } };
    show();
    await screen.findByTestId("panel-summary");
    fireEvent.click(screen.getByTestId("panel-stop-team"));
    fireEvent.click(within(screen.getByTestId("panel-confirm")).getByRole("button", { name: "Conferma" }));
    expect(await screen.findByText("La squadra era già ferma.")).toBeInTheDocument();
    cleanup();
    actionReply = { ok: false, error: "team_stop_failed" };
    show();
    await screen.findByTestId("panel-summary");
    fireEvent.click(screen.getByTestId("panel-stop-team"));
    fireEvent.click(within(screen.getByTestId("panel-confirm")).getByRole("button", { name: "Conferma" }));
    expect(await screen.findByText(/Non è stato possibile fermare la squadra/)).toBeInTheDocument();
  });

  it("offers no stop in the read-only view, nor on a team already stopped", async () => {
    enterExistingTeamReadOnly(false);
    show();
    await screen.findByTestId("panel-summary");
    expect(screen.queryByTestId("panel-stop-team")).toBeNull();
    leaveExistingTeamReadOnly();
    cleanup();
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      if (args.request.op === "list") return listReply();
      if (args.request.op === "team") return { ok: true, data: { halted: true, standby, held } };
      return { ok: true, data: { name: args.request.session, up: true, text: "" } };
    });
    show();
    await screen.findByTestId("panel-team-state");
    expect(screen.queryByTestId("panel-stop-team")).toBeNull();
    expect(screen.queryByTestId("panel-pause")).toBeNull();
  });
});

describe("«Agenti», who an agent is", () => {
  const it_ = AGENTS_PANEL_TEXT.it;

  it("says cli, model, effort and where, with «non so» for what the session does not say", () => {
    expect(identityLine(it_, { cli: "codex", model: "gpt-5.6-terra", effort: "high" }, "su questo computer")).toBe(
      "Codex · gpt-5.6-terra · effort alto · su questo computer",
    );
    expect(identityLine(it_, { cli: "claude", model: null, effort: null }, "sulla VPS vps.example")).toBe(
      "Claude · modello: non so · effort: non so · sulla VPS vps.example",
    );
    // kimi gets no model nor effort from the launcher: its own default, no effort part
    expect(identityLine(it_, { cli: "kimi", model: null, effort: null }, "su questo computer")).toBe("Kimi · modello predefinito · su questo computer");
    expect(identityLine(it_, { cli: "local", model: null, effort: null }, "")).toBe("scorer locale");
    // a session started before the launcher wrote it
    expect(identityLine(it_, null, "su questo computer")).toBe(it_.identityUnknown);
  });

  it("shows it under the state, and in the row's tooltip", async () => {
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      if (args.request.op === "list") {
        const agents = AGENTS.map((a) => (a.name === "CAPITANO" ? { ...a, identity: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } } : a));
        return { ok: true, data: { agents, roles: ROLES, states: true, target, where: "vps", label: "vps.example" } };
      }
      if (args.request.op === "team") return { ok: true, data: { halted: false, standby, held } };
      return { ok: true, data: { name: args.request.session, up: true, text: "" } };
    });
    show();
    await screen.findByTestId("panel-summary");
    expect(screen.getByTestId("panel-row-CAPITANO")).toHaveAttribute("title", "Codex · gpt-5.6-sol · effort alto · sulla VPS vps.example");
    fireEvent.click(screen.getByTestId("panel-row-CAPITANO"));
    expect(await screen.findByTestId("panel-bar-provider")).toHaveTextContent("ProviderCodex");
    expect(screen.getByTestId("panel-bar-model")).toHaveTextContent("Modellogpt-5.6-sol · effort alto");
    expect(screen.getByTestId("panel-bar-model")).toHaveAttribute("title", "Codex · gpt-5.6-sol · effort alto · sulla VPS vps.example");
    fireEvent.click(screen.getByTestId("panel-row-SCOUT-1"));
    await waitFor(() => expect(screen.getByTestId("panel-bar-model")).toHaveTextContent(it_.identityUnknown));
  });

  it("has every language's words for it", () => {
    for (const [locale, text] of Object.entries(AGENTS_PANEL_TEXT)) {
      expect(text.identityEffort, locale).toContain("{effort}");
      for (const key of ["identityUnknown", "identityModelUnknown", "identityModelDefault", "identityEffortUnknown", "identityLocal", "effortLow", "effortMedium", "effortHigh"] as const) {
        expect(text[key].trim().length, `${locale} ${key}`).toBeGreaterThan(1);
      }
    }
  });

  it("is only shown: nothing the panel decides reads it", () => {
    // the agent can rewrite its session's options; actions, counts and order never look at them
    const source = readFileSync("src/pages/agents/AgentsPanel.tsx", "utf-8");
    const lines = source.split("\n").filter((line) => /identity/i.test(line));
    const allowed = [/AgentIdentity/, /IdentityParts/, /identityLine\(/, /identityParts\(/, /identity\.(cli|model|effort)/, /if \(!identity\) return null/, /if \(!parts\) return t\.identityUnknown/, /identity: AgentIdentity/];
    for (const line of lines) expect(allowed.some((re) => re.test(line)), line).toBe(true);
    expect(source.match(/identityLine\(t, /g)).toHaveLength(2);
  });
});

describe("«Agenti», the questions the agents asked the person", () => {
  const asked = (id: string, tipo: string, fields: Record<string, unknown> = {}) => ({
    id, tipo, oggetto: "CV per Acme", testo: "Quale CV uso per Acme?",
    opzioni: [{ id: "breve", label: "CV breve", reversibile: true }, { id: "_rinvia", label: "Rinvia, non fare niente", reversibile: true }],
    multipla: false, libera: false, scadenza: NOW_S + 3 * 3600 + 120, default: "_rinvia", at: NOW_S - 600, ...fields,
  });
  const free = (testo: string) => ({ id: null, tipo: null, oggetto: null, testo, opzioni: [], multipla: false, libera: true, scadenza: null, default: null, at: NOW_S - 900 });
  let agents: Record<string, unknown>[];
  beforeEach(() => {
    agents = [
      agent("CAPITANO", "capitano", null, "aspetta_umano", {
        questions: { open: 2, unread: 3, items: [asked("aq:capitano:1790000000-ab12cd", "blocco"), free("<b>not html</b> procedo?")] },
      }),
      // read, and none: a known zero
      agent("SCOUT-1", "scout", "1", "idle", { questions: { open: 0, unread: 0, items: [] } }),
      agent("SCORER-1", "scorer", "1", "lavora", {
        questions: { open: 1, unread: 150, items: [asked("aq:scorer:1790000000-cd34ef", "urgente", { scadenza: null, default: null })] },
      }),
      // an image older than this read: no questions at all
      agent("ASSISTENTE", "assistente", null, "idle"),
    ];
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      if (args.request.op === "list") return { ...listReply(), data: { ...listReply().data, agents } };
      if (args.request.op === "team") return { ok: true, data: { halted: false, standby, held } };
      return { ok: true, data: { name: args.request.session, up: true, text: "" } };
    });
  });

  it("counts the open questions at the top, and says when some agent does not say them", async () => {
    show();
    const summary = await screen.findByTestId("panel-questions-summary");
    expect(summary).toHaveTextContent("3 domande aperte (di alcuni agenti non so)");
    expect(summary.title).toContain("quelle di un agente spento non si contano");
  });

  it("says a known zero as zero, and «non so» when no agent says them", async () => {
    agents = [agent("SCOUT-1", "scout", "1", "idle", { questions: { open: 0, unread: 0, items: [] } })];
    show();
    expect(await screen.findByTestId("panel-questions-summary")).toHaveTextContent("0 domande aperte");
    cleanup();
    agents = [agent("SCOUT-1", "scout", "1", "idle")];
    show();
    expect(await screen.findByTestId("panel-questions-summary")).toHaveTextContent("domande: non so");
  });

  it("marks the row with the most urgent type and the unread count, and nothing where it is not known", async () => {
    show();
    await screen.findByTestId("panel-summary");
    const row = (session: string) => within(screen.getByTestId(`panel-row-${session}`));
    expect(row("CAPITANO").getByTestId("panel-question-mark")).toHaveAttribute("data-type", "blocco");
    expect(row("CAPITANO").getByTestId("panel-question-mark").title).toBe("2 domande aperte · blocco");
    expect(row("CAPITANO").getByTestId("panel-unread")).toHaveTextContent(/^3$/);
    expect(row("CAPITANO").getByTestId("panel-unread").title).toBe("3 messaggi non letti");
    expect(row("SCORER-1").getByTestId("panel-question-mark")).toHaveAttribute("data-type", "urgente");
    expect(row("SCORER-1").getByTestId("panel-question-mark")).toHaveStyle({ background: "var(--color-red)" });
    expect(row("SCORER-1").getByTestId("panel-unread")).toHaveTextContent("99+");
    for (const session of ["SCOUT-1", "ASSISTENTE", "ANALISTA-1"]) {
      expect(row(session).queryByTestId("panel-question-mark")).toBeNull();
      expect(row(session).queryByTestId("panel-unread")).toBeNull();
    }
  });

  it("lists the agent's questions in its detail, the agent's own words as plain text", async () => {
    show("agent=CAPITANO");
    const list = await screen.findByTestId("panel-questions");
    expect(list).toHaveTextContent(/^2 domande aperte · 3 messaggi non letti/);
    const [first, second] = within(list).getAllByTestId("panel-question");
    expect(first).toHaveAttribute("data-type", "blocco");
    expect(first).toHaveTextContent("blocco");
    expect(first).toHaveTextContent("CV per Acme");
    expect(first).toHaveTextContent("Quale CV uso per Acme?");
    // a structured question with one choice: its options are the buttons that answer it
    expect(within(first).getAllByTestId(/^panel-answer-/).map((button) => button.textContent)).toEqual(["CV breve", "Rinvia, non fare niente"]);
    expect(within(first).getByTestId("panel-question-expiry")).toHaveTextContent("scade fra 3 h, poi: Rinvia, non fare niente");
    expect(second).toHaveAttribute("data-type", "none");
    expect(second).toHaveTextContent("senza tipo");
    expect(second).toHaveTextContent("<b>not html</b> procedo?");
    expect(second.querySelector("b")).toBeNull();
    expect(within(list).getByTestId("panel-questions-messages")).toHaveAttribute("href", "#/messages?agent=capitano");
  });

  it("says «none» for a known zero and «non so» for an agent that does not say them", async () => {
    show("agent=SCOUT-1");
    expect(await screen.findByTestId("panel-questions")).toHaveTextContent(/^Nessuna domanda aperta$/);
    cleanup();
    show("agent=ASSISTENTE");
    const unknown = await screen.findByTestId("panel-questions");
    expect(unknown).toHaveTextContent("Domande: non so");
    expect(unknown.title).toContain("non vuol dire nessuna");
  });

  it("in the read-only view: no link to answer, it says where to answer", async () => {
    enterExistingTeamReadOnly(false);
    navigate("/agents?agent=CAPITANO", { replace: true });
    render(<Shell />);
    const list = await screen.findByTestId("panel-questions");
    expect(within(list).queryByTestId("panel-questions-messages")).toBeNull();
    expect(list).toHaveTextContent("rispondi da Telegram o dal web");
  });

  it("has every sentence and every type in every language", () => {
    for (const [locale, text] of Object.entries(AGENTS_PANEL_TEXT) as [Locale, AgentsPanelText][]) {
      for (const forms of [text.questionsOpen, text.unreadMessages, text.questionsMore]) {
        expect(forms.one, locale).not.toBe("");
        expect(forms.other, locale).toContain("{count}");
      }
      expect(text.questionsOpen.one, locale).toContain("{count}");
      expect(Object.keys(text.questionTypes).sort(), locale).toEqual(["blocco", "completamento", "comunicazione", "domanda", "urgente"]);
      expect(new Set(Object.values(text.questionTypes)).size, locale).toBe(5);
      expect(text.questionAskedAt, locale).toContain("{time}");
      expect(text.questionExpiresAt, locale).toContain("{time}");
      expect(text.questionExpiresMinutes, locale).toContain("{minutes}");
      expect(text.questionExpiresHours, locale).toContain("{hours}");
      expect(text.questionThen, locale).toContain("{option}");
      for (const key of ["questionsUnknown", "questionsPartlyUnknown", "questionsSummaryHelp", "questionTypeNone", "questionsUnknownDetail", "questionsUnknownWhy", "questionsNone", "questionsAnswerInMessages", "questionsAnswerElsewhere"] as const) {
        expect(text[key], `${locale} ${key}`).toMatch(/\S/);
      }
    }
  });

  it("only shows them: the panel's source names the questions only where it shows them", () => {
    const source = readFileSync("src/pages/agents/AgentsPanel.tsx", "utf8");
    const lines = source.split("\n").filter((line) => /questions/i.test(line));
    const allowed = [/from "\.\/AgentQuestions"/, /questionsSummary\(t, /, /<QuestionMarks t=\{t\} questions=/, /^\s*questions=\{current\.agent!\.questions\}$/, /counts\.questions/, /title=\{t\.questionsSummaryHelp\}/, /data-testid="panel-questions-summary"/, /the questions of the agents that are up/];
    for (const line of lines) expect(allowed.some((re) => re.test(line)), line).toBe(true);
  });
});

describe("«Agenti», answering an agent's question from the panel", () => {
  const QUESTION = "aq:scrittore:1790000000-ab12cd";
  const asked = (fields: Record<string, unknown> = {}) => ({
    id: QUESTION, tipo: "blocco", oggetto: "CV per Acme", testo: "Quale CV uso per Acme?",
    opzioni: [{ id: "breve", label: "CV breve", reversibile: true }, { id: "lungo", label: "CV completo" }, { id: "_rinvia", label: "Rinvia", reversibile: true }],
    multipla: false, libera: false, scadenza: NOW_S + 3600, default: "_rinvia", at: NOW_S - 600, ...fields,
  });
  let items: Record<string, unknown>[];
  let answerReply: Record<string, unknown>;
  beforeEach(() => {
    items = [asked()];
    answerReply = { ok: true, data: { result: "answered" } };
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command !== COMMAND) return { ok: false, error: "not_in_test" };
      const { op } = args.request;
      if (op === "list") {
        const agents = [agent("SCRITTORE-1", "scrittore", "1", "aspetta_umano", { questions: { open: items.length, unread: 1, items } })];
        return { ...listReply(), data: { ...listReply().data, agents } };
      }
      if (op === "team") return { ok: true, data: { halted: false, standby, held } };
      if (op === "answer") return answerReply;
      return { ok: true, data: { name: args.request.session, up: true, text: "" } };
    });
  });
  const answers = () => ops().filter((r) => r.op === "answer");

  it("answers a reversible option at the click, with the ids and the list's target, and says what happened", async () => {
    show("agent=SCRITTORE-1");
    const button = await screen.findByTestId("panel-answer-breve");
    expect(button).toHaveTextContent("CV breve");
    fireEvent.click(button);
    await waitFor(() => expect(answers()).toEqual([{ op: "answer", question: QUESTION, choice: "breve", target: "T1", confirmed: true }]));
    expect(await screen.findByTestId("panel-notice")).toHaveTextContent("Risposta inviata a Scrittore-1: «CV breve».");
    // the list is read again, so the counts follow
    await waitFor(() => expect(ops().filter((r) => r.op === "list").length).toBeGreaterThan(1));
    expect(screen.queryByTestId("panel-confirm")).toBeNull();
  });

  it("asks first for an option that does not say it can be undone, and sends nothing on cancel", async () => {
    show("agent=SCRITTORE-1");
    const button = await screen.findByTestId("panel-answer-lungo");
    expect(button).toHaveAttribute("data-reversible", "false");
    fireEvent.click(button);
    const dialog = await screen.findByTestId("panel-confirm");
    expect(dialog).toHaveTextContent("Rispondere «CV completo» a Scrittore-1 sulla VPS vps.example?");
    expect(dialog).toHaveTextContent("La prima risposta vale: dopo non si cambia.");
    fireEvent.click(within(dialog).getByText("Annulla"));
    expect(answers()).toEqual([]);
    fireEvent.click(screen.getByTestId("panel-answer-lungo"));
    fireEvent.click(within(await screen.findByTestId("panel-confirm")).getByText("Conferma"));
    await waitFor(() => expect(answers()).toEqual([{ op: "answer", question: QUESTION, choice: "lungo", target: "T1", confirmed: true }]));
  });

  it("says when the answer was already given elsewhere, when the question had expired, and a refusal with its code", async () => {
    answerReply = { ok: true, data: { result: "already_answered" } };
    show("agent=SCRITTORE-1");
    fireEvent.click(await screen.findByTestId("panel-answer-breve"));
    expect(await screen.findByTestId("panel-notice")).toHaveTextContent("Hai già risposto da un’altra parte: vale quella risposta.");
    cleanup();
    answerReply = { ok: true, data: { result: "expired" } };
    show("agent=SCRITTORE-1");
    fireEvent.click(await screen.findByTestId("panel-answer-breve"));
    expect(await screen.findByTestId("panel-notice")).toHaveTextContent("Era scaduta: ha fatto «Rinvia».");
    cleanup();
    answerReply = { ok: false, error: "answer_refused" };
    show("agent=SCRITTORE-1");
    fireEvent.click(await screen.findByTestId("panel-answer-breve"));
    expect(await screen.findByTestId("panel-notice")).toHaveTextContent(/answer_refused/);
  });

  it("has no buttons for a question with several choices, with room for words, or written before the contract", async () => {
    items = [
      asked({ id: "aq:scrittore:1790000000-m1", multipla: true }),
      asked({ id: "aq:scrittore:1790000000-l1", libera: true }),
      { id: null, tipo: null, oggetto: null, testo: "Procedo?", opzioni: [], multipla: false, libera: true, scadenza: null, default: null, at: NOW_S - 900 },
    ];
    show("agent=SCRITTORE-1");
    const list = await screen.findByTestId("panel-questions");
    expect(within(list).queryAllByTestId(/^panel-answer-/)).toEqual([]);
    expect(within(list).getAllByTestId("panel-question-options")).toHaveLength(2);
    expect(within(list).getByTestId("panel-questions-messages")).toBeInTheDocument();
  });

  it("in the read-only view: the options are text, and no answer reaches the native side", async () => {
    enterExistingTeamReadOnly(false);
    navigate("/agents?agent=SCRITTORE-1", { replace: true });
    render(<Shell />);
    const list = await screen.findByTestId("panel-questions");
    expect(within(list).queryAllByTestId(/^panel-answer-/)).toEqual([]);
    expect(within(list).getByTestId("panel-question-options")).toHaveTextContent("CV breve · CV completo · Rinvia");
    expect(answers()).toEqual([]);
  });

  it("has the sentences of an answer in every language", () => {
    for (const [locale, text] of Object.entries(AGENTS_PANEL_TEXT) as [Locale, AgentsPanelText][]) {
      for (const slot of ["{option}", "{name}", "{where}"]) expect(text.confirmAnswer, locale).toContain(slot);
      expect(text.bodyAnswer, locale).toContain("{name}");
      expect(text.resultAnswered, locale).toContain("{name}");
      expect(text.resultAnswered, locale).toContain("{option}");
      expect(text.resultExpired, locale).toContain("{option}");
      for (const key of ["answering", "answerConfirmFirst", "resultAlreadyAnswered"] as const) expect(text[key], `${locale} ${key}`).toMatch(/\S/);
    }
  });
});

// The previous sessions of the agents and the lanes of the last day (JHT-T43).
describe("«Agenti», the previous sessions and the lanes of the last day", () => {  const day = (...firsts: number[]) => [...firsts, ...Array(24 - firsts.length).fill(0)];
  const HISTORY = (extra: Record<string, unknown> = {}) => ({
    ok: true,
    data: {
      since: null,
      lanes: { scout: day(2, 0, 5), capitano: day(0) },
      items: [
        {
          name: "SCOUT-1",
          failed: [NOW_S - 5000],
          sessions: [
            { start: NOW_S - 3600, end: null, reason: "running" },
            { start: NOW_S - 20000, end: NOW_S - 3700, reason: "restarted_by_user" },
            { start: NOW_S - 90000, end: NOW_S - 30000, reason: "stopped_by_user" },
            { start: NOW_S - 200000, end: null, reason: "unknown" },
          ],
        },
        { name: "CAPITANO", failed: [], sessions: [{ start: NOW_S - 7200, end: null, reason: "running" }] },
      ],
      ...extra,
    },
  });

  it("keeps the previous sessions closed until asked for, so a long list does not push the chat away", async () => {
    historyReply = HISTORY();
    show("agent=SCOUT-1");
    const details = (await screen.findByTestId("panel-history-details")) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText(/sessioni precedenti/i)).toBeInTheDocument();
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
  });

  it("tells the previous sessions of the agent in view, how long each lasted and how it ended", async () => {
    historyReply = HISTORY();
    show("agent=SCOUT-1");
    const list = await screen.findByTestId("panel-history-list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("1 h");
    expect(rows[0]).toHaveTextContent("in corso");
    expect(rows[1]).toHaveTextContent("4 h 31 min");
    expect(rows[1]).toHaveTextContent("riavviata da te");
    expect(rows[2]).toHaveTextContent("16 h 40 min");
    expect(rows[2]).toHaveTextContent("spenta da te");
    // an end nobody wrote has no length and no invented reason
    expect(rows[3]).toHaveTextContent("—");
    expect(rows[3]).toHaveTextContent("fine non registrata");
    expect(screen.getByTestId("panel-history")).toHaveTextContent("1 avvio non riuscito");
    // only this agent's: the captain's session is not here
    expect(within(list).queryByText(/2 h/)).toBeNull();
  });

  it("says when the team has no history to give, instead of showing an empty list", async () => {
    show("agent=SCOUT-1");
    expect(await screen.findByTestId("panel-history-unavailable")).toHaveTextContent("non è disponibile su questa squadra");
    cleanup();
    historyReply = HISTORY();
    show("agent=SCORER-1");
    expect(await screen.findByTestId("panel-history")).toHaveTextContent("Nessuna sessione precedente registrata.");
  });

  it("says from when the trace is known when it was cut", async () => {
    historyReply = HISTORY({ since: NOW_S - 86400 * 20 });
    show("agent=SCOUT-1");
    expect(await screen.findByTestId("panel-history")).toHaveTextContent("Lo storico parte da");
  });

  it("shows the lanes of the last day on request, one per role, the numbers written and not only coloured", async () => {
    historyReply = HISTORY();
    show();
    fireEvent.click(await screen.findByTestId("panel-view-lanes"));
    const scout = await screen.findByTestId("panel-lane-scout");
    const cells = scout.querySelectorAll("[data-moves]");
    expect(cells).toHaveLength(24);
    // the last hour is the last box; 2 moves in the last hour, 5 two hours before
    expect(cells[23]).toHaveAttribute("data-moves", "2");
    expect(cells[21]).toHaveAttribute("data-moves", "5");
    expect(cells[23]).toHaveTextContent("2");
    expect(cells[0]).toHaveTextContent("·");
    // the sessions say when an agent of the role was up (SCOUT-1 started an hour ago and is running)
    expect(cells[23]).toHaveAttribute("data-up", "true");
    // …and not between the end of the one that stopped (8 hours ago) and the start of the one before the running one
    expect(cells[16]).toHaveAttribute("data-up", "false");
    expect(screen.getByTestId("panel-lane-capitano")).toBeInTheDocument();
    // the list is gone while the lanes are shown, and comes back
    expect(screen.queryByTestId("panel-row-SCOUT-1")).toBeNull();
    fireEvent.click(screen.getByTestId("panel-view-list"));
    expect(await screen.findByTestId("panel-row-SCOUT-1")).toBeInTheDocument();
  });

  it("tells the moves are not known, never zero, when the team's database could not be read", async () => {
    historyReply = HISTORY({ lanes: null });
    show();
    fireEvent.click(await screen.findByTestId("panel-view-lanes"));
    expect(await screen.findByTestId("panel-lanes-unknown")).toHaveTextContent("non lo so, non è zero");
    expect(screen.queryByTestId("panel-lane-scout")).toBeNull();
  });

  it("starts on the list when the browser keeps nothing, and the failed history never fails the list", async () => {
    show();
    expect(await screen.findByTestId("panel-summary")).toBeInTheDocument();
    expect(screen.getByTestId("panel-view-list")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("panel-error")).toBeNull();
  });

  it("has the history, the reasons and the lanes in every language", () => {
    for (const [locale, text] of Object.entries(AGENTS_PANEL_TEXT) as [Locale, AgentsPanelText][]) {
      for (const key of [
        "historyTitle", "historyReading", "historyUnavailable", "historyEmpty", "historyRunning", "historyRestarted", "historyStopped",
        "historyContained", "historyRetired", "historyStartedAgain", "historyUnknown", "unitDay", "unitHour", "unitMin", "viewLabel",
        "viewList", "viewLanes", "lanesTitle", "lanesHelp", "lanesUnknown", "lanesUp", "lanesDown", "lanesAxisStart", "lanesAxisEnd",
      ] as const) {
        expect(text[key], `${locale} ${key}`).toMatch(/\S/);
      }
      expect(text.historySince, locale).toContain("{time}");
      for (const forms of [text.historyFailed, text.lanesMoves]) {
        expect(forms.one, locale).toContain("{count}");
        expect(forms.other, locale).toContain("{count}");
      }
    }
    expect(pluralText("it", 1, AGENTS_PANEL_TEXT.it.historyFailed)).toBe("1 avvio non riuscito");
    expect(pluralText("it", 3, AGENTS_PANEL_TEXT.it.historyFailed)).toBe("3 avvii non riusciti");
  });
});

describe("«Agenti»: the terminal, read at the pace the native side says", () => {
  let screenReads = 0;
  let screenReply: (n: number) => unknown = () => ({ ok: true, data: { name: "SCOUT-1", up: true, text: "x" } });
  const screens = () => ops().filter((r) => r.op === "screen").length;
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  beforeEach(() => {
    screenReads = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const base = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command === COMMAND && args.request.op === "screen") {
        screenReads += 1;
        return screenReply(screenReads);
      }
      return base(command, args);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  const at = (refreshMs?: unknown) => () => ({
    ok: true,
    data: { name: "SCOUT-1", up: true, text: "working", ...(refreshMs === undefined ? {} : { refreshMs }) },
  });

  it("live: again after 2 s when the native side says so", async () => {
    screenReply = at(2_000);
    show("agent=SCOUT-1");
    await screen.findByTestId("panel-terminal-SCOUT-1");
    expect(screens()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(screens()).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(screens()).toBe(3);
  });

  it("an older native side that says no pace: every 10 s, as before", async () => {
    screenReply = at();
    show("agent=SCOUT-1");
    await screen.findByTestId("panel-terminal-SCOUT-1");
    await vi.advanceTimersByTimeAsync(9_000);
    expect(screens()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screens()).toBe(2);
  });

  it("never two reads at once: the next waits for the last to come back, even when the window is seen again", async () => {
    screenReply = (n) => (n === 1 ? at(2_000)() : new Promise(() => undefined));
    show("agent=SCOUT-1");
    await screen.findByTestId("panel-terminal-SCOUT-1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screens()).toBe(2);
    // the second read is still out: the window coming back does not start a third
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(screens()).toBe(2);
  });

  it("a server that turns this computer away: 20 s, then 40 s, then the pace again after a good read", async () => {
    screenReply = (n) => (n <= 2 ? { ok: false, error: "ssh_rate_limited" } : at(10_000)());
    show("agent=SCOUT-1");
    await screen.findByRole("alert");
    await vi.advanceTimersByTimeAsync(19_000);
    expect(screens()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screens()).toBe(2);
    await vi.advanceTimersByTimeAsync(39_000);
    expect(screens()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screens()).toBe(3);
    await screen.findByTestId("panel-terminal-SCOUT-1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screens()).toBe(4);
  });

  it("a hidden window reads nothing, and reads at once when it is seen again", async () => {
    screenReply = at(2_000);
    show("agent=SCOUT-1");
    await screen.findByTestId("panel-terminal-SCOUT-1");
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(screens()).toBe(1);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(screens()).toBe(2);
  });

  it("the lines are a memo: a read that brings the same text does not draw them again", async () => {
    expect((TerminalText as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
    screenReply = (n) => ({ ok: true, data: { name: "SCOUT-1", up: true, text: n < 3 ? "same" : "new line", refreshMs: 2_000 } });
    show("agent=SCOUT-1");
    expect((await screen.findByTestId("panel-terminal-SCOUT-1")).textContent).toBe("same");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.getByTestId("panel-terminal-SCOUT-1").textContent).toBe("same");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.getByTestId("panel-terminal-SCOUT-1").textContent).toBe("new line");
  });
});

describe("«Agenti»: the list reads again by itself", () => {
  const lists = () => ops().filter((r) => r.op === "list").length;
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("the rhythms are 20 s on this computer and 60 s on a VPS", () => {
    expect([LIST_REFRESH_LOCAL_MS, LIST_REFRESH_VPS_MS]).toEqual([20_000, 60_000]);
  });

  it("on this computer it reads every 20 s, each time with the team and the history", async () => {
    where = "local";
    show();
    await screen.findByTestId("panel-summary");
    const first = lists();
    expect(first).toBe(1);
    await advance(LIST_REFRESH_LOCAL_MS - 2_000);
    expect(lists()).toBe(first);
    await advance(3_000);
    await waitFor(() => expect(lists()).toBe(first + 1));
    expect(ops().filter((r) => r.op === "team").length).toBe(first + 1);
    await advance(LIST_REFRESH_LOCAL_MS);
    await waitFor(() => expect(lists()).toBe(first + 2));
    // a quiet read: the button never says «refreshing» for it
    expect(screen.queryByText("Aggiorno…")).toBeNull();
  });

  it("on a VPS it reads every 60 s: its reads go over ssh", async () => {
    show();
    await screen.findByTestId("panel-summary");
    await advance(LIST_REFRESH_LOCAL_MS * 2 + 5_000);
    expect(lists()).toBe(1);
    await advance(LIST_REFRESH_VPS_MS - LIST_REFRESH_LOCAL_MS * 2);
    await waitFor(() => expect(lists()).toBe(2));
  });

  it("the new states are shown without anybody pressing anything", async () => {
    where = "local";
    show("agent=CAPITANO");
    expect(await screen.findByTestId("panel-state")).toHaveTextContent("lavora");
    const state = AGENTS[0].state;
    AGENTS[0].state = "idle";
    try {
      await advance(LIST_REFRESH_LOCAL_MS + 1_000);
      await waitFor(() => expect(screen.getByTestId("panel-state")).not.toHaveTextContent("lavora"));
    } finally {
      AGENTS[0].state = state;
    }
  });

  it("a hidden window reads nothing, and reads at once when it is seen again", async () => {
    where = "local";
    show();
    await screen.findByTestId("panel-summary");
    setVisibility("hidden");
    await advance(LIST_REFRESH_LOCAL_MS * 3);
    expect(lists()).toBe(1);
    setVisibility("visible");
    await waitFor(() => expect(lists()).toBe(2));
  });

  it("a window seen again right after a read does not read twice", async () => {
    where = "local";
    show();
    await screen.findByTestId("panel-summary");
    setVisibility("hidden");
    setVisibility("visible");
    await advance(500);
    expect(lists()).toBe(1);
  });

  it("stops when the page goes away", async () => {
    where = "local";
    const view = show();
    await screen.findByTestId("panel-summary");
    view.unmount();
    await advance(LIST_REFRESH_LOCAL_MS * 5);
    expect(lists()).toBe(1);
  });

  it.each(["ssh_auth_failed", "ssh_rate_limited", "host_key_changed", "read_only_link"])(
    "after a failure that asking again makes worse (%s) it does not read by itself; «Refresh» still does",
    async (code) => {
      where = "local";
      const base = native.invoke.getMockImplementation()!;
      let failing = true;
      native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) =>
        command === COMMAND && args.request.op === "list" && failing ? { ok: false, error: code } : base(command, args),
      );
      show();
      await screen.findByTestId("panel-error");
      expect(lists()).toBe(1);
      await advance(LIST_REFRESH_VPS_MS * 4);
      expect(lists()).toBe(1);
      // the person's own read is still there, and once it answers the page reads by itself again
      failing = false;
      fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));
      await screen.findByTestId("panel-summary");
      expect(lists()).toBe(2);
      await advance(LIST_REFRESH_LOCAL_MS + 1_000);
      await waitFor(() => expect(lists()).toBe(3));
    },
  );

  it("after any other failure it goes on reading, slowly, as the team is not known", async () => {
    const base = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) =>
      command === COMMAND && args.request.op === "list" ? { ok: false, error: "agent_control_unsupported" } : base(command, args),
    );
    show();
    await screen.findByTestId("panel-error");
    await advance(LIST_REFRESH_VPS_MS + 1_000);
    await waitFor(() => expect(lists()).toBe(2));
  });

  it("reads nothing while a read of the person's is on its way", async () => {
    where = "local";
    const base = native.invoke.getMockImplementation()!;
    let release: (() => void) | null = null;
    let slow = false;
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command === COMMAND && args.request.op === "list" && slow) await new Promise<void>((resolve) => { release = resolve; });
      return base(command, args);
    });
    show();
    await screen.findByTestId("panel-summary");
    slow = true;
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));
    await waitFor(() => expect(lists()).toBe(2));
    await advance(LIST_REFRESH_LOCAL_MS * 3);
    expect(lists()).toBe(2);
    slow = false;
    release!();
    await screen.findByTestId("panel-summary");
    await advance(LIST_REFRESH_LOCAL_MS + 1_000);
    await waitFor(() => expect(lists()).toBe(3));
  });

  it("a window seen again while the periodic read is on its way does not start a second", async () => {
    where = "local";
    const base = native.invoke.getMockImplementation()!;
    let release: (() => void) | null = null;
    let slow = false;
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command === COMMAND && args.request.op === "list" && slow) await new Promise<void>((resolve) => { release = resolve; });
      return base(command, args);
    });
    show();
    await screen.findByTestId("panel-summary");
    slow = true;
    await advance(LIST_REFRESH_LOCAL_MS + 500);
    await waitFor(() => expect(lists()).toBe(2));
    setVisibility("hidden");
    setVisibility("visible");
    await advance(10_000); // more than the 5 s that make a seen window read again
    expect(lists()).toBe(2);
    slow = false;
    release!();
    await advance(LIST_REFRESH_LOCAL_MS + 1_000);
    await waitFor(() => expect(lists()).toBe(3));
  });

  it("reads nothing while an action is on its way", async () => {
    where = "local";
    const base = native.invoke.getMockImplementation()!;
    let release: (() => void) | null = null;
    native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
      if (command === COMMAND && args.request.op === "stop") await new Promise<void>((resolve) => { release = resolve; });
      return base(command, args);
    });
    show("agent=SCOUT-1");
    fireEvent.click(await screen.findByTestId("panel-stop"));
    fireEvent.click(within(screen.getByTestId("panel-confirm")).getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(ops().some((r) => r.op === "stop")).toBe(true));
    const before = lists();
    await advance(LIST_REFRESH_LOCAL_MS * 3);
    expect(lists()).toBe(before);
    release!();
    await waitFor(() => expect(lists()).toBe(before + 1)); // the action's own read
  });

  it("reads nothing while a start is on its way", async () => {
    const base = native.invoke.getMockImplementation()!;
    let release: (() => void) | null = null;
    let up = false;
    native.invoke.mockImplementation(async (command: string, args: { request?: Record<string, unknown> }) => {
      if (command === "onboarding_resume_team_start") {
        await new Promise<void>((resolve) => { release = resolve; });
        up = true;
        return {};
      }
      if (command === COMMAND && args.request?.op === "list" && !up) return { ok: false, error: "agent_control_no_team" };
      return base(command, args as { request: Record<string, unknown> });
    });
    show();
    await screen.findByTestId("panel-error");
    fireEvent.click(await screen.findByTestId("start-team"));
    await waitFor(() => expect(release).not.toBeNull());
    const before = lists();
    await advance(LIST_REFRESH_VPS_MS * 3);
    // only the start's own readings (one every few seconds, up to its maximum): not one of the page's by itself
    expect(lists() - before).toBe(START_READ_WAITS.duringMax);
    release!();
    await screen.findByTestId("panel-summary");
  });

  it("coming back to Agents from another page reads the list at once", async () => {
    where = "local";
    navigate("/agents?agent=CAPITANO", { replace: true });
    render(<Shell />);
    await screen.findByTestId("panel-summary");
    expect(lists()).toBe(1);
    navigate("/help");
    await waitFor(() => expect(screen.queryByTestId("panel-summary")).toBeNull());
    navigate("/agents?agent=CAPITANO");
    await screen.findByTestId("panel-summary");
    await waitFor(() => expect(lists()).toBe(2));
  });
});
