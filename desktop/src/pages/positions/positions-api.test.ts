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

const POSITION_ID = "00000000-0000-4000-8000-000000000042";

let restore: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  restore = installApiBridge(positionsApi(notInDesktop));
});
afterEach(() => restore());

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
