import { describe, expect, it } from "vitest";
import { assetUrl } from "./asset-url";

describe("assetUrl", () => {
  it("keeps the app's host on tauri://localhost (macOS, Linux)", () => {
    expect(assetUrl("/office/floor/wall_main.png", "tauri://localhost/dashboard.html#/office")).toBe(
      "tauri://localhost/office/floor/wall_main.png",
    );
  });

  it("keeps the host on http://tauri.localhost (Windows) and on the dev server", () => {
    expect(assetUrl("/office/a.png", "http://tauri.localhost/dashboard.html")).toBe("http://tauri.localhost/office/a.png");
    expect(assetUrl("/office/a.png", "http://127.0.0.1:1420/dashboard.html#/office")).toBe("http://127.0.0.1:1420/office/a.png");
  });

  it("leaves a full URL alone, and the path as it is with no page to resolve it against", () => {
    expect(assetUrl("tauri://localhost/office/a.png", "tauri://localhost/x")).toBe("tauri://localhost/office/a.png");
    expect(assetUrl("/office/a.png", "")).toBe("/office/a.png");
  });
});
