import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAuthStorageProbe } from "../../lib/auth-storage-lock";
import { setLocalTeamData } from "../../lib/local-team-data";
import { installApiBridge, notInDesktop, shellApi, type ApiFetch } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { syntheticStats } from "../../test-support/existing-team-stats-fixture";
import { describeError } from "../../lib/error-catalog";

// The Shell of a local profile (no cloud account), on its Dashboard: the numbers come from the team of this
// computer through the native read, the cloud is asked for nothing, and a team that is not running says so
// with the button that starts it. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class { onmessage: unknown = null } }));
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
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

let apiCalls: string[] = [];
let restoreBridge: () => void;
let reply: (command: string, request: { op: string }) => unknown;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  apiCalls = [];
  reply = () => ({ ok: true, data: syntheticStats() });
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args?: { request: { op: string } }) => reply(command, args?.request ?? { op: "" }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ rates: { USD: 1.1 } }), { status: 200 })));
  const record = (next: ApiFetch): ApiFetch => async (input, init) => {
    apiCalls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    return next(input, init);
  };
  restoreBridge = installApiBridge(record(shellApi(notInDesktop)));
  setLocalTeamData("local:synthetic");
});
afterEach(() => {
  cleanup();
  restoreBridge();
  setLocalTeamData(null);
  registerAuthStorageProbe(() => true);
  vi.unstubAllGlobals();
});

describe("Dashboard of a local profile", () => {
  it("does not say «this data comes from the cloud, sign in» when there is no sign-in: the data is the team's, on this computer", async () => {
    // a local profile has no cloud session to read: the pages that read the cloud say so, this one does not read it
    registerAuthStorageProbe(() => false);
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    expect(await screen.findByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/Questi dati arrivano dal cloud/)).not.toBeInTheDocument();
  });

  it("draws the numbers the team of this computer counted, with the usual navigation and nothing asked of the cloud", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    expect(await screen.findByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
    expect((await screen.findAllByText("Synthetic team role 11")).length).toBeGreaterThan(0);
    // the full app's menu, not the linked team's short one
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getAllByRole("link").length).toBeGreaterThan(6);
    expect(fake.current!.calls).toEqual([]);
    expect(fake.current!.rpc).toEqual([]);
    expect(apiCalls.filter((call) => !call.startsWith("GET "))).toEqual([]);
    const reads = native.invoke.mock.calls.filter(([command]) => command === "existing_team_positions_read");
    expect(reads.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("local-team-stopped")).toBeNull();
  });

  it("with the team stopped says why, offers «Avvia la squadra», and reads again once it is up", async () => {
    let up = false;
    reply = (command) => {
      if (command === "onboarding_resume_team_start") {
        up = true;
        return {};
      }
      return up ? { ok: true, data: syntheticStats() } : { ok: false, error: "local_team_not_running", kind: "application" };
    };
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const bar = await screen.findByTestId("local-team-stopped");
    const told = describeError("local_team_not_running", { locale: "it" });
    expect(bar).toHaveTextContent(told.text);
    await userEvent.click(within(bar).getByTestId("start-team"));
    expect(await screen.findByText("12 posizioni totali · 1 escluse · 11 attive")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("local-team-stopped")).toBeNull());
    expect(native.invoke.mock.calls.filter(([command]) => command === "onboarding_resume_team_start")).toHaveLength(1);
  });
});

describe("Team page of a local profile", () => {
  it("says the status, the standing orders and the activity are not shown yet, and reads nothing from the cloud", async () => {
    navigate("/team", { replace: true });
    render(<Shell />);
    const note = await screen.findByTestId("team-local-profile");
    expect(note).toHaveTextContent("non mostra ancora lo stato, le direttive e l’attività degli agenti");
    expect(note).toHaveTextContent("Agenti");
    expect(fake.current!.calls).toEqual([]);
    expect(apiCalls.filter((call) => call.includes("/api/team"))).toEqual([]);
  });
});
