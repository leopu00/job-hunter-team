import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_EXPRESSIONS, ASSISTANT_PORTRAIT_SRC } from "../components/assistant-portrait/expressions";

// The Assistant's portraits came from the game as 1120x1520 PNGs, 2.5 MB each (11 MB for five): far
// too much for the bundle. They are 640 px WebP with their transparency, ~75 KB each.
const PUBLIC = resolve(process.cwd(), "public");
const MAX_ONE = 120 * 1024;
const MAX_ALL = 600 * 1024;

const file = (name: (typeof ASSISTANT_EXPRESSIONS)[number]) => join(PUBLIC, ASSISTANT_PORTRAIT_SRC[name]);

describe("the Assistant's portraits in the bundle", () => {
  it.each([...ASSISTANT_EXPRESSIONS])("%s: is a WebP with transparency, 640 px wide, in the size it has to be", (name) => {
    expect(existsSync(file(name)), file(name)).toBe(true);
    const bytes = readFileSync(file(name));
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    // an extended WebP (VP8X) whose flags say it has an alpha channel
    expect(bytes.subarray(12, 16).toString("latin1")).toBe("VP8X");
    expect(bytes[20] & 0x10, "alpha flag").toBe(0x10);
    expect(bytes.readUIntLE(24, 3) + 1).toBe(640);
    expect(bytes.readUIntLE(27, 3) + 1).toBeGreaterThan(640);
    expect(bytes.length).toBeLessThanOrEqual(MAX_ONE);
  });

  it("are the five of the game, and weigh less than 600 KB all together (not 11 MB)", () => {
    const sizes = ASSISTANT_EXPRESSIONS.map((name) => statSync(file(name)).size);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_ALL);
  });

  it("has nothing else in their folder: no PNG of the game came along", () => {
    const names = readdirSync(join(PUBLIC, "assistant")).sort();
    expect(names).toEqual(ASSISTANT_EXPRESSIONS.map((name) => `portrait-${name}.webp`).sort());
  });
});
