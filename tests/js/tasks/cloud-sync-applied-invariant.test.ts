import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
  kind: "upsert" | "rpc";
  table?: string;
  payload?: any;
  options?: any;
  name?: string;
  args?: any;
};

let calls: Call[] = [];
let rpcError: string | null = null;

function fakeAdmin() {
  return {
    from(table: string) {
      let operation = "select";
      const builder: Record<string, any> = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        in() {
          return builder;
        },
        update() {
          operation = "update";
          return builder;
        },
        upsert(payload: any, options: any) {
          operation = "upsert";
          calls.push({ kind: "upsert", table, payload, options });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(ok: (value: any) => unknown, ko?: (error: unknown) => unknown) {
          const data =
            operation === "upsert" && table === "positions"
              ? [{ id: "position-uuid-73", legacy_id: 73 }]
              : operation === "upsert" && table === "applications"
                ? [{ id: "application-uuid-73" }]
                : operation === "select" && table === "positions"
                  ? [{ id: "position-uuid-73", legacy_id: 73 }]
                  : null;
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string, args: any) => {
      calls.push({ kind: "rpc", name, args });
      return rpcError
        ? { data: null, error: { message: rpcError } }
        : { data: 1, error: null };
    }),
  };
}

let admin = fakeAdmin();

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: {
      userId: "00000000-0000-0000-0000-000000000073",
      tokenId: "synthetic-token-id",
      admin,
    },
  })),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSec: 0,
  })),
}));
vi.mock("@/lib/cloud-sync/onboarding-milestones", () => ({
  teamProducedWork: vi.fn(() => false),
  firstTeamRunPatch: vi.fn(() => null),
}));
vi.mock("@/lib/team-state/sync-freshness", () => ({
  syncRequestIsPending: vi.fn(() => false),
}));

const { POST } = await import("@/app/api/cloud-sync/push/route");

function push(application: Record<string, unknown>, includePosition = true) {
  return POST(
    new Request("http://localhost/api/cloud-sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        positions: includePosition
          ? [
              {
                id: 73,
                title: "Synthetic role",
                company: "Example",
                status: "applied",
              },
            ]
          : [],
        applications: [{ position_id: 73, ...application }],
      }),
    }) as any,
  );
}

beforeEach(() => {
  calls = [];
  rpcError = null;
  admin = fakeAdmin();
});

describe("push sync di una candidatura", () => {
  it("persiste application prima di pubblicare positions.status=applied", async () => {
    const response = await push({
      status: "applied",
      applied: true,
      applied_at: "2026-08-12T16:30:00.000Z",
      applied_via: "telegram",
    });
    expect(response.status).toBe(200);

    const position = calls.find(
      (call) => call.kind === "upsert" && call.table === "positions",
    );
    expect(position?.payload).toEqual([
      expect.not.objectContaining({ status: expect.anything() }),
    ]);
    expect(position?.options).toMatchObject({ defaultToNull: false });

    const applicationAt = calls.findIndex(
      (call) => call.kind === "upsert" && call.table === "applications",
    );
    const confirmAt = calls.findIndex(
      (call) =>
        call.kind === "rpc" && call.name === "sync_confirm_positions_applied",
    );
    expect(applicationAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(applicationAt);
    expect(calls[confirmAt].args).toEqual({
      p_user_id: "00000000-0000-0000-0000-000000000073",
      p_position_legacy_ids: [73],
    });
  });

  it("non risponde successo se la verifica atomica rifiuta l'application", async () => {
    rpcError = "incomplete_application";
    const response = await push({ status: "applied", applied: false });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "application_state_invariant_failed" });
    const position = calls.find(
      (call) => call.kind === "upsert" && call.table === "positions",
    );
    expect(position?.payload[0]).not.toHaveProperty("status");
  });

  it("non perde un'application delta quando la position non è nel batch", async () => {
    const response = await push(
      {
        status: "applied",
        applied: true,
        applied_at: "2026-08-12T16:30:00.000Z",
        applied_via: "telegram",
      },
      false,
    );
    expect(response.status).toBe(200);
    expect(
      calls.some(
        (call) => call.kind === "upsert" && call.table === "applications",
      ),
    ).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      kind: "rpc",
      name: "sync_confirm_positions_applied",
    });
  });
});
