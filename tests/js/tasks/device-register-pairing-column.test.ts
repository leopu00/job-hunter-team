/**
 * device-register before migration 105 (the site goes out first): the pairing session has no column to go in.
 *
 * The device is paired all the same, and its token is born LEGACY (no session): the application authorisations
 * of the site stay closed for it until the person pairs it again. That is a fallback for ONE error only: the one
 * that names the column pairing_session_id (PostgREST PGRST204 or Postgres 42703). Any other failure is a 500 and
 * is not retried.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../../web/node_modules/next/server.js";

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

const world = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  answers: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({ configured: true, url: "https://project.supabase.test", anonKey: "anon" }),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "cloud_sync_tokens") {
        return {
          insert: (row: Record<string, unknown>) => {
            world.inserts.push(row);
            return {
              select: () => ({
                single: async () =>
                  world.answers.shift() ?? { data: null, error: { code: "XX000", message: "no answer scripted" } },
              }),
            };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { vps_setup_completed_at: "2026-10-01T00:00:00Z" } }) }) }),
        upsert: async () => ({ error: null }),
      };
    },
  }),
}));

const jwt = (payload: object) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

function stubSupabaseAuth() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ user: { id: USER }, access_token: jwt({ session_id: SESSION }) }), { status: 200 }),
    ),
  );
}

function request(client?: string) {
  return new NextRequest("https://site.example/api/cloud-sync/device-register", {
    method: "POST",
    headers: { "content-type": "application/json", ...(client ? { "x-jht-client": client } : {}) },
    body: JSON.stringify({ user_id: USER, refresh_token: "synthetic-refresh", device_name: "vps" }),
  });
}

const ROW = { data: { id: "t1", name: "vps", token_prefix: "jht_sync_ab", created_at: "2026-10-27T00:00:00Z" }, error: null };
const NAMES_SESSION = {
  PostgREST: { code: "PGRST204", message: "Could not find the 'pairing_session_id' column of 'cloud_sync_tokens' in the schema cache" },
  Postgres: { code: "42703", message: 'column "pairing_session_id" of relation "cloud_sync_tokens" does not exist' },
};
const CLIENT = "version=0.4.0; platform=linux; capabilities=chat";

async function post(client?: string) {
  const { POST } = await import("@/app/api/cloud-sync/device-register/route");
  return POST(request(client));
}

beforeEach(() => {
  world.inserts = [];
  world.answers = [];
  stubSupabaseAuth();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("device-register and the column of migration 105", () => {
  it("with the column: one insert, with the session of the pairing", async () => {
    world.answers = [ROW];
    const res = await post();
    expect(res.status).toBe(201);
    expect(world.inserts).toHaveLength(1);
    expect(world.inserts[0].pairing_session_id).toBe(SESSION);
  });

  it.each(Object.entries(NAMES_SESSION))(
    "%s says the column is missing: the device is paired again without a session (a legacy token) and answers 201",
    async (_who, error) => {
      world.answers = [{ data: null, error }, ROW];
      const res = await post();
      expect(res.status).toBe(201);
      expect(world.inserts).toHaveLength(2);
      expect(world.inserts[0].pairing_session_id).toBe(SESSION);
      expect("pairing_session_id" in world.inserts[1]).toBe(false);
      // the rest of the row is the same
      const { pairing_session_id: _s, ...first } = world.inserts[0];
      expect(world.inserts[1]).toEqual(first);
      await expect(res.json()).resolves.toMatchObject({ ok: true, user_id: USER });
    },
  );

  it.each([
    ["a connection error", { code: "08006", message: "connection failure" }],
    ["a permission error", { code: "42501", message: "permission denied for table cloud_sync_tokens" }],
    ["another column missing", { code: "PGRST204", message: "Could not find the 'name' column of 'cloud_sync_tokens' in the schema cache" }],
    ["the name in the message but another code", { code: "23505", message: "duplicate key value (pairing_session_id)" }],
    ["no code", { message: "pairing_session_id" }],
  ])("%s is not that error: one insert, no retry, a 500", async (_n, error) => {
    world.answers = [{ data: null, error }, ROW];
    const res = await post();
    expect(res.status).toBe(500);
    expect(world.inserts).toHaveLength(1);
    expect(world.inserts[0].pairing_session_id).toBe(SESSION);
  });

  it("an undefined column that is not the session's never drops the session (the old fallback for the client declaration is the only retry)", async () => {
    world.answers = [{ data: null, error: { code: "42703", message: 'column "token_prefix" does not exist' } }, ROW];
    await post();
    expect(world.inserts.length).toBeGreaterThan(0);
    for (const row of world.inserts) expect(row.pairing_session_id).toBe(SESSION);
  });

  it("a second failure after the retry is a 500 too (one retry for the session, not a loop)", async () => {
    world.answers = [{ data: null, error: NAMES_SESSION.Postgres }, { data: null, error: { code: "08006", message: "down" } }, ROW];
    const res = await post();
    expect(res.status).toBe(500);
    expect(world.inserts).toHaveLength(2);
  });

  it("both migrations missing (105 and 064): the declaration and the session are dropped one after the other and the device is paired", async () => {
    world.answers = [
      { data: null, error: NAMES_SESSION.PostgREST },
      { data: null, error: { code: "42703", message: 'column "client_version" of relation "cloud_sync_tokens" does not exist' } },
      ROW,
    ];
    const res = await post(CLIENT);
    expect(res.status).toBe(201);
    expect(world.inserts).toHaveLength(3);
    expect("client_version" in world.inserts[0]).toBe(true);
    expect("pairing_session_id" in world.inserts[1]).toBe(false);
    expect("client_version" in world.inserts[1]).toBe(true);
    expect("pairing_session_id" in world.inserts[2]).toBe(false);
    expect("client_version" in world.inserts[2]).toBe(false);
  });

  it("only 064 missing: the declaration is dropped and the session stays", async () => {
    world.answers = [{ data: null, error: { code: "42703", message: 'column "client_version" of relation "cloud_sync_tokens" does not exist' } }, ROW];
    const res = await post(CLIENT);
    expect(res.status).toBe(201);
    expect(world.inserts).toHaveLength(2);
    expect(world.inserts[1].pairing_session_id).toBe(SESSION);
    expect("client_version" in world.inserts[1]).toBe(false);
  });
});
