import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  resolveUser: vi.fn(),
  checkCloudSyncRateLimit: vi.fn(),
  sanitizedError: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: mocks.verifyBearerToken,
}));
vi.mock("@/lib/team-state/auth", () => ({ resolveUser: mocks.resolveUser }));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: mocks.checkCloudSyncRateLimit,
}));
vi.mock("@/lib/error-response", () => ({
  sanitizedError: mocks.sanitizedError,
}));

function request(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) } as never;
}

function teamStateDb(result: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: result, error: null });
  const query = {
    eq: vi.fn(),
    or: vi.fn(),
    select: vi.fn(),
    maybeSingle,
  };
  query.eq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.select.mockReturnValue(query);
  const update = vi.fn(() => query);
  const from = vi.fn(() => ({ update }));
  return { admin: { from }, from, update, query };
}

describe("POST /api/team-state/sync-observed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T14:00:00.000Z"));
    mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
  });

  afterEach(() => vi.useRealTimers());

  function authenticate(db: ReturnType<typeof teamStateDb>) {
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: {
        userId: "user-test",
        tokenId: "device-test",
        admin: db.admin,
      },
    });
  }

  it("applica completion e action nello stesso CAS con timestamp server", async () => {
    const expected = "2026-08-04T14:00:05.000Z";
    const observedAt = "2026-08-04T14:00:05.001Z";
    const db = teamStateDb({
      sync_requested_at: expected,
      sync_completed_at: observedAt,
      last_action: "sync:completed",
      last_action_at: observedAt,
    });
    authenticate(db);

    const { POST } = await import("@/app/api/team-state/sync-observed/route");
    const response = await POST(
      request({ expected_requested_at: expected, status: "completed" }),
    );

    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith({
      last_action: "sync:completed",
      last_action_at: observedAt,
      sync_completed_at: observedAt,
    });
    expect(db.query.eq).toHaveBeenCalledWith("sync_requested_at", expected);
    expect(db.query.or).toHaveBeenCalledWith(
      `sync_completed_at.is.null,sync_completed_at.lt.${expected}`,
    );
    expect(db.query.or).toHaveBeenCalledWith(
      `last_action.not.like.sync:%,last_action_at.lte.${expected},last_action_at.is.null`,
    );
    await expect(response.json()).resolves.toMatchObject({
      applied: true,
      status: "completed",
      sync_completed_at: observedAt,
      last_action_at: observedAt,
    });
  });

  it("un failure non tocca sync_completed_at", async () => {
    const expected = "2026-08-04T13:59:59.000Z";
    const observedAt = "2026-08-04T14:00:00.000Z";
    const db = teamStateDb({
      sync_requested_at: expected,
      sync_completed_at: null,
      last_action: "sync:push_failed",
      last_action_at: observedAt,
    });
    authenticate(db);

    const { POST } = await import("@/app/api/team-state/sync-observed/route");
    const response = await POST(
      request({ expected_requested_at: expected, status: "push_failed" }),
    );

    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith({
      last_action: "sync:push_failed",
      last_action_at: observedAt,
    });
  });

  it("restituisce 409 se B ha sostituito A o A e' gia terminale", async () => {
    const expected = "2026-08-04T14:00:00.000Z";
    const db = teamStateDb(null);
    authenticate(db);

    const { POST } = await import("@/app/api/team-state/sync-observed/route");
    const response = await POST(
      request({ expected_requested_at: expected, status: "completed" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      applied: false,
      status: "completed",
      reason: "superseded",
    });
  });

  it("rifiuta status o correlazione malformati senza scrivere", async () => {
    const db = teamStateDb(null);
    authenticate(db);
    const { POST } = await import("@/app/api/team-state/sync-observed/route");

    const response = await POST(
      request({ expected_requested_at: "non-data", status: "completed" }),
    );

    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("il PATCH observed legacy non puo bypassare il CAS", async () => {
    const from = vi.fn();
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: {
        source: "token",
        userId: "user-test",
        token: { tokenId: "device-test" },
        supabase: { from },
      },
    });
    const { PATCH } = await import("@/app/api/team-state/route");

    const response = await PATCH(
      request({ sync_completed_at: "2026-08-04T14:00:01.000Z" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "sync_observed_endpoint_required",
    });
    expect(from).not.toHaveBeenCalled();
  });
});
