/** O-66 — il device può pubblicare solo l'esito minimale del controllo. */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveUser: vi.fn() }));

vi.mock("@/lib/team-state/auth", () => ({ resolveUser: mocks.resolveUser }));

function request(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) } as never;
}

describe("PATCH /api/team-state — osservazione push automatico", () => {
  it("accetta current+timestamp dal device attivo senza firma locale", async () => {
    const check = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          active_device_id: "device-test",
          sync_requested_at: null,
        },
        error: null,
      }),
    };
    check.select.mockReturnValue(check);
    check.eq.mockReturnValue(check);
    const write = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          cloud_push_status: "current",
          cloud_push_checked_at: "2026-08-12T18:00:00.000Z",
        },
        error: null,
      }),
    };
    write.select.mockReturnValue(write);
    const upsert = vi.fn().mockReturnValue(write);
    const from = vi.fn(() => ({ ...check, upsert }));
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
    const observation = {
      cloud_push_status: "current",
      cloud_push_checked_at: "2026-08-12T17:59:59.000Z",
    };

    const response = await PATCH(request(observation));

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-test", ...observation },
      { onConflict: "user_id" },
    );
    expect(JSON.stringify(observation)).not.toContain("positions");
  });
});
