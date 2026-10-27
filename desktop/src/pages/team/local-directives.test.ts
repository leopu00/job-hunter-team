import { afterEach, describe, expect, it, vi } from "vitest";
import { notInDesktop } from "../../shell/api-bridge";
import { setLocalTeamData } from "../../lib/local-team-data";
import { teamApi } from "./team-api";

// The board of standing orders of a local profile: read from the team's own database through the bridge, in the
// shape the web's local branch answers, and never from the cloud. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));

afterEach(() => {
  setLocalTeamData(null);
  native.invoke.mockReset();
  vi.unstubAllGlobals();
});

const window_ = () => vi.stubGlobal("window", { location: { href: "http://localhost/", origin: "http://localhost" } });

describe("GET /api/team-directives of a local profile", () => {
  it("answers {directives, source: local} from the bridge, and asks the cloud route for nothing", async () => {
    window_();
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({ ok: true, data: { items: [{ id: 3, body: "Cerca solo ruoli remoti", kind: "order", status: "active" }] } });
    const next = vi.fn(notInDesktop);
    const answer = await teamApi(next)("/api/team-directives", { method: "GET" });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ directives: [{ id: 3, body: "Cerca solo ruoli remoti", kind: "order", status: "active" }], source: "local" });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "directives" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("says why when the board cannot be read, with a 503 the panel treats as «nothing to show»", async () => {
    window_();
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({ ok: false, error: "local_team_not_running", kind: "application" });
    const answer = await teamApi(vi.fn(notInDesktop))("/api/team-directives", { method: "GET" });
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "local_team_not_running" });
  });

  it("leaves the other methods and routes, and every other profile, where they were", async () => {
    window_();
    const next = vi.fn(notInDesktop);
    const api = teamApi(next);
    // not in the local mode: the route module runs as before (no bridge call)
    await api("/api/team-directives", { method: "GET" }).catch(() => undefined);
    expect(native.invoke).not.toHaveBeenCalled();
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValue({ ok: true, data: { items: [] } });
    await api("/api/team/status", { method: "GET" }).catch(() => undefined);
    await api("/api/team-directives", { method: "POST" }).catch(() => undefined);
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
