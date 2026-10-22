/**
 * The observed fields of team_state (heartbeat, is_running, last_error, the
 * agents' statuses) are written by the box ONLY through PATCH /api/team-state
 * with the device token. The database gives the browser roles no grant on them,
 * so a write with the user's session (the refresh_token of cloud.json) would be
 * refused, or worse, silently turn the tags off.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPABASE = "https://project.supabase.example";
const BASE = "https://cloud.example.test";

let home: string;
const saved: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined) {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jht-observed-route-"));
  setEnv("JHT_HOME", home);
  setEnv("JHT_SUPABASE_DIRECT", "1");
  setEnv("JHT_AGENTS_STATUS", "0");
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: BASE,
      token: "jht_sync_synthetic-test-token",
      supabase_url: SUPABASE,
      supabase_refresh_token: "synthetic-refresh-token",
      user_id: "user-test",
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

function fetchSpy() {
  const calls: Array<{ url: string; method: string; auth: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        auth: init?.headers?.Authorization ?? init?.headers?.authorization ?? "",
        body: init?.body ? JSON.parse(init.body) : null,
      });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

describe("gli osservati di team_state vanno dalla rotta col token", () => {
  it("il battito, anche con una sessione diretta configurata, e' un PATCH /api/team-state col token", async () => {
    const calls = fetchSpy();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { reconcileOnce } = await import("../../../cli/src/lib/team-state-reconciler.js");
    const result = await reconcileOnce({ observeTeam: async () => true });
    expect(result).toMatchObject({ ok: true, beat: true });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PATCH ${BASE}/api/team-state`]);
    expect(calls[0]!.auth).toBe("Bearer jht_sync_synthetic-test-token");
    expect(calls[0]!.body).toMatchObject({ is_running: true });
    expect(Object.keys(calls[0]!.body as object)).toContain("last_heartbeat_at");
    expect(calls.some((c) => c.url.startsWith(SUPABASE))).toBe(false);
  });

  it("last_error e il suo ritiro vanno dalla rotta col token, mai dalla sessione", async () => {
    const calls = fetchSpy();
    vi.resetModules();
    const { patchTeamStateBestEffort } = await import("../../../cli/src/commands/cloud.js");
    const config = { base_url: BASE, token: "jht_sync_synthetic-test-token" };
    expect(await patchTeamStateBestEffort(config, { last_error: "chat lane stalled" })).toBe(true);
    expect(await patchTeamStateBestEffort(config, { last_error: null })).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PATCH ${BASE}/api/team-state`, `PATCH ${BASE}/api/team-state`]);
    expect(calls.map((c) => c.body)).toEqual([{ last_error: "chat lane stalled" }, { last_error: null }]);
  });

  it("il client diretto non sa piu' scrivere team_state", async () => {
    vi.resetModules();
    const { createSupabaseDirect } = await import("../../../cli/src/lib/supabase-direct.js");
    const client = createSupabaseDirect({ supabaseUrl: SUPABASE, anonKey: "anon", refreshToken: "r", userId: "u" });
    expect("patchTeamState" in client).toBe(false);
    // reads and the single column grant stay
    expect(typeof client.readTeamState).toBe("function");
    expect(typeof client.markUserChatDelivered).toBe("function");
  });
});
