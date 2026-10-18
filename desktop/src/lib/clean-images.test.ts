import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { CLEAN_IMAGES_SKIPPED, cleanImages, cleanImagesResult, parseCleanImagesOutcome, type CleanImagesOutcome } from "./clean-images";
import { ERROR_CATALOG } from "./error-catalog";

const outcome = (overrides: Partial<CleanImagesOutcome> = {}): CleanImagesOutcome => ({
  removed: 0, freedBytes: 0, refused: 0, inUse: 0, skipped: "", virtualMachine: false, ...overrides,
});
afterEach(() => { native.invoke.mockReset(); native.isTauri.mockReturnValue(true); });

describe("clean-images", () => {
  it("runs the native command for the host being set up, or the saved one", async () => {
    native.invoke.mockResolvedValue(outcome({ removed: 1, freedBytes: 10 }));
    const host = { kind: "local" } as const;
    expect(await cleanImages(host)).toEqual(outcome({ removed: 1, freedBytes: 10 }));
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_clean_images", { host });
    await cleanImages(null);
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_clean_images", { host: null });
  });

  it("refuses a reply it does not recognise, and outside the desktop app", async () => {
    for (const reply of [null, [], { ...outcome(), removed: -1 }, { ...outcome(), freedBytes: 1.5 },
      { ...outcome(), skipped: "brand-new" }, { ...outcome(), virtualMachine: "yes" }]) {
      expect(parseCleanImagesOutcome(reply), JSON.stringify(reply)).toBeNull();
      native.invoke.mockResolvedValueOnce(reply);
      await expect(cleanImages(null)).rejects.toEqual({ code: "clean_images_failed" });
    }
    native.isTauri.mockReturnValue(false);
    await expect(cleanImages(null)).rejects.toEqual({ code: "desktop_only" });
  });

  it("passes the native error codes through", async () => {
    native.invoke.mockRejectedValue({ code: "clean_images_engine_off" });
    await expect(cleanImages(null)).rejects.toEqual({ code: "clean_images_engine_off" });
  });

  it("tells every outcome with a catalog entry", () => {
    expect(cleanImagesResult(outcome({ removed: 2, freedBytes: 99 }))).toEqual({ code: "clean_images_freed", bytes: 99 });
    expect(cleanImagesResult(outcome({ removed: 2, freedBytes: 99, virtualMachine: true }))).toEqual({ code: "clean_images_freed_vm", bytes: 99 });
    expect(cleanImagesResult(outcome())).toEqual({ code: "clean_images_nothing" });
    expect(cleanImagesResult(outcome({ inUse: 1, refused: 1 }))).toEqual({ code: "clean_images_in_use" });
    expect(cleanImagesResult(outcome({ refused: 1 }))).toEqual({ code: "clean_images_refused" });
    const expected: Record<string, string> = {
      "opt-out": "clean_images_kept_by_choice", "runtime-not-installed": "clean_images_nothing",
      "upgrade-in-progress": "clean_images_upgrade", "upgrade-pending": "clean_images_upgrade",
      "current-unidentified": "clean_images_container_off", "current-not-running": "clean_images_container_off",
      "previous-unidentified": "clean_images_dates_unreadable", "containers-unreadable": "clean_images_engine_unreadable",
      "images-unreadable": "clean_images_engine_unreadable", unknown: "clean_images_kept",
    };
    for (const skipped of CLEAN_IMAGES_SKIPPED.filter((value) => value !== "")) {
      const { code } = cleanImagesResult(outcome({ skipped }));
      expect(code, skipped).toBe(expected[skipped]);
      expect(code in ERROR_CATALOG, code).toBe(true);
    }
  });
});
