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

const NOW = Date.now();
const PAST = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
const DEVICE = "00000000-0000-4000-8000-000000000099";

// The tokens of the account, ALL of them (the revoked and the expired too): the route reads them without a filter.
function cloud(rows: unknown[], deviceRows: unknown[] = [
  { pairing_session_id: DEVICE, revoked_at: null, expires_at: null },
]) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const order = vi.fn(() => ({ limit }));
  const gte = vi.fn(() => ({ order }));
  const statuses = vi.fn(() => ({ gte }));
  const actions = vi.fn(() => ({ in: statuses }));
  const user = vi.fn(() => ({ in: actions }));
  const select = vi.fn(() => ({ eq: user }));
  const range = vi.fn(async () => ({ data: deviceRows, error: null }));
  const deviceOrder = vi.fn(() => ({ range }));
  const deviceUser = vi.fn(() => ({ order: deviceOrder }));
  const deviceSelect = vi.fn(() => ({ eq: deviceUser }));
  return {
    admin: { from: vi.fn((table: string) => table === "cloud_sync_tokens" ? { select: deviceSelect } : { select }) },
    user,
    actions,
    statuses,
    deviceSelect,
    deviceUser,
    deviceOrder,
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
        params: { legacy_id: 42, host: "example.com" },
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
        params: { legacy_id: 45, host: "example.com" },
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
    // every token of the account, none filtered out: a revoked or an expired one is still a device's session
    expect(fake.deviceSelect).toHaveBeenCalledWith("pairing_session_id, revoked_at, expires_at");
    expect(fake.deviceOrder).toHaveBeenCalledWith("id");
    expect(fake.actions).toHaveBeenCalledWith("action", ["position.apply_authorize", "position.apply_revoke"]);
    expect(fake.statuses).toHaveBeenCalledWith("status", ["queued", "done"]);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      account_id: "11111111-1111-4111-8111-111111111111",
      authorizations: [
        { legacy_id: 42, action: "position.apply_revoke", status: "queued" },
        { legacy_id: 45, action: "position.apply_authorize", status: "done" },
      ],
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
      params: { legacy_id: index + 1, host: "example.com" },
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

  it("fails closed until a legacy device token is paired again", async () => {
    const fake = cloud([
      {
        id: "00000000-0000-4000-8000-000000000001",
        action: "position.apply_authorize",
        status: "done",
        created_at: "2026-10-23T18:00:00.000Z",
        summary: "Synthetic role @ Synthetic company · example.com",
        params: { legacy_id: 42, host: "example.com" },
        session_id: null,
      },
    ], [{ pairing_session_id: null, revoked_at: null, expires_at: null }]);
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "11111111-1111-4111-8111-111111111111", tokenId: "legacy-device", admin: fake.admin },
    });
    const { GET } = await import("@/app/api/cloud-sync/apply-authorizations/route");

    const response = await GET(new Request("http://localhost/api/cloud-sync/apply-authorizations") as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "re_pair_required" });
    expect(fake.user).not.toHaveBeenCalled();
  });

  const row = (n: number, session_id: string | null) => ({
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    action: "position.apply_authorize",
    status: "done",
    created_at: `2026-10-27T18:${String(n).padStart(2, "0")}:00.000Z`,
    summary: "Synthetic role @ Synthetic company · example.com",
    params: { legacy_id: 200 + n, host: "example.com" },
    session_id,
  });
  const run = async (fake: ReturnType<typeof cloud>) => {
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "11111111-1111-4111-8111-111111111111", tokenId: "device", admin: fake.admin },
    });
    const { GET } = await import("@/app/api/cloud-sync/apply-authorizations/route");
    return GET(new Request("http://localhost/api/cloud-sync/apply-authorizations") as never);
  };
  const legacyIds = async (response: Response) =>
    ((await response.json()) as { authorizations: Array<{ legacy_id: number }> }).authorizations.map((a) => a.legacy_id);

  it.each([
    ["revoked", { revoked_at: PAST, expires_at: null }],
    ["expired", { revoked_at: null, expires_at: PAST }],
    ["revoked and expired", { revoked_at: PAST, expires_at: PAST }],
  ])("a receipt made from the session of a %s device token is not handed over, and one from a browser is", async (_n, ended) => {
    const fake = cloud(
      [row(1, DEVICE), row(2, "00000000-0000-4000-8000-0000000000aa")],
      [{ pairing_session_id: DEVICE, ...ended }, { pairing_session_id: "00000000-0000-4000-8000-0000000000bb", revoked_at: null, expires_at: FUTURE }],
    );
    const response = await run(fake);
    expect(response.status).toBe(200);
    expect(await legacyIds(response)).toEqual([202]);
  });

  it("after a new pairing the revoked session of the old one is still not handed over", async () => {
    const fake = cloud(
      [row(1, DEVICE), row(2, "00000000-0000-4000-8000-0000000000cc"), row(3, "00000000-0000-4000-8000-0000000000dd")],
      [
        { pairing_session_id: DEVICE, revoked_at: PAST, expires_at: null },                                          // the old pairing, ended by the box
        { pairing_session_id: "00000000-0000-4000-8000-0000000000cc", revoked_at: null, expires_at: FUTURE },      // the new one
      ],
    );
    const response = await run(fake);
    expect(response.status).toBe(200);
    expect(await legacyIds(response)).toEqual([203]);
  });

  it.each([
    ["revoked", { revoked_at: PAST, expires_at: null }],
    ["expired", { revoked_at: null, expires_at: PAST }],
  ])("a legacy token without a session that is %s does not ask for a new pairing", async (_n, ended) => {
    const fake = cloud([row(1, null)], [{ pairing_session_id: null, ...ended }, { pairing_session_id: DEVICE, revoked_at: null, expires_at: null }]);
    const response = await run(fake);
    expect(response.status).toBe(200);
    expect(await legacyIds(response)).toEqual([201]);
  });

  it("an ACTIVE legacy token without a session still asks for a new pairing, whatever the other tokens are", async () => {
    const fake = cloud([row(1, null)], [
      { pairing_session_id: DEVICE, revoked_at: PAST, expires_at: null },
      { pairing_session_id: null, revoked_at: null, expires_at: FUTURE },
    ]);
    const response = await run(fake);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "re_pair_required" });
    expect(fake.user).not.toHaveBeenCalled();
  });

  it("a failure to read the tokens is a 500 and nothing is handed over", async () => {
    const accountRead = vi.fn();
    const admin = {
      from: (table: string) =>
        table === "cloud_sync_tokens"
          ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }
          : { select: accountRead },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await run({ admin } as unknown as ReturnType<typeof cloud>);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("query_failed");
    expect(accountRead).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
