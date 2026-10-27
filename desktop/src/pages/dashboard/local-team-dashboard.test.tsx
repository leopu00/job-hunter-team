import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.unstubAllGlobals();
});

describe("Dashboard of a local profile", () => {
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
  it("shows the activity counted in the team's database, says the status and the standing orders are not shown yet, and asks the cloud for nothing", async () => {
    const today = new Date().toISOString().slice(0, 10);
    reply = (_command, request) =>
      request.op === "directives"
        ? { ok: true, data: { items: [{ id: 9, body: "Candidati solo in remoto", kind: "order", status: "active", sort_order: 1, created_by: "user", created_at: "2026-10-01T10:00:00Z", updated_at: null, archived_at: null }] } }
        : request.op === "team_activity"
        ? {
            ok: true,
            data: {
              daily: [{ role: "scout", actor: "Scout-1", day: today, n: 4 }],
              newest: [{ role: "scout", actor: "Scout-1", ts: `${today}T09:00:00Z`, pid: "5" }],
              seen: [{ role: "scout", actor: "Scout-1", last: `${today}T09:00:00Z` }],
              meta: { "5": { legacy_id: 105, title: "Synthetic role five", company: "Synthetic Co" } },
            },
          }
        : { ok: true, data: syntheticStats() };
    navigate("/team", { replace: true });
    render(<Shell />);
    const note = await screen.findByTestId("team-local-profile");
    expect(note).toHaveTextContent("lo stato della squadra è un dato del cloud");
    expect(await screen.findByText("Synthetic role five")).toBeInTheDocument();
    // the board of standing orders, read from the team's database, with no control that writes
    expect(await screen.findByText("Candidati solo in remoto")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/./, { selector: "textarea" })).toBeNull();
    const asked = native.invoke.mock.calls
      .filter(([command]) => command === "existing_team_positions_read")
      .map(([, args]) => args.request as { op: string; from?: string; to?: string });
    const activity = asked.find((request) => request.op === "team_activity");
    expect(activity?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(activity?.to).toBe(today);
    expect(fake.current!.calls).toEqual([]);
    expect(apiCalls.filter((call) => /\/api\/team(-state|-directives|\/status)/.test(call))).toEqual([]);
  });
});
