import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeClick, OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions, OfficeSnapshot } from "../../office/contract";
import { emptyEngine, loadAssets } from "../../office/parts";
import { currentLocation, navigate } from "../../shell/router";

// jsdom has no WebGL: the scene is replaced, and the test sees what the page gives it.
const scene = { options: null as OfficeSceneOptions | null, resize: vi.fn(), destroy: vi.fn(), setAgentStatuses: vi.fn() };
vi.mock("../../office/scene/pixi-scene", () => ({
  createOfficeScene: vi.fn(async (_host: HTMLElement, options: OfficeSceneOptions) => {
    scene.options = options;
    return { resize: scene.resize, destroy: scene.destroy, setAgentStatuses: scene.setAgentStatuses };
  }),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { from: vi.fn() } }));
const statuses = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../office/status", () => ({ loadAgentStatuses: vi.fn(async () => statuses.value) }));

const parts = vi.hoisted(() => ({ value: { createEngine: null as unknown, data: null as unknown } }));
vi.mock("../../office/parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/parts")>()),
  loadParts: vi.fn(async () => parts.value),
}));

import OfficePage from "./index";

const LAYOUT = { version: 1, departments: [], furniture: [] } as unknown as OfficeLayout;
const MANIFEST: OfficeManifest = { version: 1, layout: "/office/layout.json", characters: [], atlases: [] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
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
    expect(diff).toHaveBeenCalledWith(null, snapshot);
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

  it("a click in the scene opens the page it points to", async () => {
    navigate("/office", { replace: true });
    render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    const click: OfficeClick = { kind: "agent", uid: "scout-1", role: "scout" };
    act(() => scene.options!.onClick(click));
    expect(currentLocation()).toEqual({ path: "/agents", search: "?agent=scout" });
  });

  it("the scene is destroyed when the page goes", async () => {
    const { unmount } = render(<OfficePage params={{}} search={new URLSearchParams()} />);
    await waitFor(() => expect(scene.options).not.toBeNull());
    unmount();
    expect(scene.destroy).toHaveBeenCalled();
  });
});
