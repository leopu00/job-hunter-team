import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  sanitizedError: vi.fn(),
}));

vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: mocks.resolveUser,
}));
vi.mock("@/lib/deploy-mode", () => ({
  isCloudDeploy: vi.fn(() => true),
}));
vi.mock("@/lib/error-response", () => ({
  sanitizedError: mocks.sanitizedError,
}));

function request(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) } as never;
}

function teamStateDb(syncRequestedAt: string) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      active_device_id: "device-test",
      sync_requested_at: syncRequestedAt,
    },
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const selectCurrent = vi.fn(() => ({ eq }));
  const single = vi.fn().mockImplementation(async () => ({
    data: upsert.mock.calls[0]?.[0] ?? null,
    error: null,
  }));
  const selectWritten = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select: selectWritten }));
  const from = vi.fn(() => ({ select: selectCurrent, upsert }));
  return {
    supabase: { from },
    from,
    selectCurrent,
    upsert,
  };
}

describe("observed sync via fallback HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("timbra l'esito dopo requested_at anche con clock VPS/server in skew", async () => {
    const requestedAt = "2026-08-04T14:00:05.000Z";
    const db = teamStateDb(requestedAt);
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: {
        source: "token",
        userId: "user-test",
        token: { tokenId: "device-test" },
        supabase: db.supabase,
      },
    });

    const { PATCH } = await import("@/app/api/team-state/route");
    const response = await PATCH(
      request({
        last_action: "sync:push_failed",
        // Timestamp VPS deliberatamente inattendibile: la route lo ignora.
        last_action_at: "2020-01-01T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(db.selectCurrent).toHaveBeenCalledWith(
      "active_device_id, sync_requested_at",
    );
    expect(db.upsert).toHaveBeenCalledWith(
      {
        user_id: "user-test",
        last_action: "sync:push_failed",
        last_action_at: "2026-08-04T14:00:05.001Z",
      },
      { onConflict: "user_id" },
    );
  });

  it("successo conserva completion e action nello stesso upsert", async () => {
    const requestedAt = "2026-08-04T13:59:59.000Z";
    const db = teamStateDb(requestedAt);
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: {
        source: "token",
        userId: "user-test",
        token: { tokenId: "device-test" },
        supabase: db.supabase,
      },
    });

    const { PATCH } = await import("@/app/api/team-state/route");
    const response = await PATCH(
      request({
        last_action: "sync:completed",
        last_action_at: "2020-01-01T00:00:00.000Z",
        sync_completed_at: "2026-08-04T14:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(db.upsert.mock.calls[0][0]).toMatchObject({
      user_id: "user-test",
      last_action: "sync:completed",
      last_action_at: "2026-08-04T14:00:00.000Z",
      sync_completed_at: "2026-08-04T14:00:00.000Z",
    });
  });
});
