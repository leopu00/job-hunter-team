import { createHash } from "node:crypto";
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
let applicationReceipts: unknown[] | null = null;
let selectedPositions: { id: string; legacy_id: number }[] = [];
let scorePersistedParents: string[] | null = null;
let scorePersistedLegacyOverride: number | null = null;

function fakeAdmin() {
  return {
    from(table: string) {
      let operation = "select";
      let writtenPayload: any = null;
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
          writtenPayload = payload;
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
              : operation === "upsert" && table === "scores"
                ? (scorePersistedParents ??
                  writtenPayload.map((row: any) => row.position_id)).map(
                    (position_id: string) => ({
                      position_id,
                      legacy_id:
                        scorePersistedLegacyOverride ??
                        writtenPayload.find(
                          (row: any) => row.position_id === position_id,
                        )?.legacy_id,
                    }),
                  )
                : operation === "upsert" && table === "applications"
                  ? [{ id: "application-uuid-73" }]
                  : operation === "select" && table === "positions"
                    ? selectedPositions
                    : null;
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string, args: any) => {
      calls.push({ kind: "rpc", name, args });
      if (rpcError) return { data: null, error: { message: rpcError } };
      if (name === "sync_upsert_applications") {
        return {
          data:
            applicationReceipts ??
            args.p_applications.map(
              (application: any) => application._receipt_id,
            ),
          error: null,
        };
      }
      return { data: 1, error: null };
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

function receiptId(table: "applications" | "scores", legacyId: number) {
  return `q_${createHash("sha256")
    .update(`${table}\0${JSON.stringify([legacyId])}`)
    .digest("hex")
    .slice(0, 24)}`;
}

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
        applications: [
          { legacy_id: 193, position_legacy_id: 73, ...application },
        ],
      }),
    }) as any,
  );
}

beforeEach(() => {
  calls = [];
  rpcError = null;
  applicationReceipts = null;
  selectedPositions = [{ id: "position-uuid-73", legacy_id: 73 }];
  scorePersistedParents = null;
  scorePersistedLegacyOverride = null;
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
      (call) => call.kind === "rpc" && call.name === "sync_upsert_applications",
    );
    const confirmAt = calls.findIndex(
      (call) =>
        call.kind === "rpc" && call.name === "sync_confirm_positions_applied",
    );
    expect(applicationAt).toBeGreaterThan(-1);
    expect(calls[applicationAt].args.p_applications[0]).toMatchObject({
      legacy_id: 193,
      position_legacy_id: 73,
      _receipt_id: receiptId("applications", 193),
    });
    expect(calls[applicationAt].args.p_applications[0]).not.toHaveProperty(
      "position_id",
    );
    expect(confirmAt).toBeGreaterThan(applicationAt);
    expect(calls[confirmAt].args).toEqual({
      p_user_id: "00000000-0000-0000-0000-000000000073",
      p_position_legacy_ids: [73],
    });
    await expect(response.json()).resolves.toMatchObject({
      receipts: { applications: [receiptId("applications", 193)] },
    });
  });

  it("non risponde successo se la verifica atomica rifiuta l'application", async () => {
    rpcError = "incomplete_application";
    const response = await push({ status: "applied", applied: false });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "applications_upsert_failed" });
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
        (call) =>
          call.kind === "rpc" && call.name === "sync_upsert_applications",
      ),
    ).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      kind: "rpc",
      name: "sync_confirm_positions_applied",
    });
  });

  it("non conferma una application se la RPC non restituisce la sua identita'", async () => {
    applicationReceipts = ["q_999999999999999999999999"];
    const response = await push(
      {
        status: "draft",
      },
      false,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "applications_receipt_mismatch",
    });
  });

  it("verifica il multiset delle receipt senza dipendere dall'ordine", async () => {
    applicationReceipts = [
      receiptId("applications", 194),
      receiptId("applications", 193),
    ];
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [
            {
              legacy_id: 193,
              position_legacy_id: 73,
              _receipt_id: receiptId("applications", 193),
              status: "draft",
            },
            {
              legacy_id: 194,
              position_legacy_id: 74,
              _receipt_id: receiptId("applications", 194),
              status: "draft",
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    const applicationCall = calls.find(
      (call) => call.kind === "rpc" && call.name === "sync_upsert_applications",
    );
    expect(applicationCall?.args.p_applications).toHaveLength(2);
  });

  it("rifiuta una sostituzione nel multiset anche quando il count coincide", async () => {
    applicationReceipts = [
      receiptId("applications", 193),
      receiptId("applications", 193),
    ];
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [
            {
              legacy_id: 193,
              position_legacy_id: 73,
              _receipt_id: receiptId("applications", 193),
              status: "draft",
            },
            {
              legacy_id: 194,
              position_legacy_id: 74,
              _receipt_id: receiptId("applications", 194),
              status: "draft",
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "applications_receipt_mismatch",
    });
  });

  it("rifiuta identita' application incomplete prima della RPC", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [{ legacy_id: 193, status: "draft" }],
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(
      calls.some(
        (call) =>
          call.kind === "rpc" && call.name === "sync_upsert_applications",
      ),
    ).toBe(false);
  });

  it("rifiuta receipt application e score non derivate dalla source identity", async () => {
    const application = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [
            {
              legacy_id: 193,
              position_legacy_id: 73,
              _receipt_id: receiptId("applications", 999),
              status: "draft",
            },
          ],
        }),
      }) as any,
    );
    expect(application.status).toBe(400);

    const score = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: receiptId("scores", 999),
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );
    expect(score.status).toBe(400);
    expect(
      calls.some(
        (call) =>
          call.kind === "rpc" && call.name === "sync_upsert_applications",
      ),
    ).toBe(false);
    expect(
      calls.some((call) => call.kind === "upsert" && call.table === "scores"),
    ).toBe(false);
  });

  it("rifiuta uno score senza source identity prima del lookup o upsert", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scores: [{ position_id: 73, total_score: 81 }],
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_score_identity",
    });
    expect(calls).toEqual([]);
  });

  it("esporta la receipt score solo dopo l'upsert osservato", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: [
            {
              id: 73,
              title: "Synthetic",
              company: "Example",
              status: "scored",
            },
          ],
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: receiptId("scores", 88),
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scores: { upserted: 1 },
      receipts: { scores: [receiptId("scores", 88)] },
    });
  });

  it("risolve il parent di uno score orfano e fallisce chiuso se manca", async () => {
    const body = {
      scores: [
        {
          legacy_id: 88,
          position_id: 73,
          _receipt_id: receiptId("scores", 88),
          total_score: 81,
        },
      ],
    };
    const persisted = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as any,
    );
    expect(persisted.status).toBe(200);
    await expect(persisted.json()).resolves.toMatchObject({
      receipts: { scores: [receiptId("scores", 88)] },
    });

    calls = [];
    selectedPositions = [];
    admin = fakeAdmin();
    const missing = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as any,
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "scores_identity_unresolved",
    });
    expect(
      calls.some((call) => call.kind === "upsert" && call.table === "scores"),
    ).toBe(false);
  });

  it("non esporta ACK se l'upsert score non conferma ogni riga", async () => {
    scorePersistedParents = [];
    admin = fakeAdmin();
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: [
            { id: 73, title: "Synthetic", company: "Example", status: "scored" },
          ],
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: receiptId("scores", 88),
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "scores_receipt_mismatch",
    });
  });

  it("non esporta ACK se il legacy_id persistito non coincide", async () => {
    scorePersistedLegacyOverride = 999;
    admin = fakeAdmin();
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: [
            { id: 73, title: "Synthetic", company: "Example", status: "scored" },
          ],
          scores: [{ legacy_id: 88, position_id: 73, total_score: 81 }],
        }),
      }) as any,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "scores_receipt_mismatch",
    });
  });
});
