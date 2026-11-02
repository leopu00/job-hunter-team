// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The app runs on Mac, Windows and Linux: a text that every computer can show says «computer» (or the
// system's own name when the text is about one system), never «this Mac». The catalog of errors
// (error-catalog.ts) is not in this scan on purpose: its Mac lines are about Homebrew and the Podman
// machine, which only a Mac has.
describe("the texts of the app", () => {
  it("do not call the person's computer «Mac» in any of the *.i18n.ts files", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
        return /\.i18n\.ts$/.test(name) ? [path] : [];
      });
    const offenders = walk(root).flatMap((file) =>
      readFileSync(file, "utf-8")
        .split("\n")
        .map((line, index) => ({ line, at: `${file.slice(root.length)}:${index + 1}` }))
        // a comment may name the system; a text may not
        .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line) && /(?<![\p{L}-])Mac(?:en|-en)?(?![\p{L}])/u.test(line))
        .map(({ at, line }) => `${at}: ${line.trim().slice(0, 90)}`),
    );
    expect(offenders).toEqual([]);
  });
});
