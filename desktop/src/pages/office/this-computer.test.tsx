import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeClick, OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions } from "../../office/contract";
import { diffOfficeSnapshots } from "../../office/data/diff";
import { emptyEngine } from "../../office/parts";
import { leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { setLocalTeamData } from "../../lib/local-team-data";
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
let controlReply: () => Promise<unknown>;
let snapshotReply: () => Promise<unknown>;
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
  native.invoke.mockImplementation(async (command: string) => {
    if (command === SNAPSHOT) return snapshotReply();
    if (command === POSITIONS) return { ok: true, data: { items: ROWS, total: ROWS.length } };
    if (command === CONTROL) return controlReply();
    throw new Error(`unexpected native command ${command}`);
  });
  resetVpsPositionsShared();
  resetTeamAgentsShared();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(LAYOUT) : new Response("{}", { status: 404 }))),
  );
  leaveExistingTeamReadOnly();
  setLocalTeamData("local:synthetic");
});
afterEach(() => {
  cleanup();
  setLocalTeamData(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the office of a local profile", () => {
  it("draws the agents that work on this computer, the ones the Agents page lists, and asks the cloud for nothing", async () => {
    mount();
    // the captain and the scout have a character; the doctor has none in the office
    await waitFor(() => expect(entered()).toEqual(["capitano", "scout-1"]));
    expect(calls(CONTROL).length).toBeGreaterThan(0);
    expect(load).not.toHaveBeenCalled();
    expect(statusQuery.calls).toBe(0);
    expect(cloud.touched).toEqual([]);
    await waitFor(() =>
      expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(
        expect.objectContaining({ agents: { capitano: expect.objectContaining({ state: "lavora" }), "scout-1": expect.objectContaining({ state: "idle" }) } }),
      ),
    );
  });

  it("says nothing about the cloud, and never «I cannot read the cloud»", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    expect(screen.queryByText(/cloud/i)).toBeNull();
  });

  it("counts the piles from the team's own positions", async () => {
    mount();
    await waitFor(() => expect(applied.some((e) => e.type === "piles")).toBe(true));
    const piles = applied.filter((e): e is Extract<OfficeEvent, { type: "piles" }> => e.type === "piles").at(-1)!.piles;
    expect(piles.scout).toBe(1);
    expect(piles.scorer).toBe(1);
    expect(calls(POSITIONS).length).toBeGreaterThan(0);
  });

  // Only the interval is faked, and before the page is mounted (an interval made with the real clock is not
  // moved by a fake one made later): the rest of the clock stays real, so the waits of the test still work.
  const fakeInterval = () => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const pass = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it("reads again by itself while the window is in view, and not while it is hidden", async () => {
    fakeInterval();
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    const first = calls(SNAPSHOT).length;
    await pass(THIS_COMPUTER_OFFICE_READ_MS + 500);
    await waitFor(() => expect(calls(SNAPSHOT).length).toBe(first + 1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await pass(THIS_COMPUTER_OFFICE_READ_MS * 3);
    expect(calls(SNAPSHOT).length).toBe(first + 1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("follows the team: an agent that appears is drawn at the next read", async () => {
    fakeInterval();
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano", "scout-1"]));
    agents = [...agents, agent("SCORER-1", "scorer", "1", "lavora")];
    await pass(THIS_COMPUTER_OFFICE_READ_MS + 500);
    await waitFor(() => expect(entered()).toEqual(["capitano", "scorer-1", "scout-1"]));
  });

  it("a click on an agent says its moves cannot be read from here, with no word about a VPS", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    const click: OfficeClick = { kind: "agent", uid: "capitano", role: "capitano" };
    act(() => scene.options!.onClick(click));
    expect(screen.queryByRole("complementary")).toBeNull();
    const note = screen.getByTestId("office-agent-note");
    expect(note).toHaveTextContent(EXISTING_TEAM_READONLY_TEXT.it.officeAgentNoMovesHere);
    expect(note).not.toHaveTextContent(/VPS/);
  });

  it("a team that is off draws an empty office and says so, without an error", async () => {
    snapshotReply = async () => realSnapshotReply({ containerRunning: false });
    mount();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(entered()).toEqual([]);
    expect(calls(CONTROL)).toHaveLength(0);
    expect(calls(POSITIONS)).toHaveLength(0);
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
