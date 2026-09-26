import { describe, expect, it, vi } from "vitest";
import { getPositionLocations, getPositionsWithCoords, getPositionsWithoutCoords } from "@/lib/queries";
import { notInDesktop } from "../../shell/api-bridge";
import { mapApi } from "./map-api";

vi.mock("@/lib/queries", () => ({
  getPositionsWithCoords: vi.fn(async () => [{ id: "p1", lat: 45, lng: 9 }]),
  getPositionsWithoutCoords: vi.fn(async () => [{ id: "p2" }]),
  getPositionLocations: vi.fn(async () => [{ country: "IT", count: 2 }]),
}));

describe("mapApi", () => {
  it("answers the globe's routes with the web queries", async () => {
    const api = mapApi(notInDesktop);
    expect(await (await api("/api/positions/coords")).json()).toEqual([{ id: "p1", lat: 45, lng: 9 }]);
    expect(await (await api("/api/positions/no-coords")).json()).toEqual([{ id: "p2" }]);
    expect(await (await api("/api/positions/locations")).json()).toEqual([{ country: "IT", count: 2 }]);
    expect(getPositionsWithCoords).toHaveBeenCalledTimes(1);
    expect(getPositionsWithoutCoords).toHaveBeenCalledTimes(1);
    expect(getPositionLocations).toHaveBeenCalledTimes(1);
  });

  it("leaves writes and other routes to the next answer", async () => {
    const api = mapApi(notInDesktop);
    expect((await api("/api/positions/coords", { method: "POST" })).status).toBe(404);
    expect((await api("/api/positions/facets")).status).toBe(404);
  });
});
