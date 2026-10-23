import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeClick, OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions } from "../../office/contract";
import { diffOfficeSnapshots } from "../../office/data/diff";
import { emptyEngine } from "../../office/parts";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { describeError } from "../../lib/error-catalog";
import { refresh } from "../../shell/router";
import { realSnapshotReply } from "../../test-support/snapshot-command-reply";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { EXISTING_TEAM_STATUS_TEXT } from "../existing-team/existing-team-status.i18n";

// /office in the read-only view of an existing team: the same office, fed by
// the probe behind the Squadra page (here the native command, answered by a
// fake VPS), with no cloud and no Realtime. Synthetic data only.
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
// Any touch of the cloud client is a failure of this view: it records it.
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
import ExistingTeamOfficePage from "./readonly";

const T = EXISTING_TEAM_STATUS_TEXT.it;
const COMMAND = "onboarding_resume_snapshot";
const LAYOUT = { version: 1, departments: [], furniture: [] } as unknown as OfficeLayout;
const MANIFEST: OfficeManifest = { version: 1, layout: "/office/layout.json", characters: [], atlases: [] };
const CONNECTION = { at: Date.UTC(2026, 9, 18, 21, 0, 0), captainRunning: true, assistantRunning: true };

const POSITIONS = "existing_team_positions_read";
const AGENTS = "existing_team_agents_read";
let agentsReply: () => Promise<unknown> = async () => ({ ok: false, error: "agents_unavailable" });
const TEAM_ROWS = [
  { id: "11", legacy_id: 11, title: "Cercatore di nuovi", company: "Alfa", status: "new", location: "Roma", found_at: new Date().toISOString(), score: null },
  { id: "12", legacy_id: 12, title: "Da punteggiare", company: "Beta", status: "scored", location: "Milano", found_at: "2026-10-16T09:00:00Z", score: 74, write_requested: false },
  { id: "13", legacy_id: 13, title: "CV con pass", company: "Gamma", status: "ready", location: "Roma", found_at: "2026-10-15T09:00:00Z", score: 88, critic_verdict: "pass", critic_score: 9, written_at: "2026-10-16T12:00:00Z" },
  { id: "14", legacy_id: 14, title: "Candidatura inviata", company: "Delta", status: "applied", location: "Torino", found_at: "2026-10-14T09:00:00Z", score: 81, written_at: "2026-10-15T12:00:00Z", critic_verdict: "pass" },
];
let positions: () => Promise<unknown>;
const positionReads = () => native.invoke.mock.calls.filter(([command]) => command === POSITIONS);
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let answer: () => Promise<unknown>;
let applied: OfficeEvent[];
let load: ReturnType<typeof vi.fn>;
const reads = () => native.invoke.mock.calls.filter(([command]) => command === COMMAND).length;
const mount = () => render(<ExistingTeamOfficePage params={{}} search={new URLSearchParams()} />);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  cloud.touched = [];
  statusQuery.calls = 0;
  scene.options = null;
  scene.setAgentStatuses.mockReset();
  scene.destroy.mockReset();
  applied = [];
  load = vi.fn();
  parts.value = {
    createEngine: vi.fn(() => ({ ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) })),
    data: { load, diff: diffOfficeSnapshots },
  };
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  answer = async () => realSnapshotReply();
  positions = async () => ({ ok: true, data: { items: TEAM_ROWS, total: TEAM_ROWS.length } });
  resetVpsPositionsShared();
  resetTeamAgentsShared();
  agentsReply = async () => ({ ok: false, error: "agents_unavailable" });
  native.invoke.mockImplementation(async (command: string) => {
    if (command === COMMAND) return answer();
    if (command === POSITIONS) return positions();
    if (command === AGENTS) return agentsReply();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(LAYOUT) : new Response("{}", { status: 404 }))),
  );
  enterExistingTeamReadOnly(true, CONNECTION);
});
afterEach(() => {
  cleanup();
  leaveExistingTeamReadOnly();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const entered = () => applied.filter((e): e is Extract<OfficeEvent, { type: "enter" }> => e.type === "enter").map((e) => e.agent.uid);

describe("the office of an existing team, over its VPS", () => {
  it("seats the captain and the assistant the VPS reports, grey and of unknown status, and reads no cloud", async () => {
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano", "assistente"]));
    expect(applied.filter((e) => e.type === "enter").every((e) => e.type === "enter" && e.atOnce)).toBe(true);
    await waitFor(() =>
      expect(scene.setAgentStatuses).toHaveBeenLastCalledWith({
        at: CONNECTION.at,
        agents: { capitano: { status: "unknown" }, assistente: { status: "unknown" } },
      }),
    );
    expect(reads()).toBe(1);
    // the cloud's data layer, the tags' query and the client itself are never touched
    expect(load).not.toHaveBeenCalled();
    expect(statusQuery.calls).toBe(0);
    expect(cloud.touched).toEqual([]);
  });

  it("a team that is off: an empty office and the Squadra page's sentence", async () => {
    answer = async () => realSnapshotReply({ containerRunning: false });
    mount();
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
    expect(entered()).toEqual([]);
    expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(null);
    expect(cloud.touched).toEqual([]);
  });

  it("a probe that fails: nobody is drawn and the alert is the catalog's sentence", async () => {
    answer = async () => {
      throw { code: "ssh_unavailable" };
    };
    mount();
    const alert = await screen.findByRole("alert");
    const failure = describeError("ssh_unavailable", { fallback: "existing_team_unavailable", locale: "it" });
    expect(alert).toHaveTextContent(failure.text);
    expect(alert).toHaveTextContent(failure.action);
    expect(entered()).toEqual([]);
    expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(null);
  });

  it("«Aggiorna» is one read, as on the Squadra page, and nothing reads on a timer", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    expect(reads()).toBe(1);
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(reads()).toBe(1);
    vi.useRealTimers();
    await act(async () => refresh());
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("a refresh that finds the team gone empties the office: the old reading is not the present", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    answer = async () => realSnapshotReply({ containerRunning: false });
    await act(async () => refresh());
    await waitFor(() => expect(applied.filter((e) => e.type === "leave").map((e) => e.type === "leave" && e.uid).sort()).toEqual(["assistente", "capitano"]));
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
  });

  it("a read that finishes after a newer one is not shown: the older answer never replaces the present", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    answer = async () => {
      if (first) {
        first = false;
        await slow;
        return realSnapshotReply();
      }
      return realSnapshotReply({ containerRunning: false });
    };
    mount();
    await waitFor(() => expect(reads()).toBe(1));
    await act(async () => refresh());
    await waitFor(() => expect(reads()).toBe(2));
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(entered()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
  });

  it("the connection's sessions changing draws the office again from the same reading, with no new read", async () => {
    enterExistingTeamReadOnly(true, { ...CONNECTION, assistantRunning: false });
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano"]));
    expect(reads()).toBe(1);
    await act(async () => enterExistingTeamReadOnly(true, { ...CONNECTION, at: CONNECTION.at + 5_000, assistantRunning: true, source: "assistant_start" }));
    await waitFor(() => expect(entered()).toEqual(["capitano", "assistente"]));
    expect(reads()).toBe(1);
  });

  const panelOf = () => screen.findByRole("complementary", { name: "Dettagli dell'ufficio" });

  it("a pile opens its panel with the team's positions of that phase, read from the VPS, and the cloud is not asked", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    // the piles of the scene came with the office: the one read, which the panel below reuses
    await waitFor(() => expect(positionReads()).toHaveLength(1));
    act(() => scene.options!.onClick({ kind: "pile", dept: "scout" }));
    const panel = await panelOf();
    expect(await within(panel).findByText("Cercatore di nuovi · Alfa")).toBeInTheDocument();
    expect(within(panel).queryByText("Da punteggiare · Beta")).toBeNull();
    expect(positionReads()).toHaveLength(1);
    expect(cloud.touched).toEqual([]);
  });

  it("the scorer's pile, the CV shelf, the board and the hologram open from the same one read", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    act(() => scene.options!.onClick({ kind: "pile", dept: "scorer" }));
    expect(await within(await panelOf()).findByText("Da punteggiare · Beta")).toBeInTheDocument();

    act(() => scene.options!.onClick({ kind: "shelf" }));
    const shelf = await screen.findByText("CV prodotti");
    expect(shelf).toBeInTheDocument();
    const panel = await panelOf();
    // two CVs written (the ready one and the sent one), both with a pass
    await waitFor(() => expect(within(panel).getByText("scritti").previousElementSibling).toHaveTextContent("2"));
    expect(within(panel).getByText("pass").previousElementSibling).toHaveTextContent("2");
    expect(within(panel).getByText("CV con pass · Gamma")).toBeInTheDocument();

    act(() => scene.options!.onClick({ kind: "board" }));
    expect(await screen.findByText("Bacheca")).toBeInTheDocument();
    expect(await within(await panelOf()).findByText("Candidatura inviata · Delta")).toBeInTheDocument();

    act(() => scene.options!.onClick({ kind: "hologram" }));
    expect(await screen.findByText(/4 posizioni con un luogo/)).toBeInTheDocument();
    const places = within(await panelOf());
    expect(places.getByText("Roma").nextElementSibling).toHaveTextContent("2");

    // one list served all of them
    expect(positionReads()).toHaveLength(1);
    expect(cloud.touched).toEqual([]);
  });

  it("the scout's department shows what was found in the last days, from the same list", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    act(() => scene.options!.onClick({ kind: "department", dept: "scout" }));
    expect(await screen.findByText("Trovate negli ultimi 7 giorni")).toBeInTheDocument();
    const chart = await screen.findByRole("img");
    // the position found today is one of the days
    await waitFor(() => expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/: 1(,|$)/));
    expect(chart).toBeInTheDocument();
    expect(cloud.touched).toEqual([]);
  });

  it("an agent has no panel here: one line above the scene says why, in the person's language, and nothing is read", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    const click: OfficeClick = { kind: "agent", uid: "capitano", role: "capitano" };
    act(() => scene.options!.onClick(click));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByTestId("office-agent-note")).toHaveTextContent(EXISTING_TEAM_READONLY_TEXT.it.officeAgentNoMoves);
    // no speech bubble is drawn over the agents: two of them covered each other
    expect(applied.filter((e) => e.type === "say")).toEqual([]);
    // a second click replaces the line, it does not add one
    act(() => scene.options!.onClick({ kind: "agent", uid: "assistente", role: "assistente" }));
    expect(screen.getAllByTestId("office-agent-note")).toHaveLength(1);
    expect(positionReads()).toHaveLength(1); // only the office's own, none for a panel
    expect(cloud.touched).toEqual([]);
  });

  it("the piles of the scene are counted from the team's positions, with the read the panels share", async () => {
    mount();
    await waitFor(() => expect(applied.some((e) => e.type === "piles")).toBe(true));
    const piles = applied.filter((e): e is Extract<OfficeEvent, { type: "piles" }> => e.type === "piles").at(-1)!.piles;
    // new 1, scored 1 (not asked to write), ready with a pass 1; the sent one is on no pile
    expect(piles).toEqual({ scout: 1, analisti: 0, scorer: 1, scrittori: 0, critici: 1 });
    expect(positionReads()).toHaveLength(1);
    // a panel opened afterwards reuses the read
    act(() => scene.options!.onClick({ kind: "pile", dept: "scout" }));
    await within(await panelOf()).findByText("Cercatore di nuovi · Alfa");
    expect(positionReads()).toHaveLength(1);
    expect(cloud.touched).toEqual([]);
  });

  it("piles that could not be read are unknown, not zero, and the agents are still drawn", async () => {
    positions = async () => ({ ok: false, error: "ssh_unavailable" });
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    await waitFor(() => expect(positionReads()).toHaveLength(1));
    const piles = applied.filter((e): e is Extract<OfficeEvent, { type: "piles" }> => e.type === "piles").at(-1)!.piles;
    expect(Object.values(piles)).toEqual([null, null, null, null, null]);
  });

  it("a team that is off reads no positions at all", async () => {
    answer = async () => realSnapshotReply({ containerRunning: false });
    mount();
    expect(await screen.findByRole("status")).toHaveTextContent(T.fields.containerRunning.no);
    expect(positionReads()).toHaveLength(0);
  });

  it("a team whose positions cannot be read says why with the catalog's sentence: not an empty list", async () => {
    positions = async () => ({ ok: false, error: "ssh_unavailable" });
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    act(() => scene.options!.onClick({ kind: "pile", dept: "scout" }));
    const panel = await panelOf();
    const failure = describeError("ssh_unavailable", { fallback: "existing_team_unavailable", locale: "it" });
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent(failure.text);
    expect(alert).toHaveTextContent(failure.action);
    expect(within(panel).queryByText("Nessuna posizione in questa fase.")).toBeNull();
    expect(panel).not.toHaveTextContent("cloud");
  });

  it("reads and never writes: the VPS is asked for a list only, and no request leaves for the cloud", async () => {
    mount();
    await waitFor(() => expect(entered()).toHaveLength(2));
    act(() => scene.options!.onClick({ kind: "pile", dept: "scout" }));
    await panelOf();
    await waitFor(() => expect(positionReads()).toHaveLength(1));
    for (const [, args] of positionReads()) expect((args as { request: { op: string } }).request.op).toBe("list");
    const commands = native.invoke.mock.calls.map(([command]) => command);
    expect(new Set(commands)).toEqual(new Set([COMMAND, POSITIONS, AGENTS]));
    // the agents are asked for their list only: never a terminal, never a write
    for (const [command, args] of native.invoke.mock.calls) {
      if (command === AGENTS) expect(args).toEqual({ request: { op: "list" } });
    }
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => url.startsWith("/office/"))).toBe(true);
  });

  it("draws every agent of the team the Agents page reads, by role and instance, not only the captain and the assistant", async () => {
    const agent = (name: string, role: string, state: string | null) => ({
      name, role, instance: null, up: true, created: null, activity: null, state, reason: null, since: null, until: null,
    });
    agentsReply = async () => ({
      ok: true,
      data: {
        agents: [agent("CAPITANO", "capitano", "lavora"), agent("SCOUT-1", "scout", "idle"), agent("SCOUT-2", "scout", null), agent("CRITICO-S3", "critico", null), agent("CLOSER-1", "closer", null)],
        roles: [],
        states: true,
      },
    });
    mount();
    await waitFor(() => expect(entered()).toEqual(["capitano", "scout-1", "scout-2", "critico-s3"]));
    expect(native.invoke.mock.calls.filter(([command]) => command === AGENTS)).toHaveLength(1);
  });

  it("says so when the office's art is not in the app", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })));
    mount();
    expect(await screen.findByText("L'arte dell'ufficio non è ancora nell'app.")).toBeInTheDocument();
    expect(reads()).toBe(0);
  });
});
