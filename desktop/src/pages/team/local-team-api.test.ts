import { afterEach, describe, expect, it, vi } from "vitest";
import { notInDesktop } from "../../shell/api-bridge";
import { setLocalTeamData } from "../../lib/local-team-data";
import { localTeamApi } from "./local-team-api";

// The Team page of a local profile reads the board of standing orders and the status card's row from the team of
// this computer, never from the cloud. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));

afterEach(() => {
  setLocalTeamData(null);
  native.invoke.mockReset();
  vi.unstubAllGlobals();
});

const page = () => vi.stubGlobal("window", { location: { href: "http://localhost/", origin: "http://localhost" } });

/** The native side: positions_read for the board, agent_control for the agents. */
function team(options: { board?: unknown; up?: boolean; halted?: boolean; down?: boolean }) {
  native.invoke.mockImplementation(async (command: string, args: { request: { op: string } }) => {
    if (command === "existing_team_positions_read") return options.board ?? { ok: true, data: { items: [] } };
    if (options.down) return { ok: false, error: "agent_control_no_team" };
    if (args.request.op === "list") {
      const agent = (name: string, role: string, state: string) => ({ name, role, instance: null, up: state !== "spento", created: 1, activity: 1, state, reason: null, since: null, until: null });
      return { ok: true, data: { agents: [agent("CAPITANO", "capitano", options.up === false ? "spento" : "lavora")], roles: [{ role: "capitano", multi: false }], states: true, target: "T1", where: "local", label: null } };
    }
    if (args.request.op === "team") return { ok: true, data: { halted: options.halted ?? false, standby: { state: "off", until: null, weeklyReset: false }, held: [] } };
    return { ok: false, error: "agent_control_unsupported" };
  });
}

describe("GET /api/team-directives of a local profile", () => {
  it("answers {directives, source: local} from the bridge, and asks the cloud route for nothing", async () => {
    page();
    setLocalTeamData("local:abc");
    team({ board: { ok: true, data: { items: [{ id: 3, body: "Cerca solo ruoli remoti", kind: "order", status: "active" }] } } });
    const next = vi.fn(notInDesktop);
    const answer = await localTeamApi(next)("/api/team-directives", { method: "GET" });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ directives: [{ id: 3, body: "Cerca solo ruoli remoti", kind: "order", status: "active" }], source: "local" });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "directives" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("says why when the board cannot be read, with a 503 the panel treats as «nothing to show»", async () => {
    page();
    setLocalTeamData("local:abc");
    team({ board: { ok: false, error: "local_team_not_running", kind: "application" } });
    const answer = await localTeamApi(vi.fn(notInDesktop))("/api/team-directives", { method: "GET" });
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "local_team_not_running" });
  });
});

describe("GET /api/team-state of a local profile (the status card)", () => {
  it("is running when an agent is up and the team is not stopped, with no device heartbeat to show", async () => {
    page();
    setLocalTeamData("local:abc");
    team({ up: true });
    const answer = await localTeamApi(vi.fn(notInDesktop))("/api/team-state", { method: "GET" });
    const { state } = (await answer.json()) as { state: Record<string, unknown> };
    expect(state.is_running).toBe(true);
    expect(state.should_run).toBe(true);
    // the time of a read is not a heartbeat: it would say «now» whatever the team did
    expect(state.last_heartbeat_at).toBeNull();
    expect(state.emergency_stop_requested_at).toBeNull();
    expect(state.last_action).toBeNull();
  });

  it("is stopped when nobody is up, or when the person stopped the team", async () => {
    page();
    setLocalTeamData("local:abc");
    team({ up: false });
    expect(((await (await localTeamApi(vi.fn(notInDesktop))("/api/team-state", { method: "GET" })).json()) as { state: { is_running: boolean } }).state.is_running).toBe(false);
    team({ up: true, halted: true });
    const halted = ((await (await localTeamApi(vi.fn(notInDesktop))("/api/team-state", { method: "GET" })).json()) as { state: { is_running: boolean; should_run: boolean } }).state;
    expect(halted).toMatchObject({ is_running: false, should_run: false });
  });

  it("is null, which the card says as «not available», when the team cannot be read", async () => {
    page();
    setLocalTeamData("local:abc");
    team({ down: true });
    expect(await (await localTeamApi(vi.fn(notInDesktop))("/api/team-state", { method: "GET" })).json()).toEqual({ state: null });
  });
});

describe("the local Team routes leave everything else where it was", () => {
  it("does nothing outside the mode, for another method, or for another route", async () => {
    page();
    const next = vi.fn(notInDesktop);
    const api = localTeamApi(next);
    await api("/api/team-directives", { method: "GET" });
    await api("/api/team-state", { method: "GET" });
    expect(native.invoke).not.toHaveBeenCalled();
    setLocalTeamData("local:abc");
    team({});
    await api("/api/team-directives", { method: "POST" });
    await api("/api/team-state", { method: "PATCH" });
    await api("/api/team/status", { method: "GET" });
    expect(native.invoke).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(5);
  });
});
