import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// «Key file» above «Choose key…» was nearly invisible in the setup: the picker's colours named tokens
// (`--ink`, `--muted`, …) that no stylesheet of the app defines, so it always painted its own dark-theme
// fallbacks, near-white on the light panels. It now speaks the app's own tokens, like the fields next to it.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ssh-key-picker.css"), "utf8").replace(/\r\n/g, "\n");

describe("the key picker's colours", () => {
  it("use only the app's theme tokens, never tokens that nothing defines", () => {
    for (const token of ["--ink", "--muted", "--line", "--panel-soft", "--accent"]) {
      expect(css, token).not.toContain(`var(${token}`);
    }
    for (const [, name] of css.matchAll(/var\((--[a-z-]+)/g)) {
      expect(name, name).toMatch(/^--color-(base|white|muted|border|deep)$/);
    }
  });

  it("paints the label with the same token as the labels of the fields next to it", () => {
    expect(css).toMatch(/\.ssh-key-picker__label\s*\{\s*color: var\(--color-base,/);
  });
});
