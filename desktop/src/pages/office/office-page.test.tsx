import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeClick, OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions, OfficeSnapshot } from "../../office/contract";
import { emptyEngine, loadAssets } from "../../office/parts";
import { currentLocation, navigate } from "../../shell/router";

// jsdom has no WebGL: the scene is replaced, and the test sees what the page gives it.
const scene = {
  options: null as OfficeSceneOptions | null,
  resize: vi.fn(),
  destroy: vi.fn(),
  setAgentStatuses: vi.fn(),
  focus: vi.fn((t: unknown) => (t ? { x: 100, y: 50, w: 40, h: 60 } : null)),
};
vi.mock("../../office/scene/pixi-scene", () => ({
  createOfficeScene: vi.fn(async (_host: HTMLElement, options: OfficeSceneOptions) => {
    scene.options = options;
    return { resize: scene.resize, destroy: scene.destroy, setAgentStatuses: scene.setAgentStatuses, focus: scene.focus };
  }),
}));
// The client the page gets: no session by default (no channel, the reads alone);
// the channel's test gives it one.
const sb = vi.hoisted(() => ({ client: { from: () => undefined } as Record<string, unknown> }));
vi.mock("../../lib/supabase", () => ({
  supabase: new Proxy({}, { get: (_, key) => sb.client[key as string] }),
}));
const statuses = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../office/status", () => ({ loadAgentStatuses: vi.fn(async () => statuses.value) }));

const parts = vi.hoisted(() => ({ value: { createEngine: null as unknown, data: null as unknown } }));
vi.mock("../../office/parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/parts")>()),
  loadParts: vi.fn(async () => parts.value),
}));

import { diffOfficeSnapshots } from "../../office/data/diff";
import OfficePage from "./index";

const LAYOUT = { version: 1, departments: [], furniture: [] } as unknown as OfficeLayout;
const MANIFEST: OfficeManifest = { version: 1, layout: "/office/layout.json", characters: [], atlases: [] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  sb.client = { from: vi.fn() };
  scene.options = null;
  scene.destroy.mockReset();
  parts.value = { createEngine: null, data: null };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(LAYOUT) : json({}, 404))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("loadAssets", () => {
  it("reads the manifest, then the layout it names", async () => {
    expect(await loadAssets()).toEqual({ manifest: MANIFEST, layout: LAYOUT });
  });

  it("is null when the assets are not in the app (the page's HTML answers instead)", async () => {
    const html = vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await loadAssets(html as unknown as typeof fetch)).toBeNull();
  });
});

describe("the office page", () => {
  it("without the engine and the data it draws the office empty, and says why", async () => {
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    expect(scene.options!.engine.poses()).toEqual([]);
    expect(scene.options!.engine.piles().scout).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("nessun agente in scena");
  });

  it("says so when the assets are missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })));
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByText("L'arte dell'ufficio non è ancora nell'app.")).toBeInTheDocument();
  });

  it("feeds the engine what changed between snapshots", async () => {
    const applied: OfficeEvent[] = [];
    const engine = { ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) };
    const snapshot = { teamOnline: true } as OfficeSnapshot;
    const diff = vi.fn((prev: OfficeSnapshot | null) => (prev ? [] : [{ type: "say", uid: "capitano", text: "ciao", seconds: 3 } as OfficeEvent]));
    parts.value = { createEngine: vi.fn(() => engine), data: { load: vi.fn(async () => snapshot), diff } };
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(diff).toHaveBeenCalledWith(null, expect.objectContaining(snapshot));
  });

  it("with reduced motion a real move changes the pile's number, and nobody walks it", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const applied: OfficeEvent[] = [];
    const engine = { ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) };
    const snapshot = { teamOnline: true, roster: [], transitions: [] } as unknown as OfficeSnapshot;
    const position = { id: null, legacyId: 1, title: null, company: null };
    const diff = vi.fn(() => [
      { type: "pipeline", uid: "scorer-1", toState: "scored", position, ts: "2026-09-28T01:00:00.000Z" } as OfficeEvent,
      { type: "piles", piles: { scout: 0, analisti: 0, scorer: 4, scrittori: 0, critici: 0 } } as OfficeEvent,
    ]);
    parts.value = { createEngine: vi.fn(() => engine), data: { load: vi.fn(async () => snapshot), diff } };
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(applied.some((e) => e.type === "piles")).toBe(true));
    expect(applied.filter((e) => e.type === "pipeline")).toEqual([]);
  });

  it("the channel in the page: a transition that arrives on it is its agent's trip at once, and the page's end removes it", async () => {
    const inserts: Array<(p: { new: unknown }) => void> = [];
    let status: (s: string) => void = () => {};
    const channel = {
      on: vi.fn((_: string, filter: { table: string }, cb: (p: { new: unknown }) => void) => {
        if (filter.table === "position_transitions") inserts.push(cb);
        return channel;
      }),
      subscribe: vi.fn((cb: (s: string) => void) => ((status = cb), channel)),
    };
    const removeChannel = vi.fn(async () => "ok");
    sb.client = {
      from: vi.fn(),
      auth: { getSession: async () => ({ data: { session: { access_token: "jwt", user: { id: "user-a" } } } }) },
      realtime: { setAuth: vi.fn(async () => {}) },
      channel: vi.fn(() => channel),
      removeChannel,
    };
    const applied: OfficeEvent[] = [];
    const engine = { ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) };
    const snapshot = {
      teamOnline: true,
      heartbeatAt: "2026-09-28T01:00:00Z",
      roster: [{ uid: "scorer-1", role: "scorer", sheet: "" }],
      piles: { scout: 0, analisti: 3, scorer: 1, scrittori: 0, critici: 0 },
      transitions: [],
    } as unknown as OfficeSnapshot;
    const load = vi.fn(async () => snapshot);
    parts.value = { createEngine: vi.fn(() => engine), data: { load, diff: diffOfficeSnapshots } };
    const { unmount } = render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(applied.some((e) => e.type === "piles")).toBe(true));
    await waitFor(() => expect(inserts).toHaveLength(1));
    act(() => status("SUBSCRIBED"));
    expect(applied.filter((e) => e.type === "pipeline")).toEqual([]);
    act(() => inserts[0]!({ new: { ts: "2026-09-28T01:00:05Z", by_agent: "scorer-1", from_state: "checked", to_state: "scored", position_legacy_id: 7 } }));
    expect(applied.filter((e) => e.type === "pipeline")).toEqual([expect.objectContaining({ uid: "scorer-1", toState: "scored" })]);
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("a team that is off: the office says so, and says empty only when nobody stays", async () => {
    const off = (roster: unknown[]) =>
      ({ teamOnline: false, heartbeatAt: null, roster, piles: { scout: 0, analisti: 0, scorer: 0, scrittori: 0, critici: 0 }, transitions: [] }) as unknown as OfficeSnapshot;
    parts.value = { createEngine: vi.fn(() => emptyEngine()), data: { load: vi.fn(async () => off([{ uid: "scout-1", role: "scout", sheet: "" }])), diff: vi.fn(() => []) } };
    const { unmount } = render(<OfficePage params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByText("Il team è spento: restano gli agenti che hanno lavorato nelle ultime 24 ore.")).toBeInTheDocument();
    unmount();
    parts.value = { createEngine: vi.fn(() => emptyEngine()), data: { load: vi.fn(async () => off([])), diff: vi.fn(() => []) } };
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByText("Il team è spento: l'ufficio è vuoto.")).toBeInTheDocument();
  });

  it("hands the scene the published statuses only while the team is online", async () => {
    statuses.value = { at: Date.now(), agents: { capitano: { status: "working" } } };
    const online = { teamOnline: true } as OfficeSnapshot;
    parts.value = { createEngine: vi.fn(() => emptyEngine()), data: { load: vi.fn(async () => online), diff: vi.fn(() => []) } };
    const { unmount } = render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.setAgentStatuses).toHaveBeenCalledWith(statuses.value));
    unmount();

    scene.setAgentStatuses.mockClear();
    const offline = { teamOnline: false } as OfficeSnapshot;
    parts.value = { createEngine: vi.fn(() => emptyEngine()), data: { load: vi.fn(async () => offline), diff: vi.fn(() => []) } };
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.setAgentStatuses).toHaveBeenCalled());
    expect(scene.setAgentStatuses).toHaveBeenLastCalledWith(null);
  });

  it("a click opens a panel INSIDE the office, never another page; a click on nothing or Esc closes it", async () => {
    navigate("/office", { replace: true });
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    const click: OfficeClick = { kind: "agent", uid: "scout-1", role: "scout" };
    act(() => scene.options!.onClick(click));
    const panel = await screen.findByRole("complementary", { name: "Dettagli dell'ufficio" });
    expect(within(panel).getByRole("heading", { name: "SCOUT-1" })).toBeInTheDocument();
    expect(currentLocation()).toEqual({ path: "/office", search: "" });
    // the scene stays mounted under the panel
    expect(screen.getByTestId("office-canvas")).toBeInTheDocument();

    act(() => scene.options!.onClick(null));
    expect(screen.queryByRole("complementary")).toBeNull();

    act(() => scene.options!.onClick({ kind: "board" }));
    expect(await screen.findByRole("heading", { name: "Bacheca" })).toBeInTheDocument();
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("without a mouse: Tab reaches every object with its tag's words, Enter opens, Esc closes and gives the focus back", async () => {
    const user = userEvent.setup();
    const withObjects = {
      ...LAYOUT,
      furniture: [
        { id: "corkboard", kind: "corkboard", rect: { x: 0, y: 0, w: 10, h: 10 }, blocking: true, image: null },
        { id: "hologram", kind: "hologram", rect: { x: 20, y: 0, w: 10, h: 10 }, blocking: true, image: null },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(withObjects) : json({}, 404))),
    );
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    const list = screen.getByRole("list", { name: "Agenti e oggetti dell'ufficio" });
    const board = within(list).getByRole("button", { name: /^Bacheca/ });
    expect(within(list).getByRole("button", { name: /^Mappa/ })).toBeInTheDocument();

    act(() => board.focus());
    // the scene rings it, and its tag appears beside it
    expect(scene.focus).toHaveBeenLastCalledWith({ kind: "board" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Bacheca");
    expect(screen.getByRole("tooltip").style.left).toBe("154px");

    await user.keyboard("{Enter}");
    const panel = await screen.findByRole("complementary", { name: "Dettagli dell'ufficio" });
    expect(panel).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(board).toHaveFocus();

    act(() => board.blur());
    expect(scene.focus).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the pointer over a target shows its tag, and nothing when it leaves", async () => {
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    act(() => scene.options!.onHover!({ kind: "hologram" }, { x: 100, y: 80 }));
    const tag = screen.getByRole("tooltip");
    expect(tag).toHaveTextContent("Mappa");
    expect(tag.style.left).toBe("114px");
    act(() => scene.options!.onHover!(null, { x: 0, y: 0 }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the scene is destroyed when the page goes", async () => {
    const { unmount } = render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    unmount();
    expect(scene.destroy).toHaveBeenCalled();
  });
});
