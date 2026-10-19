import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A tester's PC is a 1366x768 laptop. `height` in tauri.conf is the webview's
// own height: Windows adds the title bar and the frame, and the taskbar takes
// the bottom of the screen. With 760 the window was 788 px tall at top 0 and the
// bottom of the first screens sat under the taskbar.
const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
  app: { windows: { label: string; width: number; height: number; minWidth: number; minHeight: number; center?: boolean }[] };
};
const main = config.app.windows.find((window) => window.label === "main")!;

const SCREEN = { width: 1366, height: 768 };
const TASKBAR = 48; // Windows 11 at 100%; Windows 10 is 40
const DECORATION = 40; // title bar + frame, with margin (28 measured at 100%)

describe("the main window on a 1366x768 screen", () => {
  it("opens inside the work area at 100%, title bar included", () => {
    expect(main.height + DECORATION).toBeLessThanOrEqual(SCREEN.height - TASKBAR);
    expect(main.width).toBeLessThanOrEqual(SCREEN.width);
  });

  it("can be shrunk to fit the work area at 125% scaling (the next common setting)", () => {
    const workAreaHeight = (SCREEN.height - TASKBAR) / 1.25;
    expect(main.minHeight + DECORATION).toBeLessThanOrEqual(workAreaHeight);
  });

  it("opens no smaller than it can be, and stays centred", () => {
    expect(main.height).toBeGreaterThanOrEqual(main.minHeight);
    expect(main.width).toBeGreaterThanOrEqual(main.minWidth);
    expect(main.center).toBe(true);
  });
});
