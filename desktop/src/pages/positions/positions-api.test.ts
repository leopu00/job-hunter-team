import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBridge, notInDesktop } from "../../shell/api-bridge";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { positionsApi } from "./positions-api";

// The web's position routes, run as they are behind the shell's bridge, on a
// fake desktop client: each test calls fetch("/api/...") the way the web
// component does and checks what reached Supabase. Synthetic data only.
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
}));

// In the webview `fs` is a stub that throws on first use. Five of these
// routes import it at the top for their local-SQLite branch: here it throws
// the same way, so a route that touched it on the desktop's path goes red.
const fsTouched = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("fs", () => {
  const stub = new Proxy(
    {},
    {
      get(_t, name) {
        if (typeof name === "symbol" || name === "then" || name === "__esModule") return undefined;
        fsTouched.names.push(String(name));
        throw new Error(`fs.${String(name)} is not available in the webview`);
      },
    },
  );
  return { default: stub };
});

const POSITION_ID = "00000000-0000-4000-8000-000000000042";

let restore: () => void;
beforeEach(() => {
  fsTouched.names.length = 0;
  fake.current = createPermissiveSupabase();
  restore = installApiBridge(positionsApi(notInDesktop));
});
afterEach(() => {
  restore();
  expect(fsTouched.names, "a route touched fs on the desktop's path").toEqual([]);
});

function post(path: string, body: unknown) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ops(table: string) {
  return fake.current!.calls.filter((c) => c.table === table).flatMap((c) => c.ops);
}

describe("the positions routes in the desktop", () => {
  it("GET /api/positions/facets answers the sidebar's dataset from the user's positions", async () => {
    fake.current!.rows.positions = [
      { id: POSITION_ID, legacy_id: 42, status: "scored", role_family: "Dati", scores: { total_score: 80 } },
    ];
    const res = await fetch("/api/positions/facets");
    expect(res.status).toBe(200);
    const facets = (await res.json()) as Array<{ id: string; role_family: string | null }>;
    expect(facets.map((f) => [f.id, f.role_family])).toEqual([[POSITION_ID, "Dati"]]);
  });

  it("POST /api/positions/seen records the view for the signed-in user", async () => {
    const res = await post("/api/positions/seen", { position_id: POSITION_ID });
    expect(res.status).toBe(200);
    expect(ops("position_views")).toContainEqual({
      name: "upsert",
      args: [
        { user_id: "user-1", position_id: POSITION_ID },
        { onConflict: "user_id,position_id", ignoreDuplicates: true },
      ],
    });
  });

  it("POST write-request asks for the CV on the user's own row, on the cloud branch", async () => {
    fake.current!.rows.positions = [
      {
        id: POSITION_ID,
        title: "Ruolo sintetico 42",
        company: "Azienda sintetica",
        status: "scored",
        write_requested: false,
        write_requested_at: null,
        write_request_kind: null,
        scores: [{ total_score: 80 }],
        applications: [],
      },
    ];
    const res = await post("/api/positions/42/write-request", {});
    const body = (await res.json()) as { source?: string; error?: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.source).toBe("cloud");
    const written = ops("positions");
    expect(written).toContainEqual({ name: "eq", args: ["user_id", "user-1"] });
    expect(written).toContainEqual({ name: "eq", args: ["legacy_id", 42] });
    expect(written.some((o) => o.name === "update")).toBe(true);
  });

  it("POST ticket goes through the web's own RPC", async () => {
    fake.current!.rpcResults.create_position_ticket = {
      data: { id: "ticket-1", status: "open", position_status: "scored", deduplicated: false },
      error: null,
    };
    const res = await post("/api/positions/42/ticket", { request_text: "Una richiesta sintetica" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "ticket-1", source: "cloud", cloud_synced: true });
    expect(fake.current!.rpc).toEqual([
      {
        name: "create_position_ticket",
        args: { p_position_legacy_id: 42, p_request_text: "Una richiesta sintetica", p_kind: "custom" },
      },
    ]);
  });

  it.each(["geocode-request", "recheck-request", "write-request", "ticket"])(
    "POST %s answers from the cloud branch without touching fs",
    async (route) => {
      fake.current!.rows.positions = [
        { id: POSITION_ID, legacy_id: 42, status: "scored", write_requested: false, scores: [{ total_score: 80 }] },
      ];
      fake.current!.rpcResults.create_position_ticket = {
        data: { id: "ticket-1", status: "open", position_status: "scored", deduplicated: false },
        error: null,
      };
      const res = await post(`/api/positions/42/${route}`, { request_text: "Una richiesta sintetica" });
      // Whatever the route decides about these synthetic rows, it answered as
      // the web does: JSON, and from Supabase (the only place it could read).
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(fake.current!.calls.length + fake.current!.rpc.length).toBeGreaterThan(0);
    },
  );

  describe("apply-request goes through the single door, not through the tables", () => {
    const CONFIRM_ID = "22222222-2222-4222-8222-222222222222";
    const doorAnswer = (state: "awaiting_confirm" | "queued", level: "L1" | "L3" = "L3") => ({
      data: {
        ok: true,
        state,
        id: CONFIRM_ID,
        level,
        summary: "Ruolo sintetico 42 @ Azienda sintetica",
        expires_at: state === "awaiting_confirm" ? "2026-10-22T12:02:00Z" : null,
      },
      error: null,
    });

    it("the first call (Origin of the page, empty body) asks the database for the confirmation and writes no table", async () => {
      fake.current!.rpcResults.request_action = doorAnswer("awaiting_confirm");
      const res = await post("/api/positions/42/apply-request", {});
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ ok: true, state: "awaiting_confirm", summary: "Ruolo sintetico 42 @ Azienda sintetica" });
      expect(fake.current!.rpc).toEqual([
        {
          name: "request_action",
          args: { p_action: "position.apply_authorize", p_params: { legacy_id: 42 }, p_confirm_id: null, p_route_level: "L3" },
        },
      ]);
      expect(fake.current!.calls, "no table is read or written by the route").toEqual([]);
    });

    it("the second call carries the confirmation id alone", async () => {
      fake.current!.rpcResults.request_action = doorAnswer("queued");
      const res = await post("/api/positions/42/apply-request", { confirmId: CONFIRM_ID });
      expect(res.status).toBe(200);
      expect(fake.current!.rpc).toEqual([
        { name: "request_action", args: { p_action: "position.apply_authorize", p_params: {}, p_confirm_id: CONFIRM_ID, p_route_level: "L3" } },
      ]);
    });

    it("withdrawing is a DELETE that takes the revoke action at the lower level", async () => {
      fake.current!.rpcResults.request_action = doorAnswer("queued", "L1");
      const res = await fetch("/api/positions/42/apply-request", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
      expect(fake.current!.rpc).toEqual([
        { name: "request_action", args: { p_action: "position.apply_revoke", p_params: { legacy_id: 42 }, p_confirm_id: null, p_route_level: "L1" } },
      ]);
    });

    it("the old one-word body of the desktop's other road is refused by the door, and nothing reaches the database", async () => {
      const res = await post("/api/positions/42/apply-request", { confirmed: true });
      expect(res.status).toBe(400);
      expect(fake.current!.rpc).toEqual([]);
    });

    it("without the page's Origin the door refuses: a request the bridge did not make is not let in", async () => {
      const { POST } = await import("@/app/api/positions/[legacyId]/apply-request/route");
      const { NextRequest } = await import("next/server");
      const foreign = new NextRequest("https://elsewhere.example/api/positions/42/apply-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const res = await POST(foreign, { params: Promise.resolve({ legacyId: "42" }) });
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ ok: false, error: "origin_required" });
      expect(fake.current!.rpc).toEqual([]);
    });

    it("a signed-out caller gets 401 from the door and no database call", async () => {
      fake.current!.user = null;
      const res = await post("/api/positions/42/apply-request", {});
      expect(res.status).toBe(401);
      expect(fake.current!.rpc).toEqual([]);
    });
  });

  it("the bridge's requests carry the page's own origin, host and same-origin: a script cannot set them in a webview", async () => {
    const { NextRequest } = await import("next/server");
    const own = new NextRequest(new URL("/api/positions/42/apply-request", window.location.href), { method: "POST" });
    expect(own.headers.get("origin")).toBe(window.location.origin);
    expect(own.headers.get("host")).toBe(window.location.host);
    expect(own.headers.get("sec-fetch-site")).toBe("same-origin");
    const foreign = new NextRequest("https://elsewhere.example/x", { method: "POST" });
    expect(foreign.headers.get("origin")).toBeNull();
    expect(foreign.headers.get("sec-fetch-site")).toBeNull();
  });

  it("a signed-out caller gets the web's 401 and nothing is written", async () => {
    fake.current!.user = null;
    const res = await post("/api/positions/42/write-request", {});
    expect(res.status).toBe(401);
    expect(ops("positions").some((o) => o.name === "update")).toBe(false);
  });

  it("the CV download is not in the desktop: its route answers not_in_desktop", async () => {
    const res = await post("/api/profile/files/request", { name: "cv-42.pdf" });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_in_desktop" });
    expect(fake.current!.calls).toEqual([]);
  });
});
