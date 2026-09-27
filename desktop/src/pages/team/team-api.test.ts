import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBridge, notInDesktop } from "../../shell/api-bridge";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { teamApi } from "./team-api";

// The /team pages' routes, run as the web routes themselves behind the
// shell's bridge, on a fake desktop client. They must behave as on the web
// cloud deploy. Synthetic data only.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
}));

let restore: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  restore = installApiBridge(teamApi(notInDesktop));
});
afterEach(() => restore());

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const tables = () => fake.current!.calls.map((c) => c.table);
const ops = (table: string) => fake.current!.calls.filter((c) => c.table === table).flatMap((c) => c.ops);

describe("the /team routes in the desktop", () => {
  it.each(["/api/scout/activity", "/api/scorer/activity", "/api/analista/activity", "/api/scrittore/activity", "/api/critico"])(
    "GET %s reads the agents' work from Supabase with the session, not from a local workspace",
    async (path) => {
      fake.current!.rows.positions = [
        { id: "p1", title: "Ruolo sintetico", company: "Azienda A", status: "excluded", notes: "Esclusa: [GEO]" },
      ];
      const res = await fetch(path);
      expect(res.status).toBe(200);
      expect(tables().length).toBeGreaterThan(0);
    },
  );

  it("refuses them without a session, as the web does", async () => {
    fake.current!.user = null;
    expect((await fetch("/api/scout/activity")).status).toBe(401);
  });

  it("POST /api/team-state/emergency-stop sets should_run=false, and only with the STOP confirmation", async () => {
    fake.current!.rows.team_state = [{ should_run: false }];
    expect((await post("/api/team-state/emergency-stop", { confirm: "yes" })).status).toBe(400);
    expect(ops("team_state").some((o) => o.name === "upsert")).toBe(false);

    const res = await post("/api/team-state/emergency-stop", { confirm: "STOP" });
    expect(res.status).toBe(200);
    const upsert = ops("team_state").find((o) => o.name === "upsert");
    expect(upsert?.args[0]).toMatchObject({ user_id: "user-1", should_run: false });
  });

  it("POST /api/team/send stays refused, as on the cloud: nothing reaches an agent's terminal", async () => {
    const res = await post("/api/team/send", { session: "SCOUT-1", message: "vai" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "read_only" });
  });

  it("GET /api/team/status infers each agent from the team's command history, as on the cloud", async () => {
    fake.current!.rows.team_commands = [{ action: "start", payload: { target: "scout" }, processed_at: "2026-09-27T08:00:00Z" }];
    const res = await fetch("/api/team/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { remote: boolean; agents: Array<{ session: string; active: boolean }> };
    expect(body.remote).toBe(true);
    expect(tables()).toEqual(["team_commands"]);
    expect(body.agents.filter((a) => a.active).map((a) => a.session.toLowerCase())).toEqual(["scout"]);
  });
});
