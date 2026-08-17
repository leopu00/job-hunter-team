import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcCall = { name: string; args: Record<string, unknown> };

let mode: "cloud" | "mirror" = "cloud";
let rpcError: string | null = null;
let rpcCalls: RpcCall[] = [];

const supabase = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (rpcError) return { data: null, error: { message: rpcError } };
    if (name === "mark_position_applied") {
      return {
        data: {
          id: String(args.p_position_legacy_id),
          status: "applied",
          applied_at: args.p_applied_at,
          applied_via: args.p_applied_via,
        },
        error: null,
      };
    }
    return {
      data: {
        id: String(args.p_position_legacy_id),
        status: "ready",
        applied_at: null,
        applied_via: null,
      },
      error: null,
    };
  }),
};

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/positions/local-first-write", () => ({
  localFirstWrite: vi.fn(async (req: Request, opts: any) => {
    if (mode === "mirror") {
      const outcome =
        req.method === "DELETE"
          ? {
              id: "73",
              status: "ready",
              applied_at: null,
              applied_via: null,
            }
          : {
              id: "73",
              status: "applied",
              applied_at: "2026-08-12T16:30:00.000Z",
              applied_via: "user_manual",
            };
      try {
        await opts.mirror(supabase, "synthetic-user", outcome);
        return Response.json({
          ...outcome,
          source: "local",
          cloud_synced: true,
        });
      } catch {
        return Response.json({
          ...outcome,
          source: "local",
          cloud_synced: false,
        });
      }
    }
    const step = await opts.cloud(supabase, "synthetic-user");
    if (!step.ok) return Response.json(step.body, { status: step.status });
    return Response.json({ ...step.outcome, source: "cloud" });
  }),
}));

const { POST, DELETE } =
  await import("@/app/api/positions/[legacyId]/mark-applied/route");

function call(method: "POST" | "DELETE") {
  const request = new Request("http://localhost/positions/73/mark-applied", {
    method,
    body: method === "POST" ? JSON.stringify({ note: "nota sintetica" }) : null,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
  });
  const context = { params: Promise.resolve({ legacyId: "73" }) };
  return method === "POST"
    ? POST(request as any, context)
    : DELETE(request as any, context);
}

beforeEach(() => {
  mode = "cloud";
  rpcError = null;
  rpcCalls = [];
});

describe("invariante candidatura sul cloud", () => {
  it("il POST cloud usa l'RPC atomica e restituisce la data persistita", async () => {
    const response = await call("POST");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "applied",
      applied_via: "user_manual",
      source: "cloud",
    });
    expect(body.applied_at).toBe(rpcCalls[0].args.p_applied_at);
    expect(rpcCalls).toEqual([
      {
        name: "mark_position_applied",
        args: {
          p_position_legacy_id: 73,
          p_applied_at: expect.any(String),
          p_applied_via: "user_manual",
          p_note: "nota sintetica",
        },
      },
    ]);
  });

  it("il mirror riusa la stessa RPC con il timestamp già scritto in SQLite", async () => {
    mode = "mirror";
    const response = await call("POST");
    await expect(response.json()).resolves.toMatchObject({
      cloud_synced: true,
    });
    expect(rpcCalls[0]).toEqual({
      name: "mark_position_applied",
      args: {
        p_position_legacy_id: 73,
        p_applied_at: "2026-08-12T16:30:00.000Z",
        p_applied_via: "user_manual",
        p_note: "nota sintetica",
      },
    });
  });

  it("l'undo cloud annulla posizione e application nella stessa RPC", async () => {
    const response = await call("DELETE");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      applied_at: null,
      applied_via: null,
    });
    expect(rpcCalls).toEqual([
      {
        name: "undo_manual_position_application",
        args: { p_position_legacy_id: 73, p_restored_status: null },
      },
    ]);
  });

  it("l'undo mirror non degrada a un update della sola posizione", async () => {
    mode = "mirror";
    const response = await call("DELETE");
    await expect(response.json()).resolves.toMatchObject({
      cloud_synced: true,
    });
    expect(rpcCalls[0]).toEqual({
      name: "undo_manual_position_application",
      args: { p_position_legacy_id: 73, p_restored_status: "ready" },
    });
  });

  it("rifiuta senza falso successo se l'RPC non applica la modifica", async () => {
    rpcError = "not_applied";
    const response = await call("DELETE");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "not_applied" });
  });
});

describe("migrazione cloud atomica", () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      "../../../supabase/migrations/072_application_state_invariant.sql",
    ),
    "utf8",
  );

  it("usa privilegi della sessione e non fa backfill", () => {
    expect(
      migration.match(/LANGUAGE plpgsql\s+SECURITY INVOKER/gi),
    ).toHaveLength(4);
    expect(migration).toMatch(/actor UUID := \(SELECT auth\.uid\(\)\)/i);
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).not.toMatch(/DO\s+\$\$/i);
  });

  it("scrive application, position e undo dentro le funzioni", () => {
    expect(migration).toMatch(/INSERT INTO public\.applications/i);
    expect(migration).toMatch(
      /UPDATE public\.positions[\s\S]*SET status = 'applied'/i,
    );
    expect(migration).toMatch(
      /UPDATE public\.applications[\s\S]*applied_at = NULL[\s\S]*applied_via = NULL/i,
    );
    expect(migration).toMatch(/undo_manual_position_application/i);
    expect(migration).toMatch(/sync_confirm_positions_applied/i);
    expect(migration).toMatch(/sync_upsert_applications/i);
    expect(migration).toMatch(/stale_application_downgrade/i);
    expect(migration).toMatch(
      /incoming_status IS NULL\s+OR incoming_status NOT IN \('applied', 'response'\)/i,
    );
    expect(migration).toMatch(
      /OLD\.status IN \('applied', 'response'\)[\s\S]*NEW\.status IS NULL/i,
    );
    expect(migration).toMatch(/incomplete_application/i);
    expect(migration).toMatch(
      /application_row\.status IS DISTINCT FROM 'applied'/i,
    );
  });
});

describe("confine cloud-sync applied", () => {
  const route = readFileSync(
    resolve(__dirname, "../../../web/app/api/cloud-sync/push/route.ts"),
    "utf8",
  );

  it("non pubblica lo status prima di aver scritto application", () => {
    const deferAt = route.indexOf("const deferredAppliedPayload");
    const applicationAt = route.indexOf("// 3. L'RPC");
    const confirmAt = route.indexOf(
      'admin.rpc("sync_confirm_positions_applied"',
    );
    expect(deferAt).toBeGreaterThan(-1);
    expect(route.slice(deferAt, applicationAt)).toContain(
      "const { status, ...deferred } = p",
    );
    expect(route.slice(deferAt, applicationAt)).toContain(
      "defaultToNull: false",
    );
    expect(confirmAt).toBeGreaterThan(applicationAt);
  });

  it("delega il lookup orphan alla RPC e fallisce chiuso senza receipt", () => {
    const applicationAt = route.indexOf("// 3. L'RPC");
    const confirmAt = route.indexOf(
      'admin.rpc("sync_confirm_positions_applied"',
    );
    const section = route.slice(applicationAt, confirmAt + 1000);
    expect(section).toContain("position_legacy_id");
    expect(section).toContain("applications_receipt_mismatch");
    expect(section).toContain("application_state_invariant_failed");
    expect(section).toContain("p_position_legacy_ids");
  });
});
