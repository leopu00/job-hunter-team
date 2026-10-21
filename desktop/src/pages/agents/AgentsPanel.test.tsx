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
import AgentsPanel from "./AgentsPanel";

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
const listReply = () => ({ ok: true, data: { agents: AGENTS, roles: ROLES, states: true, target, where: "vps", label: "vps.example" } });
const ops = () => native.invoke.mock.calls.filter(([c]) => c === COMMAND).map(([, a]) => (a as { request: Record<string, unknown> }).request);
const ACTIONS = new Set(["start", "stop", "restart", "pause", "resume"]);

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  target = "T1";
  held = [];
  standby = { state: "off", until: null, weeklyReset: false };
  burnIntent = undefined;
  actionReply = { ok: true, data: { result: "stopped" } };
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args: { request: Record<string, unknown> }) => {
    if (command !== COMMAND) return { ok: false, error: "not_in_test" };
    const { op } = args.request;
    if (op === "list") return listReply();
    if (op === "team") return { ok: true, data: { halted: false, standby, held, ...(burnIntent ? { burnIntent } : {}) } };
    if (op === "screen") return { ok: true, data: { name: args.request.session, up: true, text: "<b>not html</b>\nworking" } };
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
    expect(screen.getByTestId("panel-summary")).toHaveTextContent("1 ti aspettano · 1 al lavoro · 5 accesi su");
    expect(screen.getByTestId("panel-row-SCORER-1")).toHaveTextContent("limite di 5 ore");
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
    expect(ops().every((r) => ["list", "team", "screen"].includes(String(r.op)))).toBe(true);
    expect(fake.current!.calls).toEqual([]);
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
