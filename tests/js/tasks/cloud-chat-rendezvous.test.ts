import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  checkCloudSyncRateLimit: vi.fn(),
  sanitizedError: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: mocks.verifyBearerToken,
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: mocks.checkCloudSyncRateLimit,
}));
vi.mock("@/lib/error-response", () => ({
  sanitizedError: mocks.sanitizedError,
}));

function request(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) } as never;
}

function chatDb({ closed }: { closed: Record<string, unknown> | null }) {
  const deliveredSelect = vi.fn().mockResolvedValue({
    data: [{ id: "11111111-1111-4111-8111-111111111111" }],
    error: null,
  });
  const deliveredQuery = {
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    select: deliveredSelect,
  };
  deliveredQuery.eq.mockReturnValue(deliveredQuery);
  deliveredQuery.is.mockReturnValue(deliveredQuery);
  deliveredQuery.in.mockReturnValue(deliveredQuery);

  const maybeSingle = vi.fn().mockResolvedValue({ data: closed, error: null });
  const stateQuery = {
    eq: vi.fn(),
    or: vi.fn(),
    select: vi.fn(),
    maybeSingle,
  };
  stateQuery.eq.mockReturnValue(stateQuery);
  stateQuery.or.mockReturnValue(stateQuery);
  stateQuery.select.mockReturnValue(stateQuery);

  const messageUpdate = vi.fn(() => deliveredQuery);
  const stateUpdate = vi.fn(() => stateQuery);
  const from = vi.fn((table: string) => ({
    update: table === "pending_user_messages" ? messageUpdate : stateUpdate,
  }));
  return {
    admin: { from },
    from,
    messageUpdate,
    stateUpdate,
    stateQuery,
  };
}

describe("POST /api/cloud-sync/chat — ACK correlato", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
  });

  function authenticate(db: ReturnType<typeof chatDb>) {
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: {
        userId: "user-test",
        tokenId: "device-test",
        admin: db.admin,
      },
    });
  }

  it("marca gli ID di A ma non chiude B arrivata nel frattempo", async () => {
    const expected = "2026-08-04T14:00:00.000Z";
    const db = chatDb({ closed: null });
    authenticate(db);
    const { POST } = await import("@/app/api/cloud-sync/chat/route");

    const response = await POST(
      request({
        delivered_ids: ["11111111-1111-4111-8111-111111111111"],
        close_rendezvous: true,
        expected_requested_at: expected,
      }),
    );

    expect(response.status).toBe(409);
    expect(db.messageUpdate).toHaveBeenCalledTimes(1);
    expect(db.stateQuery.eq).toHaveBeenCalledWith(
      "chat_requested_at",
      expected,
    );
    await expect(response.json()).resolves.toEqual({
      ok: false,
      delivered: 1,
      closed: false,
      reason: "superseded",
    });
  });

  it("non timbra il rendezvous quando close_rendezvous e' false", async () => {
    const db = chatDb({ closed: null });
    authenticate(db);
    const { POST } = await import("@/app/api/cloud-sync/chat/route");

    const response = await POST(
      request({
        delivered_ids: ["11111111-1111-4111-8111-111111111111"],
        close_rendezvous: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(db.messageUpdate).toHaveBeenCalledTimes(1);
    expect(db.stateUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      delivered: 1,
      closed: false,
    });
  });

  it("chiude soltanto la richiesta attesa e restituisce il timestamp server", async () => {
    const expected = "2026-08-04T14:00:00.000Z";
    const deliveredAt = "2026-08-04T14:00:01.000Z";
    const db = chatDb({
      closed: {
        chat_requested_at: expected,
        chat_delivered_at: deliveredAt,
      },
    });
    authenticate(db);
    const { POST } = await import("@/app/api/cloud-sync/chat/route");

    const response = await POST(
      request({
        delivered_ids: [],
        close_rendezvous: true,
        expected_requested_at: expected,
      }),
    );

    expect(response.status).toBe(200);
    expect(db.messageUpdate).not.toHaveBeenCalled();
    expect(db.stateQuery.or).toHaveBeenCalledWith(
      `chat_delivered_at.is.null,chat_delivered_at.lt.${expected}`,
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      delivered: 0,
      closed: true,
      chat_delivered_at: deliveredAt,
    });
  });
});
