import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: vi.fn(() => {
      throw new Error("device-poll must not pre-read pairing tables");
    }),
  }),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: mocks.checkRateLimit,
}));

const DEVICE_CODE = "b".repeat(32);

function request() {
  return {
    json: vi.fn().mockResolvedValue({ device_code: DEVICE_CODE }),
  } as never;
}

function rpcResult(data: Record<string, unknown> | null, error = null) {
  return {
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

describe("device-poll one-shot boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  });

  it("consegna solo il token attestato dalla RPC atomica", async () => {
    mocks.rpc.mockReturnValue(
      rpcResult({
        status: "approved",
        approved_token: "jht_sync_synthetic_winner",
        user_id: "synthetic-user",
        approved_token_id: "synthetic-token",
        token_name: "test-device",
      }),
    );
    const { POST } = await import("@/app/api/cloud-sync/device-poll/route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "approved",
      token: "jht_sync_synthetic_winner",
      user_id: "synthetic-user",
      token_name: "test-device",
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("redeem_cloud_sync_pairing", {
      p_device_code: DEVICE_CODE,
    });
  });

  it.each(["consumed", "expired"])(
    "il perdente %s non riceve plaintext",
    async (status) => {
      mocks.rpc.mockReturnValue(
        rpcResult({
          status,
          approved_token: null,
          user_id: "synthetic-user",
          approved_token_id: "synthetic-token",
          token_name: null,
        }),
      );
      const { POST } = await import("@/app/api/cloud-sync/device-poll/route");

      const response = await POST(request());

      expect(response.status).toBe(410);
      const body = await response.json();
      expect(body).toEqual({ status });
      expect(body).not.toHaveProperty("token");
    },
  );

  it("fallisce chiuso se una riga approved non porta il token", async () => {
    mocks.rpc.mockReturnValue(
      rpcResult({
        status: "approved",
        approved_token: null,
        user_id: "synthetic-user",
        approved_token_id: "synthetic-token",
        token_name: null,
      }),
    );
    const { POST } = await import("@/app/api/cloud-sync/device-poll/route");

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ status: "invalid" });
  });
});

describe("pairing TTL wiring", () => {
  const root = path.resolve(__dirname, "../../..");
  const confirm = fs.readFileSync(
    path.join(root, "web/app/api/cloud-sync/device-confirm/route.ts"),
    "utf8",
  );
  const poll = fs.readFileSync(
    path.join(root, "web/app/api/cloud-sync/device-poll/route.ts"),
    "utf8",
  );

  it("il bearer nasce con la TTL della sessione e approval esclude expiry", () => {
    expect(confirm).toContain("expires_at: session.expires_at");
    expect(confirm).toContain('.gt("expires_at", new Date().toISOString())');
  });

  it("device-poll non legge più il token prima della CAS", () => {
    expect(poll).toContain('.rpc("redeem_cloud_sync_pairing"');
    expect(poll).not.toContain('.from("cloud_sync_pairing_sessions")');
    expect(poll).not.toContain("tokenToReturn");
  });
});
