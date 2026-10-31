// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("both pages of the app open the links to the outside in the person's browser", () => {
  for (const [name, path] of [["the first page (language, sign-in)", "./main.tsx"], ["the dashboard", "./dashboard/main.tsx"]] as const) {
    it(`${name} installs the listener before it renders`, () => {
      const source = read(path);
      const install = source.indexOf("installExternalLinks();");
      expect(install, path).toBeGreaterThan(-1);
      expect(install, path).toBeLessThan(source.indexOf("createRoot("));
    });
  }

  it("the command is registered and its capability is the main window's alone", () => {
    expect(read("../src-tauri/src/lib.rs")).toContain("external_links::open_external_url,");
    const native = read("../src-tauri/src/external_links.rs");
    expect(native).toContain('window.label() == "main"');
    expect(read("../src-tauri/src/public_pages.rs")).not.toContain("open_external");
  });
});
