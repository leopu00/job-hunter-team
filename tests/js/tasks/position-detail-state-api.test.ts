import { describe, expect, it, vi } from "vitest";

const getPositionById = vi.fn(async () => ({
  position: { id: "synthetic", legacy_id: 5, status: "review" },
  score: null,
  highlights: [],
  company: null,
  application: { status: "review" },
  tickets: [],
}));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/queries", () => ({ getPositionById }));

const { GET } = await import("@/app/api/positions/[legacyId]/route");

describe("O-89 position detail API", () => {
  it("returns canonical position/application states and a separate ticket indicator", async () => {
    const response = await GET(new Request("https://example.invalid") as never, {
      params: Promise.resolve({ legacyId: "5" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "preparing",
      application_state: "preparing",
      ticket_indicator: "none",
      position: { status: "review" },
      application: { status: "review" },
    });
  });
});
