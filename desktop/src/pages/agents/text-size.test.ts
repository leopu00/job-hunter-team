import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { expect, it } from "vitest";

// The agents' panel and the office's panel are read at a glance, in a window
// that is often small or zoomed: no text below 11px (the same floor as the
// onboarding's). The scene's own canvas labels are not here: they are scaled
// with the camera (office/scene/readable.ts). The tests run from desktop/.
const FLOOR = 11;
const DIRS = ["src/pages/agents", "src/office/panel"];

const sources = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    // posix: the same «src/pages/agents/…» on Windows, where join would write backslashes
    .map((f) => posix.join(dir, f)),
);

it("reads the panels' sources", () => {
  expect(sources).toContain("src/pages/agents/AgentsPanel.tsx");
  expect(sources).toContain("src/office/panel/OfficePanel.tsx");
});

it("has no text below 11px in the agents' and the office's panels", () => {
  const small: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf-8");
    for (const m of text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]|fontSize:\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/g)) {
      const px = Number(m[1] ?? m[2]);
      if (px < FLOOR) small.push(`${file}: ${m[0]}`);
    }
  }
  expect(small).toEqual([]);
});
