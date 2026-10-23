import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  checkCloudSyncRateLimit: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: mocks.verifyBearerToken,
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: mocks.checkCloudSyncRateLimit,
}));

function cloud(rows: unknown[]) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const order = vi.fn(() => ({ limit }));
  const gte = vi.fn(() => ({ order }));
  const statuses = vi.fn(() => ({ gte }));
  const actions = vi.fn(() => ({ in: statuses }));
  const user = vi.fn(() => ({ in: actions }));
  const select = vi.fn(() => ({ eq: user }));
  const deviceNot = vi.fn(async () => ({ data: [
    { pairing_session_id: "00000000-0000-4000-8000-000000000099" },
  ], error: null }));
  const deviceUser = vi.fn(() => ({ not: deviceNot }));
  const deviceSelect = vi.fn(() => ({ eq: deviceUser }));
  return {
    admin: { from: vi.fn((table: string) => table === "cloud_sync_tokens" ? { select: deviceSelect } : { select }) },
    user,
    actions,
    statuses,
    deviceUser,
  };
}

describe("apply authorizations cloud route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
  });

  it("filters with the account of the sync token and returns only closed valid rows", async () => {
    const fake = cloud([
      {
        id: "00000000-0000-4000-8000-000000000001",
        action: "position.apply_authorize",
        status: "done",
        created_at: "2026-10-23T18:00:00.000Z",
        summary: "Synthetic role @ Synthetic company · example.com",
        params: { legacy_id: 42 },
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        action: "position.apply_authorize",
        status: "awaiting_confirm",
        created_at: "2026-10-23T18:01:00.000Z",
        summary: "must not leave the door",
        params: { legacy_id: 43 },
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        action: "position.apply_authorize",
        status: "done",
        created_at: "2026-10-23T18:02:00.000Z",
        summary: "Another role @ Another company · example.com",
        params: { legacy_id: 45 },
        session_id: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        action: "position.apply_revoke",
        status: "queued",
        created_at: "2026-10-23T18:03:00.000Z",
        summary: "Synthetic role @ Synthetic company",
        params: { legacy_id: 42 },
        session_id: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        action: "position.apply_authorize",
        status: "done",
        created_at: "2026-10-23T18:02:00.000Z",
        summary: "must stay with the device",
        params: { legacy_id: 44 },
        session_id: "00000000-0000-4000-8000-000000000099",
      },
    ]);
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "11111111-1111-4111-8111-111111111111", tokenId: "device", admin: fake.admin },
    });
    const { GET } = await import("@/app/api/cloud-sync/apply-authorizations/route");

    const response = await GET(new Request("http://localhost/api/cloud-sync/apply-authorizations?since=2026-10-23T17:00:00.000Z") as never);

    expect(fake.user).toHaveBeenCalledWith("user_id", "11111111-1111-4111-8111-111111111111");
    expect(fake.deviceUser).toHaveBeenCalledWith("user_id", "11111111-1111-4111-8111-111111111111");
    expect(fake.actions).toHaveBeenCalledWith("action", ["position.apply_authorize", "position.apply_revoke"]);
    expect(fake.statuses).toHaveBeenCalledWith("status", ["queued", "done"]);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      account_id: "11111111-1111-4111-8111-111111111111",
      authorizations: [{ legacy_id: 42, action: "position.apply_revoke", status: "queued" }],
      cursor: "2026-10-23T18:03:00.000Z",
      has_more: false,
    });
  });

  it("marks an exactly full page so the broker fetches its next cursor immediately", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      action: "position.apply_authorize",
      status: "done",
      created_at: `2026-10-23T18:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      summary: "Synthetic role @ Synthetic company · example.com",
      params: { legacy_id: index + 1 },
      session_id: null,
    }));
    const fake = cloud(rows);
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "11111111-1111-4111-8111-111111111111", tokenId: "device", admin: fake.admin },
    });
    const { GET } = await import("@/app/api/cloud-sync/apply-authorizations/route");

    const response = await GET(new Request("http://localhost/api/cloud-sync/apply-authorizations") as never);

    await expect(response.json()).resolves.toMatchObject({ has_more: true });
  });
});
