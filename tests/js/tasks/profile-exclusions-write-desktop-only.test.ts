import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// JHT-T46: POST /api/profile-exclusions is a write of the user's config. The website (cloud deploy) is
// read-only, so it answers 403 read_only even with a valid session, and writes nothing; reading stays open.
const mocks = vi.hoisted(() => ({ resolveUser: vi.fn(), upsert: vi.fn(), select: vi.fn() }));

vi.mock("@/lib/team-state/auth", () => ({ resolveUser: mocks.resolveUser }));
vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/error-response", () => ({ sanitizedError: vi.fn(() => new Response("{}", { status: 500 })) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.test" }),
  cookies: async () => ({ get: () => undefined }),
}));

const TEST_TIMEOUT_MS = 15_000;
const USER = "11111111-1111-4111-8111-111111111111";

function session() {
  const single = vi.fn().mockResolvedValue({ data: { reason: "company", status: "accepted" }, error: null });
  mocks.select.mockReturnValue({ single });
  mocks.upsert.mockReturnValue({ select: mocks.select });
  const supabase = {
    from: vi.fn(() => ({
      upsert: mocks.upsert,
      select: () => ({ eq: vi.fn().mockResolvedValue({ data: [{ reason: "company", status: "accepted" }], error: null }) }),
    })),
  };
  mocks.resolveUser.mockResolvedValue({ ok: true, user: { source: "session", userId: USER, supabase } });
}

const post = (body: unknown) =>
  ({ json: async () => body, headers: new Headers(), cookies: { get: () => undefined } }) as never;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the website cannot write the exclusions of the profile", () => {
  it("on the cloud deploy a valid session gets 403 read_only, and nothing is looked up or written", async () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    session();
    const { POST } = await import("@/app/api/profile-exclusions/route");
    const res = await POST(post({ reason: "company", status: "accepted", positions: 3 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "read_only" });
    expect(mocks.resolveUser).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  }, TEST_TIMEOUT_MS);

  it("reading is still open to the session, so the website can show the proposal and the list", async () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    session();
    const { GET } = await import("@/app/api/profile-exclusions/route");
    const res = await GET({ headers: new Headers() } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exclusions: [{ reason: "company", status: "accepted" }] });
  }, TEST_TIMEOUT_MS);

  it("the gate comes first: a body that is not even JSON is refused as read only, not parsed", async () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    session();
    const { POST } = await import("@/app/api/profile-exclusions/route");
    const res = await POST({ json: async () => { throw new Error("not json"); } } as never);
    expect(res.status).toBe(403);
  }, TEST_TIMEOUT_MS);
});

describe("where the write is allowed, the route still does what it did", () => {
  it("a co-located box that passes the local-write gate writes the decision of the session's own user", async () => {
    vi.doMock("@/lib/auth", () => ({ requireLocalWrite: async () => null }));
    session();
    const { POST } = await import("@/app/api/profile-exclusions/route");
    const res = await POST(post({ reason: "company", status: "accepted", positions: 3 }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER, reason: "company", status: "accepted", positions_at_decision: 3 }),
      { onConflict: "user_id,reason" },
    );
    vi.doUnmock("@/lib/auth");
  }, TEST_TIMEOUT_MS);
});
