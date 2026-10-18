import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import {
  syntheticDetail,
  syntheticFacets,
  syntheticPosition,
} from "../../test-support/existing-team-positions-fixture";

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
      data: { items: [syntheticPosition] },
    });
    const { getPositions } = await import("@/lib/queries");

    await expect(getPositions({ q: "Synthetic" })).resolves.toEqual([syntheticPosition]);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: { op: "list", filters: { q: "Synthetic" } },
    });
    expect(fake.current!.calls).toEqual([]);
  });

  it("preserves complete detail relations and correlated facets from the validated runtime", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: syntheticDetail })
      .mockResolvedValueOnce({ ok: true, data: { items: syntheticFacets } });
    const { getPositionById, getPositionFacets } = await import("@/lib/queries");

    await expect(getPositionById("101")).resolves.toEqual(syntheticDetail);
    await expect(getPositionFacets()).resolves.toEqual(syntheticFacets);
    expect(syntheticDetail.score?.position_id).toBe(syntheticDetail.position.id);
    expect(syntheticDetail.highlights[0]?.position_id).toBe(syntheticDetail.position.id);
    expect(syntheticDetail.application?.position_id).toBe(syntheticDetail.position.id);
    expect(syntheticDetail.tickets[0]?.position_id).toBe(syntheticDetail.position.id);
    expect(syntheticDetail.company?.id).toBe(syntheticDetail.position.company_id);
    expect(syntheticFacets.map((facet) => [facet.id, facet.company, facet.score, facet.loc_country])).toEqual([
      ["101", "Synthetic Co A", 91, "AA"],
      ["102", "Synthetic Co B", 64, "BB"],
    ]);
    expect(native.invoke).toHaveBeenNthCalledWith(1, "existing_team_positions_read", {
      request: { op: "detail", id: "101" },
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "existing_team_positions_read", {
      request: { op: "facets" },
    });
    expect(fake.current!.calls).toEqual([]);
  });

  it("counts the sidebar's sources from the validated facets, without the excluded", async () => {
    const items = [
      ...syntheticFacets,
      { ...syntheticFacets[0], id: "103", status: "excluded", source: "board-c" },
      { ...syntheticFacets[0], id: "104", source: "synthetic" },
      { ...syntheticFacets[0], id: "105", source: null },
    ];
    native.invoke.mockResolvedValue({ ok: true, data: { items } });
    const { getSourceDistribution } = await import("@/lib/queries");

    await expect(getSourceDistribution()).resolves.toEqual([
      { source: "synthetic", count: 2 },
      { source: "board-b", count: 1 },
      { source: "sconosciuta", count: 1 },
    ]);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "facets" } });
    expect(fake.current!.calls).toEqual([]);
  });

  it("does not substitute cloud rows when the validated runtime is unavailable", async () => {
    native.invoke.mockResolvedValue({ ok: false, error: "runtime_target_mismatch" });
    const { getPositions, getPositionById, getPositionFacets, getSourceDistribution } = await import("@/lib/queries");

    await expect(getPositions()).resolves.toEqual([]);
    await expect(getPositionById("42")).resolves.toBeNull();
    await expect(getPositionFacets()).resolves.toEqual([]);
    await expect(getSourceDistribution()).resolves.toEqual([]);
    expect(fake.current!.calls).toEqual([]);
  });
});
