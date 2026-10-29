// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The scene itself needs WebGL, so what it is given is read from its source: the cap, the resolution and the pause.
const scene = readFileSync(fileURLToPath(new URL("./pixi-scene.ts", import.meta.url)), "utf8");

describe("the office scene is made with the frame pace", () => {
  it("takes its resolution from the capped one, never the raw device pixel ratio", () => {
    expect(scene).toContain("resolution: sceneResolution(window.devicePixelRatio)");
    expect(scene).not.toMatch(/resolution:\s*window\.devicePixelRatio/);
  });

  it("caps the three tickers (the scene's, the shared one, Pixi's own) at the office's frame rate and pauses them with the window", () => {
    expect(scene).toContain("app.ticker.maxFPS = OFFICE_MAX_FPS");
    expect(scene).toContain("Ticker.shared.maxFPS = OFFICE_MAX_FPS");
    expect(scene).toContain("Ticker.system.maxFPS = OFFICE_MAX_FPS");
    expect(scene).toMatch(/pauseWhenHidden\(\[app\.ticker, Ticker\.shared, Ticker\.system\]\)/);
  });

  it("stops watching the window when the scene is destroyed", () => {
    expect(scene).toMatch(/destroy\(\) \{[\s\S]*?stopPause\(\);[\s\S]*?app\.destroy/);
  });
});
