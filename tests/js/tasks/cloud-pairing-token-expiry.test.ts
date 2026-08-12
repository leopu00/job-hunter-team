import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })),
      })),
      update: mocks.update,
    })),
  }),
}));

function request(token: string) {
  return {
    headers: new Headers({ authorization: `Bearer ${token}` }),
  } as never;
}

describe("pairing bearer TTL senza cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifyBearerToken rifiuta un bearer mai riscattato oltre TTL", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "synthetic-token-id",
        user_id: "synthetic-user-id",
        name: "pairing-test",
        revoked_at: null,
        last_used_at: null,
        expires_at: "2000-01-01T00:00:00.000Z",
        client_version: null,
        client_platform: null,
        client_capabilities: null,
      },
      error: null,
    });
    const { verifyBearerToken } = await import("@/lib/cloud-sync/auth");

    const result = await verifyBearerToken(
      request("jht_sync_synthetic_expired"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expired token unexpectedly authenticated");
    expect(result.res.status).toBe(401);
    await expect(result.res.json()).resolves.toEqual({
      error: "token scaduto",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
