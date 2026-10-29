// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { APP_MENU_TEXT } from "./AppMenu.i18n";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the app's keys are wired", () => {
  it("both entry points mount the menu next to the exit dialog", () => {
    for (const entry of ["../main.tsx", "../dashboard/main.tsx"]) {
      const source = read(entry);
      expect(source, entry).toMatch(/<AppExitDialog \/>\s*<AppMenu \/>/);
    }
  });

  it("only the main window may go to full screen and back: two commands, nothing else", () => {
    const cap = JSON.parse(read("../../src-tauri/capabilities/window-fullscreen.json"));
    expect(cap.windows).toEqual(["main"]);
    expect(cap.permissions).toEqual(["core:window:allow-set-fullscreen", "core:window:allow-is-fullscreen"]);
  });

  it("⌘Q and the close button are sent to the exit dialog by the native side", () => {
    const lib = read("../../src-tauri/src/lib.rs");
    expect(lib).toContain("RunEvent::ExitRequested");
    expect(lib).toContain("api.prevent_exit()");
    expect(lib).toContain("WindowEvent::CloseRequested");
  });

  it("every language says every word of the menu", () => {
    const keys = Object.keys(APP_MENU_TEXT.en).sort();
    for (const locale of locales) {
      expect(Object.keys(APP_MENU_TEXT[locale]).sort(), locale).toEqual(keys);
      for (const key of keys) expect(APP_MENU_TEXT[locale][key as keyof typeof APP_MENU_TEXT.en].trim(), `${locale}.${key}`).not.toBe("");
    }
  });
});
