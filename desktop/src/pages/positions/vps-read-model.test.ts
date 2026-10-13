import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
}));

beforeEach(() => {
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
  fake.current = createPermissiveSupabase();
});

describe("existing VPS team data for position pages", () => {
  it("takes the fixed native list projection before the cloud client", async () => {
    native.invoke.mockResolvedValue({
      ok: true,
      data: [{ id: "42", title: "Synthetic role", company: "Synthetic company", status: "scored" }],
    });
    const { getPositions } = await import("@/lib/queries");

    await expect(getPositions({ q: "Synthetic" })).resolves.toEqual([
      { id: "42", title: "Synthetic role", company: "Synthetic company", status: "scored" },
    ]);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: { op: "list", filters: { q: "Synthetic" } },
    });
    expect(fake.current!.calls).toEqual([]);
  });

  it("uses the fixed detail and facets projections", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValueOnce({ ok: true, data: [] });
    const { getPositionById, getPositionFacets } = await import("@/lib/queries");

    await expect(getPositionById("42")).resolves.toBeNull();
    await expect(getPositionFacets()).resolves.toEqual([]);
    expect(native.invoke).toHaveBeenNthCalledWith(1, "existing_team_positions_read", {
      request: { op: "detail", id: "42" },
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "existing_team_positions_read", {
      request: { op: "facets" },
    });
    expect(fake.current!.calls).toEqual([]);
  });

  it("does not substitute cloud rows when the validated runtime is unavailable", async () => {
    native.invoke.mockResolvedValue({ ok: false, error: "runtime_target_mismatch" });
    const { getPositions, getPositionById, getPositionFacets } = await import("@/lib/queries");

    await expect(getPositions()).resolves.toEqual([]);
    await expect(getPositionById("42")).resolves.toBeNull();
    await expect(getPositionFacets()).resolves.toEqual([]);
    expect(fake.current!.calls).toEqual([]);
  });
});
