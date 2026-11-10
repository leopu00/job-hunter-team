import { describe, expect, it } from "vitest";
import { RUNTIME_TEXT } from "./onboarding-runtime.i18n";
import { parseToolsTier, toolsTierDelay, toolsTierTextKey, type ToolsTier } from "./tools-tier";
import { locales } from "@/i18n/config";

// The tools of the runtime (core image at install, full image in the background): the closed shape of the native
// round, what is said, and how often it asks. Synthetic replies only.
const seen = (state: ToolsTier["state"], tier: ToolsTier["tier"] = "core", message: ToolsTier["message"] = null): ToolsTier => ({ state, tier, message });

describe("tools tier", () => {
  it("accepts only the shapes the native round can answer", () => {
    expect(parseToolsTier({ state: "pulling", tier: "core", message: "ui_phase_tools_pull" })).toEqual(seen("pulling", "core", "ui_phase_tools_pull"));
    expect(parseToolsTier({ state: "none", tier: "full", message: null })).toEqual(seen("none", "full"));
    expect(parseToolsTier({ state: "ready", tier: "core" })).toEqual(seen("ready"));
    for (const bad of [null, "x", [], {}, { state: "done", tier: "core" }, { state: "ready", tier: "../x" }, { state: "ready", tier: "core", message: "ui_phase_image_pull" }, { tier: "core" }]) {
      expect(parseToolsTier(bad)).toBeNull();
    }
  });

  it("says the tools are arriving only while the core image waits for them, and when the team has moved", () => {
    for (const state of ["pending", "pulling", "ready"] as const) expect(toolsTierTextKey(seen(state), false)).toBe("ui_phase_tools_pull");
    for (const quiet of [seen("none"), seen("failed"), seen("ready", "full"), seen("pending", "full")]) expect(toolsTierTextKey(quiet, false)).toBeNull();
    expect(toolsTierTextKey(seen("none", "full"), true)).toBe("ui_phase_tools_ready");
    expect(toolsTierTextKey(null, false)).toBeNull();
  });

  it("asks often while the tools move, rarely when nothing moves, and stops on the full image", () => {
    expect(toolsTierDelay(seen("pulling"))).toBe(20_000);
    expect(toolsTierDelay(seen("ready"))).toBe(20_000);
    expect(toolsTierDelay(seen("failed"))).toBe(60_000);
    expect(toolsTierDelay(seen("none", "full"))).toBe(300_000);
    expect(toolsTierDelay(seen("none"))).toBe(300_000);
    expect(toolsTierDelay(null)).toBe(60_000);
    expect(toolsTierDelay(null, 2)).toBe(60_000);
    expect(toolsTierDelay(null, 3)).toBe(300_000);
    expect(toolsTierDelay(seen("ready", "full"))).toBeNull();
  });

  it("has the two phase texts in every language", () => {
    for (const locale of locales) {
      for (const key of ["ui_phase_tools_pull", "ui_phase_tools_ready"] as const) {
        expect(RUNTIME_TEXT[locale][key].length, `${locale} ${key}`).toBeGreaterThan(10);
      }
    }
  });
});
