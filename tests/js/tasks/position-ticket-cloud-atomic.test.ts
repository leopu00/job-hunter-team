import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/deploy-mode", () => ({ isCloudDeploy: () => true }));
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(async () => ({
    ok: true,
    user: { source: "session", userId: "synthetic-user", supabase: { rpc } },
  })),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

const { POST } = await import("@/app/api/positions/[legacyId]/ticket/route");

function request() {
  return POST(
    new Request("https://example.invalid/api/positions/5/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_text: "Synthetic request",
        kind: "rescore",
      }),
    }) as never,
    { params: Promise.resolve({ legacyId: "5" }) },
  );
}

beforeEach(() => rpc.mockReset());

describe("O-89 cloud ticket atomic ACK", () => {
  it("uses only the tenant-bound RPC and returns state separately", async () => {
    rpc.mockResolvedValue({
      data: {
        id: "42",
        status: "open",
        position_status: "review",
        deduplicated: false,
      },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("create_position_ticket", {
      p_position_legacy_id: 5,
      p_request_text: "Synthetic request",
      p_kind: "rescore",
    });
    await expect(response.json()).resolves.toMatchObject({
      status: "open",
      position_state: "preparing",
      ticket_indicator: "pending",
      deduplicated: false,
    });
  });

  it("fails closed on a malformed transactional receipt", async () => {
    rpc.mockResolvedValue({ data: { id: "42", status: "open" }, error: null });
    const response = await request();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "invalid_ack" });
  });
});
