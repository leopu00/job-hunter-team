import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import AgentsPanel, { identityLine } from "./AgentsPanel";
import { AGENTS_PANEL_TEXT, type AgentsPanelText } from "./AgentsPanel.i18n";

// «Agenti»: the agents' control panel, against a stand-in native side
// (agent_control). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
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
let held: { session: string; byUser: boolean }[] = [];
let standby = { state: "off", until: null as string | null, weeklyReset: false };
let burnIntent: Record<string, unknown> | undefined;
let actionReply: Record<string, unknown> = { ok: true, data: { result: "stopped" } };
let ownVps: string | undefined;
let historyReply: Record<string, unknown> | null = null;
const listReply = () => ({
  ok: true,
  data: { agents: AGENTS, roles: ROLES, states: true, target, where: "vps", label: "vps.example", ...(ownVps ? { ownVps } : {}) },
});
const ops = () => native.invoke.mock.calls.filter(([c]) => c === COMMAND).map(([, a]) => (a as { request: Record<string, unknown> }).request);
const ACTIONS = new Set(["start", "stop", "restart", "pause", "resume", "answer"]);

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  target = "T1";
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
    expect(await screen.findByTestId("panel-usage")).toHaveTextContent(
      /^contesto usato 43% \(109\.820 token su 258\.400\) \(letto alle .+\) · 12\.345 token nell'ultima ora \(contati dalla Sentinella alle .+\)$/,
    );
    cleanup();
    show("agent=SCOUT-1");
    expect(await screen.findByTestId("panel-usage")).toHaveTextContent(/^contesto: non so · 0 token nell'ultima ora/);
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
  it("stops the team only after a confirmation that says what happens, with the Team page's request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/team-state/emergency-stop");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ confirm: "STOP" });
    expect(await screen.findByText("Stop chiesto: la squadra si ferma entro pochi secondi.")).toBeInTheDocument();
    // no agent_control action: the stop is the cloud's intent
    expect(ops().filter((r) => ACTIONS.has(String(r.op)))).toEqual([]);
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
    expect(await screen.findByTestId("panel-identity")).toHaveTextContent("Codex · gpt-5.6-sol · effort alto · sulla VPS vps.example");
    fireEvent.click(screen.getByTestId("panel-row-SCOUT-1"));
    await waitFor(() => expect(screen.getByTestId("panel-identity")).toHaveTextContent(it_.identityUnknown));
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
    const allowed = [/AgentIdentity/, /identityLine\(/, /data-testid="panel-identity"/, /identity\.(cli|model|effort)/, /if \(!identity\) return t\.identityUnknown/, /identity: AgentIdentity/];
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
    expect(within(list).getByTestId("panel-questions-messages")).toHaveAttribute("href", "#/messages");
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
