import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeEvent, OfficeLayout, OfficeManifest, OfficeSceneOptions } from "../../office/contract";
import { diffOfficeSnapshots } from "../../office/data/diff";
import { emptyEngine } from "../../office/parts";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import { READ_ONLY_NAV, READ_ONLY_ROUTES, ROUTES } from "../../shell/routes";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { realSnapshotReply } from "../../test-support/snapshot-command-reply";

// The route: /office is in the read-only view of an existing team, with its
// link, and it is the page fed by the team's VPS, not the cloud's.
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
vi.mock("./index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index")>()),
  default: () => <h1>Ufficio del cloud</h1>,
}));
const scene = vi.hoisted(() => ({ options: null as unknown, setAgentStatuses: vi.fn() }));
vi.mock("../../office/scene/pixi-scene", () => ({
  createOfficeScene: vi.fn(async (_host: HTMLElement, options: OfficeSceneOptions) => {
    scene.options = options;
    return { resize: vi.fn(), destroy: vi.fn(), setAgentStatuses: scene.setAgentStatuses, focus: vi.fn(() => null) };
  }),
}));
const applied: OfficeEvent[] = [];
vi.mock("../../office/parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../office/parts")>()),
  loadParts: vi.fn(async () => ({
    createEngine: () => ({ ...emptyEngine(), apply: (e: OfficeEvent) => applied.push(e) }),
    data: { load: vi.fn(), diff: diffOfficeSnapshots },
  })),
}));

const LAYOUT = { version: 1, departments: [], furniture: [] } as unknown as OfficeLayout;
const MANIFEST: OfficeManifest = { version: 1, layout: "/office/layout.json", characters: [], atlases: [] };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let restoreBridge: () => void;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  applied.length = 0;
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "onboarding_resume_snapshot") return realSnapshotReply();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/office/manifest.json" ? json(MANIFEST) : url === "/office/layout.json" ? json(LAYOUT) : json({}))),
  );
  restoreBridge = installApiBridge(shellApi(notInDesktop));
  enterExistingTeamReadOnly(true, { at: Date.UTC(2026, 9, 18, 21, 0, 0), captainRunning: true, assistantRunning: true });
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.unstubAllGlobals();
});

describe("/office in the read-only view of an existing team", () => {
  it("is a route of that view, and a full-bleed one, next to the cloud's own", () => {
    const route = READ_ONLY_ROUTES.find((r) => r.path === "/office");
    expect(route?.fullBleed).toBe(true);
    // not the cloud's page: that one reads Realtime and the cloud's positions
    expect(route?.page).not.toBe(ROUTES.find((r) => r.path === "/office")?.page);
    expect(READ_ONLY_NAV.map((n) => n.href)).toContain("/office");
  });

  it("opens from the navigation and draws the sessions the VPS reports", async () => {
    navigate("/team", { replace: true });
    const { container } = render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    const link = within(nav).getByRole("link", { name: "Ufficio" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/office"));
    expect(container.querySelector('[data-testid="office-page"]')).toBeNull();

    navigate("/office", { replace: true });
    expect(await screen.findByTestId("office-page")).toBeInTheDocument();
    expect(screen.queryByText("Ufficio del cloud")).toBeNull();
    await waitFor(() => expect(applied.filter((e) => e.type === "enter")).toHaveLength(2));
    expect(within(screen.getByRole("navigation", { name: "Navigazione app" })).getByRole("link", { name: "Ufficio" })).toHaveAttribute("aria-current", "page");
    // the cloud was not read for any of it
    expect(fake.current!.calls).toEqual([]);
  });
});
