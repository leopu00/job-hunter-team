import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/cloud-sync/profile-exclusions (JHT-T24): the team's way to the user's decisions on the
// exclusions of the profile. Code, state and date of the token's own user, and nothing else.
const mocks = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  checkCloudSyncRateLimit: vi.fn(),
  sanitizedError: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({ verifyBearerToken: mocks.verifyBearerToken }));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({ checkCloudSyncRateLimit: mocks.checkCloudSyncRateLimit }));
vi.mock("@/lib/error-response", () => ({ sanitizedError: mocks.sanitizedError }));

const TEST_TIMEOUT_MS = 15_000;
const USER = "11111111-1111-4111-8111-111111111111";

function db(result: { data: unknown; error: unknown }) {
  const eq = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { admin: { from }, from, select, eq };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
});

describe("cloud-sync/profile-exclusions", () => {
  it("answers a token that does not verify with that answer, reading nothing", async () => {
    const refusal = new Response("{}", { status: 401 });
    mocks.verifyBearerToken.mockResolvedValue({ ok: false, res: refusal });
    const { GET } = await import("@/app/api/cloud-sync/profile-exclusions/route");
    expect(await GET({} as never)).toBe(refusal);
  }, TEST_TIMEOUT_MS);

  it("reads code, state and date of the token's own user and nothing else", async () => {
    const q = db({ data: [{ reason: "company", status: "accepted", decided_at: "2026-10-21T10:00:00Z" }], error: null });
    mocks.verifyBearerToken.mockResolvedValue({ ok: true, data: { userId: USER, admin: q.admin, tokenId: "t1" } });
    const { GET } = await import("@/app/api/cloud-sync/profile-exclusions/route");
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      exclusions: [{ reason: "company", status: "accepted", decided_at: "2026-10-21T10:00:00Z" }],
    });
    expect(q.from).toHaveBeenCalledWith("profile_exclusions");
    expect(q.select).toHaveBeenCalledWith("reason, status, decided_at");
    expect(q.eq).toHaveBeenCalledWith("user_id", USER);
  }, TEST_TIMEOUT_MS);

  it("is rate limited per token, and says when to come back", async () => {
    mocks.verifyBearerToken.mockResolvedValue({ ok: true, data: { userId: USER, admin: db({ data: [], error: null }).admin, tokenId: "t1" } });
    mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 12 });
    const { GET } = await import("@/app/api/cloud-sync/profile-exclusions/route");
    const res = await GET({} as never);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
  }, TEST_TIMEOUT_MS);

  it("hands a database error to the sanitiser and leaks nothing", async () => {
    const q = db({ data: null, error: { message: "secret detail" } });
    mocks.verifyBearerToken.mockResolvedValue({ ok: true, data: { userId: USER, admin: q.admin, tokenId: "t1" } });
    mocks.sanitizedError.mockReturnValue(new Response("{}", { status: 500 }));
    const { GET } = await import("@/app/api/cloud-sync/profile-exclusions/route");
    const res = await GET({} as never);
    expect(res.status).toBe(500);
    expect(mocks.sanitizedError).toHaveBeenCalledWith(
      { message: "secret detail" },
      expect.objectContaining({ scope: "cloud-sync/profile-exclusions", publicMessage: "query_failed" }),
    );
  }, TEST_TIMEOUT_MS);
});
