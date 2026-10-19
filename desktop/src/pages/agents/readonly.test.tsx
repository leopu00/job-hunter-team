import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import { READ_ONLY_NAV, READ_ONLY_ROUTES, ROUTES } from "../../shell/routes";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";

// «Agenti» in the read-only view of an existing team: the agent sessions its VPS
// (a stand-in here) reports, their state, and one terminal read when opened.
// Synthetic data only.
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

const COMMAND = "existing_team_agents_read";
const NOW_S = Math.floor(Date.now() / 1000);
const agent = (name: string, role: string, instance: string | null, extra: Record<string, unknown> = {}) => ({
  name, role, instance, up: true, created: NOW_S - 3600, activity: NOW_S - 60,
  state: null, reason: null, since: null, until: null, ...extra,
});
const ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer", "dottore", "mantenitore"]
  .map((role) => ({ role, multi: ["scout", "analista", "scorer", "scrittore", "closer", "critico"].includes(role) }));
const AGENTS = [
  agent("CAPITANO", "capitano", null, { state: "lavora", since: NOW_S - 120 }),
  agent("SCOUT-1", "scout", "1", { state: "bloccato", reason: "limite_5h", since: NOW_S - 300 }),
  agent("CRITICO-S3", "critico", "S3", { state: "idle" }),
  agent("CLOSER-1", "closer", "1", { state: "aspetta_umano" }),
  agent("DOTTORE", "dottore", null, { state: "idle" }),
  agent("MANTENITORE", "mantenitore", null, { state: "invented_state" }),
];
const listReply = (states = true, agents = AGENTS) => ({ ok: true, data: { agents, roles: ROLES, states } });
const screenCalls = () => native.invoke.mock.calls.filter(([c, a]) => c === COMMAND && (a as { request: { op: string } }).request.op === "screen");

let restoreBridge: () => void;
const network = vi.fn(async () => {
  throw new Error("no network in this view");
});
beforeEach(() => {
  network.mockClear();
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args: { request: { op: string; name?: string } }) => {
    if (command !== COMMAND) throw new Error(`unexpected native command ${command}`);
    if (args.request.op === "list") return listReply();
    return { ok: true, data: { name: args.request.name, up: true, text: "<b>not html</b>\nworking on SCOUT-1" } };
  });
  vi.stubGlobal("fetch", network);
  restoreBridge = installApiBridge(shellApi(notInDesktop));
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.unstubAllGlobals();
});

describe("«Agenti» in the read-only view of an existing team", () => {
  it("is a route of that view with its link, in place of the box's agents page", async () => {
    const route = READ_ONLY_ROUTES.find((r) => r.path === "/agents");
    expect(route?.page).toBeDefined();
    expect(route?.page).not.toBe(ROUTES.find((r) => r.path === "/agents")?.page);
    expect(READ_ONLY_NAV.map((n) => n.href)).toContain("/agents");

    navigate("/agents", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Agenti" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getByRole("link", { name: "Agenti" })).toHaveAttribute("aria-current", "page");
  });

  it("shows every agent session the VPS reports, the roles with none as down, and reads nothing from the cloud", async () => {
    navigate("/agents", { replace: true });
    render(<Shell />);
    await screen.findByTestId("agents-read");
    for (const name of ["CAPITANO", "SCOUT-1", "CRITICO-S3", "CLOSER-1", "DOTTORE", "MANTENITORE"]) {
      expect(screen.getByTestId(`agent-${name}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("agent-CAPITANO-state")).toHaveTextContent("lavora");
    expect(screen.getByTestId("agent-SCOUT-1-state")).toHaveTextContent("limite di 5 ore");
    // a state the catalog does not know is unknown, never work
    expect(screen.getByTestId("agent-MANTENITORE")).toHaveAttribute("data-state", "sconosciuto");
    // roles with no session: down, by role
    expect(screen.getByTestId("agent-role-mentor")).toHaveTextContent("non attivo");
    expect(screen.getByTestId("agent-role-analista")).toHaveTextContent("nessuna sessione attiva");
    expect(screen.queryByTestId("agents-states-unknown")).toBeNull();
    expect(fake.current!.calls).toEqual([]);
    expect(network).not.toHaveBeenCalled();
    expect(screenCalls()).toHaveLength(0);
  });

  it("without the team's own state says unknown, in grey, never that an agent works", async () => {
    native.invoke.mockImplementation(async () => listReply(false, AGENTS.map((a) => ({ ...a, state: null }))));
    navigate("/agents", { replace: true });
    render(<Shell />);
    await screen.findByTestId("agents-read");
    expect(screen.getByTestId("agents-states-unknown")).toBeInTheDocument();
    for (const name of ["CAPITANO", "SCOUT-1", "CLOSER-1"]) {
      expect(screen.getByTestId(`agent-${name}`)).toHaveAttribute("data-state", "sconosciuto");
      expect(screen.getByTestId(`agent-${name}-state`)).not.toHaveTextContent("lavora");
    }
  });

  it("reads a terminal once, when it is opened, and shows it as text", async () => {
    navigate("/agents", { replace: true });
    render(<Shell />);
    await screen.findByTestId("agents-read");
    expect(screenCalls()).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId("agent-SCOUT-1")).getByRole("button", { name: "Mostra il terminale" }));
    const terminal = await screen.findByTestId("agent-SCOUT-1-terminal");
    expect(terminal.textContent).toBe("<b>not html</b>\nworking on SCOUT-1");
    expect(terminal.querySelector("b")).toBeNull();
    expect(screenCalls()).toEqual([[COMMAND, { request: { op: "screen", name: "SCOUT-1" } }]]);
    fireEvent.click(within(screen.getByTestId("agent-SCOUT-1")).getByRole("button", { name: "Nascondi il terminale" }));
    expect(screen.queryByTestId("agent-SCOUT-1-terminal")).toBeNull();
    // only the list and that one terminal: no other command, nothing that writes
    expect(native.invoke.mock.calls.every(([command]) => command === COMMAND)).toBe(true);
    expect(native.invoke.mock.calls.map(([, args]) => (args as { request: { op: string } }).request.op).sort()).toEqual(["list", "screen"]);
  });

  it("a terminal the VPS could not clean is not shown: the catalog's sentence, never the text", async () => {
    native.invoke.mockImplementation(async (_command: string, args: { request: { op: string } }) =>
      args.request.op === "list" ? listReply() : { ok: false, error: "agent_screen_unfiltered" });
    navigate("/agents", { replace: true });
    render(<Shell />);
    await screen.findByTestId("agents-read");
    fireEvent.click(within(screen.getByTestId("agent-SCOUT-1")).getByRole("button", { name: "Mostra il terminale" }));
    const alert = await within(screen.getByTestId("agent-SCOUT-1-screen")).findByRole("alert");
    expect(alert).toHaveTextContent(describeError("agent_screen_unfiltered", { locale: "it" }).text);
    expect(screen.queryByTestId("agent-SCOUT-1-terminal")).toBeNull();
  });

  it("on a failed read shows the catalog's sentence and no agent", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "agents_unavailable" }));
    navigate("/agents", { replace: true });
    render(<Shell />);
    const alert = await screen.findByTestId("agents-error");
    expect(alert).toHaveTextContent(describeError("agents_unavailable", { locale: "it" }).text);
    await waitFor(() => expect(screen.queryByTestId("agent-CAPITANO")).toBeNull());
  });
});
