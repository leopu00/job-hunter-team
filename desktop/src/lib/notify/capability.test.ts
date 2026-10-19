import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the notification plugin's reach", () => {
  it("only the main window may ask for the permission and notify: three commands, nothing else", () => {
    const cap = JSON.parse(read("../../../src-tauri/capabilities/new-position-notification.json"));
    expect(cap.windows).toEqual(["main"]);
    expect(cap.permissions).toEqual(["notification:allow-is-permission-granted", "notification:allow-request-permission", "notification:allow-notify"]);
    // no other capability hands the plugin anything
    for (const other of ["default.json", "ssh-key-dialog.json"]) {
      expect(read(`../../../src-tauri/capabilities/${other}`), other).not.toMatch(/notification:/);
    }
  });

  it("the plugin is pinned to the same version on both sides, the one that works with the project's Tauri 2.11", () => {
    expect(read("../../../src-tauri/Cargo.toml")).toMatch(/^tauri-plugin-notification = "=2\.4\.0"$/m);
    expect(JSON.parse(read("../../../package.json")).dependencies["@tauri-apps/plugin-notification"]).toBe("2.4.0");
    expect(read("../../../src-tauri/src/lib.rs")).toContain(".plugin(tauri_plugin_notification::init())");
  });
});
