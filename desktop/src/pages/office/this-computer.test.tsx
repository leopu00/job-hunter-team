import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeClick, OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions } from "../../office/contract";
import { diffOfficeSnapshots } from "../../office/data/diff";
import { emptyEngine } from "../../office/parts";
import { leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { forgetChatMessages, rememberChatPage } from "../../lib/chat-last-message";
import { setLocalTeamData } from "../../lib/local-team-data";
import { refresh } from "../../shell/router";
import { realSnapshotReply } from "../../test-support/snapshot-command-reply";
import { locales } from "@/i18n/config";

// /office of a LOCAL profile (no cloud account): the same office, drawn from the team on this computer —
// its agents from the Agents page's read (the native control), its piles from the team's own positions, its
// state from the same probe as an existing team's office — with no cloud and no Realtime. Synthetic data only.
const scene = {
  options: null as OfficeSceneOptions | null,
  destroy: vi.fn(),
  setAgentStatuses: vi.fn(),
};
vi.mock("../../office/scene/pixi-scene", () => ({
  createOfficeScene: vi.fn(async (_host: HTMLElement, options: OfficeSceneOptions) => {
    scene.options = options;
    return { resize: vi.fn(), destroy: scene.destroy, setAgentStatuses: scene.setAgentStatuses, focus: vi.fn(() => null) };
  }),
}));
const cloud = vi.hoisted(() => ({ touched: [] as string[] }));
vi.mock("../../lib/supabase", () => ({
  supabase: new Proxy({}, { get: (_, key) => (cloud.touched.push(String(key)), undefined) }),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
// The channel to the team (lib/state-stream.ts): its events are sent by hand
const channel = vi.hoisted(() => ({ handlers: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    channel.handlers.set(name, handler);
    return () => channel.handlers.delete(name);
  },
}));
const statusQuery = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../office/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/status")>()),
  loadAgentStatuses: vi.fn(async () => {
    statusQuery.calls++;
    return null;
  }),
}));
const parts = vi.hoisted(() => ({ value: { createEngine: null as unknown, data: null as unknown } }));
vi.mock("../../office/parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/parts")>()),
  loadParts: vi.fn(async () => parts.value),
}));

import { resetVpsPositionsShared } from "../../lib/existing-team-positions-shared";
import { resetTeamAgentsShared } from "../../lib/existing-team-agents";
import { resetStateStreamForTests, startStateStream } from "../../lib/state-stream";
import OfficePage, { THIS_COMPUTER_OFFICE_READ_MS } from "./index";

const SNAPSHOT = "onboarding_resume_snapshot";
const POSITIONS = "existing_team_positions_read";
const CONTROL = "agent_control";
const LAYOUT = { version: 1, departments: [], furniture: [] } as unknown as OfficeLayout;
const MANIFEST: OfficeManifest = { version: 1, layout: "/office/layout.json", characters: [], atlases: [] };
const NOW_S = Math.floor(Date.now() / 1000);
const agent = (name: string, role: string, instance: string | null, state: string) => ({
  name, role, instance, up: true, created: NOW_S - 3600, activity: NOW_S - 60, state, reason: null, since: null, until: null,
});
const ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer", "dottore", "mantenitore"]
  .map((role) => ({ role, multi: ["scout", "analista", "scorer", "scrittore", "closer", "critico"].includes(role) }));
const ROWS = [
  { id: "11", legacy_id: 11, title: "Cercatore di nuovi", company: "Alfa", status: "new", location: "Roma", found_at: new Date().toISOString(), score: null },
  { id: "12", legacy_id: 12, title: "Da punteggiare", company: "Beta", status: "scored", location: "Milano", found_at: "2026-10-16T09:00:00Z", score: 74, write_requested: false },
];
let agents: ReturnType<typeof agent>[];
let controlReply: (op?: string) => Promise<unknown>;
let snapshotReply: () => Promise<unknown>;
let positionsReply: (op: string) => unknown;
let applied: OfficeEvent[];
let load: ReturnType<typeof vi.fn>;
const calls = (command: string) => native.invoke.mock.calls.filter(([name]) => name === command);
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const entered = () => applied.filter((e): e is Extract<OfficeEvent, { type: "enter" }> => e.type === "enter").map((e) => e.agent.uid).sort();
const mount = () => render(<OfficePage params={{}} search={new URLSearchParams()} />);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  cloud.touched = [];
  statusQuery.calls = 0;
  scene.options = null;
  scene.setAgentStatuses.mockReset();
  applied = [];
  load = vi.fn();
  parts.value = {
    createEngine: vi.fn(() => ({ ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) })),
    data: { load, diff: diffOfficeSnapshots },
  };
  agents = [agent("CAPITANO", "capitano", null, "lavora"), agent("SCOUT-1", "scout", "1", "idle"), agent("DOTTORE", "dottore", null, "idle")];
  controlReply = async () => ({ ok: true, data: { agents, roles: ROLES, states: true, target: "T-local", where: "local", label: null } });
  snapshotReply = async () => realSnapshotReply();
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  // the core counts the piles itself (op piles); an older core answers positions_request_invalid and the list is read
  positionsReply = (op) => (op === "piles"
    ? { ok: true, data: { scout: 1, analisti: 0, scorer: 1, scrittori: 0, critici: 0 } }
    : { ok: true, data: { items: ROWS, total: ROWS.length } });
  native.invoke.mockImplementation(async (command: string, args?: { request?: { op?: string } }) => {
    if (command === SNAPSHOT) return snapshotReply();
    if (command === POSITIONS) return positionsReply(args?.request?.op ?? "");
    if (command === CONTROL) return controlReply(args?.request?.op);
    throw new Error(`unexpected native command ${command}`);
  });
  resetVpsPositionsShared();
  resetTeamAgentsShared();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(LAYOUT) : new Response("{}", { status: 404 }))),
  );
  forgetChatMessages();
  leaveExistingTeamReadOnly();
  setLocalTeamData("local:synthetic");
});
afterEach(() => {
  cleanup();
  resetStateStreamForTests();
  channel.handlers.clear();
  setLocalTeamData(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the office of a local profile", () => {
  it("draws the agents that work on this computer, the ones the Agents page lists, and asks the cloud for nothing", async () => {
    mount();
    // the captain, the scout and the doctor are in the office
    await waitFor(() => expect(entered()).toEqual(["capitano", "dottore", "scout-1"]));
    expect(calls(CONTROL).length).toBeGreaterThan(0);
    expect(load).not.toHaveBeenCalled();
    expect(statusQuery.calls).toBe(0);
    expect(cloud.touched).toEqual([]);
    await waitFor(() =>
      expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(
        expect.objectContaining({ agents: { capitano: expect.objectContaining({ state: "lavora" }), dottore: expect.objectContaining({ state: "idle" }), "scout-1": expect.objectContaining({ state: "idle" }) } }),
      ),
    );
  });

  it("says nothing about the cloud, and never «I cannot read the cloud»", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    expect(screen.queryByText(/cloud/i)).toBeNull();
    // and nothing about a VPS: the line under the title says the agents were read from this computer
    expect(screen.queryByText(/VPS/)).toBeNull();
    expect(await screen.findByText(/letti da questo computer/)).toBeInTheDocument();
  });

  const ops = () => calls(POSITIONS).map(([, args]) => (args as { request: { op: string } }).request.op);

  it("counts the piles with ONE read of the core, and never reads the team's whole list for them", async () => {
    mount();
    await waitFor(() => expect(applied.some((e) => e.type === "piles")).toBe(true));
    const piles = applied.filter((e): e is Extract<OfficeEvent, { type: "piles" }> => e.type === "piles").at(-1)!.piles;
    expect(piles.scout).toBe(1);
    expect(piles.scorer).toBe(1);
    expect(ops()).toEqual(["piles"]);
  });

  it("with a core that does not know the count yet, the piles are counted from the list as before, once", async () => {
    positionsReply = (op) => (op === "piles" ? { ok: false, error: "positions_request_invalid" } : { ok: true, data: { items: ROWS, total: ROWS.length } });
    mount();
    await waitFor(() => expect(applied.some((e) => e.type === "piles")).toBe(true));
    const piles = applied.filter((e): e is Extract<OfficeEvent, { type: "piles" }> => e.type === "piles").at(-1)!.piles;
    expect([piles.scout, piles.scorer]).toEqual([1, 1]);
    expect(ops()).toEqual(["piles", "list"]);
  });

  it("a count that fails for any other reason leaves the piles unknown and does not read the list on top of it", async () => {
    positionsReply = (op) => (op === "piles" ? { ok: false, error: "positions_unavailable" } : { ok: true, data: { items: ROWS, total: ROWS.length } });
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    expect(ops()).toEqual(["piles"]);
  });

  // Only the interval is faked, and before the page is mounted (an interval made with the real clock is not
  // moved by a fake one made later): the rest of the clock stays real, so the waits of the test still work.
  const fakeInterval = () => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  // waitFor polls with setInterval, which is the faked one here: wait on the real clock instead
  const until = async (check: () => void) => {
    for (let i = 0; i < 40; i++) {
      try { return check(); } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    check();
  };

  it("reads again by itself while the window is in view, and not while it is hidden", async () => {
    fakeInterval();
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    const first = calls(CONTROL).length;
    await pass(THIS_COMPUTER_OFFICE_READ_MS + 500);
    await waitFor(() => expect(calls(CONTROL).length).toBe(first + 1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await pass(THIS_COMPUTER_OFFICE_READ_MS * 3);
    expect(calls(CONTROL).length).toBe(first + 1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("follows the team: an agent that appears is drawn at the next read", async () => {
    fakeInterval();
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano", "dottore", "scout-1"]));
    agents = [...agents, agent("SCORER-1", "scorer", "1", "lavora")];
    await pass(THIS_COMPUTER_OFFICE_READ_MS + 500);
    await waitFor(() => expect(entered()).toEqual(["capitano", "dottore", "scorer-1", "scout-1"]));
  });

  it("a round of reads still on its way is not started again by the next tick", async () => {
    fakeInterval();
    let release: (value: unknown) => void = () => undefined;
    const answer = () => ({ ok: true, data: { agents, roles: ROLES, states: true, target: "T-local", where: "local", label: null } });
    controlReply = () => new Promise((resolve) => { release = resolve; });
    mount();
    await until(() => expect(calls(CONTROL)).toHaveLength(1));
    await pass(THIS_COMPUTER_OFFICE_READ_MS * 4 + 500);
    expect(calls(CONTROL)).toHaveLength(1);
    controlReply = async () => answer();
    release(answer());
    await until(() => expect(entered()).toHaveLength(3));
    await pass(THIS_COMPUTER_OFFICE_READ_MS + 500);
    await until(() => expect(calls(CONTROL)).toHaveLength(2));
  });

  it("«Refresh» takes over from a round still on its way: the old round is not shown, the new one is", async () => {
    let release: (value: unknown) => void = () => undefined;
    const answer = (list: typeof agents) => ({ ok: true, data: { agents: list, roles: ROLES, states: true, target: "T-local", where: "local", label: null } });
    controlReply = () => new Promise((resolve) => { release = resolve; });
    mount();
    await waitFor(() => expect(calls(CONTROL)).toHaveLength(1));
    controlReply = async () => answer(agents);
    await act(async () => refresh());
    await waitFor(() => expect(calls(CONTROL)).toHaveLength(2));
    await waitFor(() => expect(entered()).toHaveLength(3));
    const before = applied.length;
    // the old round comes back late with nobody up: it is not shown
    release(answer([]));
    await act(async () => { await Promise.resolve(); });
    expect(applied.length).toBe(before);
  });

  const TEAM = { halted: false, standby: { state: "off", until: null, weeklyReset: false }, held: [] as { session: string; byUser: boolean }[], burnIntent: { state: "off" } };
  const listReply = () => ({ ok: true, data: { agents, roles: ROLES, states: true, target: "T-local", where: "local", label: null } });
  const controlRequests = () => calls(CONTROL).map(([, args]) => (args as { request: Record<string, unknown> }).request);

  it("a click on an agent opens its panel: its state, Spegni and the chat, what the team does not publish said so, nothing of the cloud", async () => {
    controlReply = async (op) => (op === "team" ? { ok: true, data: TEAM } : listReply());
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    const click: OfficeClick = { kind: "agent", uid: "capitano", role: "capitano" };
    act(() => scene.options!.onClick(click));
    const panel = await screen.findByRole("complementary", { name: "Pannello di CAPITANO" });
    expect(within(panel).getByTestId("office-agent-not-published")).toHaveTextContent("non pubblicati dalla squadra");
    expect(await within(panel).findByRole("button", { name: "Spegni Capitano" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /^Accendi/ })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Scrivi a Capitano" })).toBeInTheDocument();
    // the terminal is read only when it is opened
    expect(controlRequests().filter((r) => r.op === "screen")).toEqual([]);
    expect(panel.textContent).not.toMatch(/cloud|VPS/i);
    expect(cloud.touched).toEqual([]);
  });

  it("Spegni asks first, with the Agents page's own confirmation; Esc closes the question and not the panel; confirming turns the agent off", async () => {
    const user = userEvent.setup();
    let stopped = false;
    controlReply = async (op) => {
      if (op === "team") return { ok: true, data: TEAM };
      if (op === "stop") {
        stopped = true;
        return { ok: true, data: { result: "stopped" } };
      }
      return listReply();
    };
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    act(() => scene.options!.onClick({ kind: "agent", uid: "scout-1", role: "scout" }));
    const panel = await screen.findByRole("complementary", { name: "Pannello di SCOUT-1" });
    await user.click(await within(panel).findByRole("button", { name: "Spegni Scout-1" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Spegnere Scout-1");
    expect(stopped).toBe(false);
    // the keyboard lands in the question, Esc closes it and the panel stays
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Pannello di SCOUT-1" })).toBeInTheDocument();
    expect(stopped).toBe(false);

    await user.click(within(panel).getByRole("button", { name: "Spegni Scout-1" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(stopped).toBe(true));
    expect(controlRequests().find((r) => r.op === "stop")).toMatchObject({ session: "SCOUT-1", target: "T-local", confirmed: true });
    expect(await within(panel).findByRole("status")).toHaveTextContent(/Scout-1/);
  });

  it("an agent turned off from here says «Spento da te» and offers Accendi", async () => {
    agents = [agent("CAPITANO", "capitano", null, "lavora")];
    controlReply = async (op) => (op === "team" ? { ok: true, data: { ...TEAM, held: [{ session: "SCOUT-1", byUser: true }] } } : listReply());
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano"]));
    act(() => scene.options!.onClick({ kind: "agent", uid: "scout-1", role: "scout" }));
    const panel = await screen.findByRole("complementary", { name: "Pannello di SCOUT-1" });
    expect(await within(panel).findByTestId("office-agent-held")).toHaveTextContent("Spento da te");
    expect(within(panel).getByRole("button", { name: "Accendi Scout-1" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /^Spegni/ })).toBeNull();
    // an agent that is off has no terminal to read
    expect(within(panel).queryByTestId("office-agent-terminal-toggle")).toBeNull();
  });

  it("the terminal opens on a button, read only, named for a screen reader, and is read only while it is open", async () => {
    const user = userEvent.setup();
    controlReply = async (op) => {
      if (op === "team") return { ok: true, data: TEAM };
      if (op === "screen") return { ok: true, data: { name: "CAPITANO", up: true, text: "riga uno\nriga due", refreshMs: 2000 } };
      return listReply();
    };
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    act(() => scene.options!.onClick({ kind: "agent", uid: "capitano", role: "capitano" }));
    const panel = await screen.findByRole("complementary", { name: "Pannello di CAPITANO" });
    const toggle = await within(panel).findByRole("button", { name: /Terminale \(sola lettura\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(controlRequests().filter((r) => r.op === "screen")).toEqual([]);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const log = await within(panel).findByRole("log", { name: "Terminale di Capitano, sola lettura" });
    expect(log).toHaveTextContent("riga uno");
    expect(log).toHaveAttribute("tabindex", "0");
    expect(log).toHaveAttribute("aria-live", "off");
    await user.click(toggle);
    expect(within(panel).queryByRole("log")).toBeNull();
  });

  it("without a mouse: Tab reaches the agent with its tag's words, Enter opens its panel and takes the focus, Esc closes it and gives the focus back", async () => {
    const user = userEvent.setup();
    controlReply = async (op) => (op === "team" ? { ok: true, data: TEAM } : listReply());
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    const button = await screen.findByRole("button", { name: /capitano/i });
    button.focus();
    await user.keyboard("{Enter}");
    const panel = await screen.findByRole("complementary", { name: "Pannello di CAPITANO" });
    expect(document.activeElement).toBe(panel);
    // Tab goes on inside the panel, in reading order: the chat first, then Spegni
    await user.tab();
    await user.tab();
    const write = await within(panel).findByRole("button", { name: "Scrivi a Capitano" });
    const off = await within(panel).findByRole("button", { name: "Spegni Capitano" });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(write.compareDocumentPosition(off) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("shows the last message exchanged with an agent the chat already read, and says so when it has read none", async () => {
    controlReply = async (op) => (op === "team" ? { ok: true, data: TEAM } : listReply());
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    act(() => scene.options!.onClick({ kind: "agent", uid: "capitano", role: "capitano" }));
    const first = await screen.findByRole("complementary", { name: "Pannello di CAPITANO" });
    expect(within(first).getByText(/Nessun messaggio letto in questa sessione/)).toBeInTheDocument();
    // no read of the chat was made for it
    expect(calls("direct_chat_read")).toHaveLength(0);

    const at = Math.floor(Date.now() / 1000);
    rememberChatPage("capitano", {
      messages: [
        { id: "1", role: "agent", text: "Ho trovato 3 posizioni nuove", at: at - 600 },
        { id: "2", role: "user", text: "Perfetto, passa all'analisi", at: at - 60 },
        { id: "3", role: "system", text: "mail_not_taken", at: at - 10, code: "mail_not_taken" },
      ],
    });
    act(() => scene.options!.onClick({ kind: "agent", uid: "scout-1", role: "scout" }));
    act(() => scene.options!.onClick({ kind: "agent", uid: "capitano", role: "capitano" }));
    const again = await screen.findByRole("complementary", { name: "Pannello di CAPITANO" });
    const last = within(again).getByTestId("office-agent-last-message");
    expect(last).toHaveTextContent("Perfetto, passa all'analisi");
    expect(last).toHaveTextContent("Tu");
    expect(calls("direct_chat_read")).toHaveLength(0);
  });

  it("the agent's panel asks the engine to hold it still while it is open and lets it go when it closes", async () => {
    const select = vi.fn();
    parts.value = {
      createEngine: vi.fn(() => ({ ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e), select })),
      data: { load, diff: diffOfficeSnapshots },
    };
    mount();
    await waitFor(() => expect(entered()).toHaveLength(3));
    act(() => scene.options!.onClick({ kind: "agent", uid: "scout-1", role: "scout" }));
    await screen.findByRole("complementary", { name: "Pannello di SCOUT-1" });
    expect(select).toHaveBeenLastCalledWith("scout-1");
    act(() => scene.options!.onClick(null));
    expect(select).toHaveBeenLastCalledWith(null);
    // another object is not an agent
    act(() => scene.options!.onClick({ kind: "board" }));
    expect(select).toHaveBeenLastCalledWith(null);
  });

  it("a team with nobody up draws an empty office and says so, without an error", async () => {
    agents = [];
    mount();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(entered()).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls(POSITIONS)).toHaveLength(0);
  });

  // JHT-T175: the operator saw the agents up on Team › Agents and an empty office. The office asked a VPS probe
  // whether «the container» was up before it looked at the agents; on this computer that probe says nothing.
  const SEVEN = [
    agent("CAPITANO", "capitano", null, "idle"),
    agent("SENTINELLA", "sentinella", null, "idle"),
    agent("ASSISTENTE", "assistente", null, "idle"),
    agent("MENTOR", "mentor", null, "idle"),
    agent("SCOUT-3", "scout", "3", "lavora"),
    agent("DOTTORE", "dottore", null, "idle"),
    agent("MANTENITORE", "mantenitore", null, "idle"),
  ];
  it("draws the agents the Agents page lists even when the VPS probe says the container is down", async () => {
    agents = SEVEN;
    snapshotReply = async () => realSnapshotReply({ containerRunning: false });
    mount();
    await waitFor(() => expect(entered()).toEqual(["assistente", "capitano", "dottore", "mantenitore", "mentor", "scout-3", "sentinella"]));
    await waitFor(() =>
      expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(
        expect.objectContaining({ agents: expect.objectContaining({ "scout-3": expect.objectContaining({ state: "lavora" }), capitano: expect.objectContaining({ state: "idle" }) }) }),
      ),
    );
    expect(calls(SNAPSHOT)).toHaveLength(0);
    // the doctor and the maintainer are drawn as themselves: the engine picks their own sheets and seats (layout.json)
    const roles = Object.fromEntries(applied.filter((e): e is Extract<OfficeEvent, { type: "enter" }> => e.type === "enter").map((e) => [e.agent.uid, e.agent.role]));
    expect(roles).toMatchObject({ dottore: "dottore", mantenitore: "mantenitore", capitano: "capitano" });
  });

  it("draws them too when the VPS probe fails altogether", async () => {
    agents = SEVEN;
    snapshotReply = async () => { throw { code: "onboarding_host_missing" }; };
    mount();
    await waitFor(() => expect(entered()).toHaveLength(7));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a list that cannot be read is said, and nothing old is drawn", async () => {
    controlReply = async () => ({ ok: false, error: "agent_control_unavailable" });
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(entered()).toEqual([]);
  });

  it("follows a hint of the state channel at once, not at the next tick", async () => {
    resetStateStreamForTests();
    channel.handlers.clear();
    await startStateStream();
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano", "dottore", "scout-1"]));
    agents = [...agents, agent("SCORER-1", "scorer", "1", "lavora")];
    await act(async () => channel.handlers.get("state-stream://event")!({ payload: { topic: "agents" } }));
    await waitFor(() => expect(entered()).toEqual(["capitano", "dottore", "scorer-1", "scout-1"]));
  });

  it("says in every language, for a click on an agent, that its moves cannot be read from here", () => {
    for (const locale of locales) {
      const said = EXISTING_TEAM_READONLY_TEXT[locale].officeAgentNoMovesHere;
      expect(said.trim().length, locale).toBeGreaterThan(20);
      expect(said, locale).not.toMatch(/VPS/);
      expect(said, locale).not.toBe(EXISTING_TEAM_READONLY_TEXT[locale].officeAgentNoMoves);
    }
  });
});
