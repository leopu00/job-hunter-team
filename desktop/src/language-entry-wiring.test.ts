// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("both pages of the app keep the language through the cookie mirror", () => {
  for (const [name, path] of [["the first page (language, sign-in)", "./main.tsx"], ["the dashboard", "./dashboard/main.tsx"]] as const) {
    it(`${name} installs it before it renders`, () => {
      const source = read(path);
      const install = source.indexOf("installCookieMirror();");
      expect(install, path).toBeGreaterThan(-1);
      expect(install, path).toBeLessThan(source.indexOf("createRoot("));
    });
  }
});
