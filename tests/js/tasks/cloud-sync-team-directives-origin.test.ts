import { beforeEach, describe, expect, it, vi } from "vitest";

// The pull of the standing orders by the box (GET /api/cloud-sync/team-directives) reads `origin`, a column
// born with cloud migration 101. The 101 goes on the cloud after this web is deployed: in between the
// database has no column, and the pull must keep working without it (the box takes an order with no
// origin as written on the website and tells the user). Synthetic data only.

const state = vi.hoisted(() => ({
  hasOrigin: true,
  failWith: null as null | { code: string; message: string },
  selects: [] as string[],
}));

const ROW = {
  id: 7,
  body: "CVs only for 90+",
  kind: "strategy",
  status: "active",
  sort_order: 0,
  created_by: "user",
  created_at: "2026-10-22T10:00:00Z",
  updated_at: "2026-10-22T10:00:00Z",
  archived_at: null,
};

const admin = vi.hoisted(() => ({
  from: (table: string) => {
    let columns = "";
    const builder = {
      select: (c: string) => {
        columns = c;
        state.selects.push(c);
        return builder;
      },
      eq: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: async () => {
        if (table !== "team_directives") return { data: null, error: { code: "XX000", message: "table" } };
        if (state.failWith) return { data: null, error: state.failWith };
        if (/\borigin\b/.test(columns) && !state.hasOrigin) {
          return {
            data: null,
            error: { code: "42703", message: "column team_directives.origin does not exist" },
          };
        }
        return {
          data: [state.hasOrigin && /\borigin\b/.test(columns) ? { ...ROW, origin: "web" } : { ...ROW }],
          error: null,
        };
      },
    };
    return builder;
  },
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: { userId: "synthetic-user", tokenId: "synthetic-token", admin },
  })),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));

const pull = async () => {
  const route = await import("@/app/api/cloud-sync/team-directives/route");
  return route.GET(
    new Request("http://localhost/api/cloud-sync/team-directives?since=2026-10-01T00:00:00Z") as never,
  );
};

beforeEach(() => {
  state.hasOrigin = true;
  state.failWith = null;
  state.selects = [];
});

describe("the pull of the standing orders and the column of migration 101", () => {
  it("with the 101: one read, and every order says who wrote it", async () => {
    const res = await pull();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.directives).toEqual([{ ...ROW, origin: "web" }]);
    expect(state.selects).toHaveLength(1);
    expect(state.selects[0]).toMatch(/\borigin\b/);
  });

  it("before the 101: the read without the column, and the orders still reach the box", async () => {
    state.hasOrigin = false;
    const res = await pull();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.directives).toEqual([ROW]);
    expect(json.directives[0]).not.toHaveProperty("origin");
    expect(json.cursor).toBe(ROW.updated_at);
    expect(state.selects).toHaveLength(2);
    expect(state.selects[1]).not.toMatch(/\borigin\b/);
  });

  it("any other failure is a failure: no second read, no orders", async () => {
    state.failWith = { code: "42501", message: "permission denied for table team_directives" };
    const res = await pull();
    expect(res.status).toBe(500);
    expect(state.selects).toHaveLength(1);
  });
});
