import { describe, expect, it, vi } from "vitest";
import { createFitOnReady } from "@/lib/globe-fit-scheduler";

describe("fit on ready", () => {
  it("fits when the style is already loaded as the data arrive", () => {
    const run = vi.fn();
    const fit = createFitOnReady(run);
    fit.dataChanged(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the fit for style.load when the data arrive first (the race that left the map at zoom 1.8)", () => {
    const run = vi.fn();
    const fit = createFitOnReady(run);
    fit.dataChanged(false);
    expect(run).not.toHaveBeenCalled();
    fit.layersReady();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not fit on style.load when there was nothing waiting (a theme change reloads the style)", () => {
    const run = vi.fn();
    const fit = createFitOnReady(run);
    fit.layersReady();
    fit.dataChanged(true);
    run.mockClear();
    fit.layersReady();
    expect(run).not.toHaveBeenCalled();
  });

  it("fits once for the waiting request, however many times the style loads", () => {
    const run = vi.fn();
    const fit = createFitOnReady(run);
    fit.dataChanged(false);
    fit.dataChanged(false);
    fit.layersReady();
    fit.layersReady();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fits at every later change of the data", () => {
    const run = vi.fn();
    const fit = createFitOnReady(run);
    fit.dataChanged(false);
    fit.layersReady();
    fit.dataChanged(true);
    fit.dataChanged(true);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
