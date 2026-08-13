import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { VERDICT_SIGNAL } from "@/lib/position-verdict";

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (relative: string) =>
  readFileSync(resolve(ROOT, relative), "utf8");

const FEEDBACK_SURFACES = [
  "web/app/(protected)/positions/[id]/FeedbackButtons.tsx",
  "web/app/(protected)/swipe/SwipeDeck.tsx",
];

describe("O-76 feedback future-only boundary", () => {
  it("maps every verdict to feedback only, including dislike", () => {
    expect(VERDICT_SIGNAL.no).toEqual({
      action: "dislike",
      score: 1,
      direction: "less_like_this",
    });
    for (const signal of Object.values(VERDICT_SIGNAL)) {
      expect(signal).not.toHaveProperty("exclude");
    }
  });

  it.each(FEEDBACK_SURFACES)("%s cannot call the exclusion writer", (path) => {
    const source = read(path);
    expect(source).toContain("/feedback");
    expect(source).not.toContain("/user-exclude");
  });

  it("keeps explicit exclusion as a separate action", () => {
    const page = read("web/app/(protected)/positions/[id]/page.tsx");
    const explicit = read(
      "web/app/(protected)/positions/[id]/ExcludeButton.tsx",
    );
    expect(page).toContain("<ExcludeButton");
    expect(explicit).toContain("/user-exclude");
  });

  it("uses the same non-exclusion label in all seven locales", () => {
    const labels = (source: string) =>
      [...source.matchAll(/verdicts:\s*\{\s*no:\s*"([^"]+)"/g)].map(
        ([, value]) => value,
      );
    const detail = labels(read(FEEDBACK_SURFACES[0]));
    const swipe = labels(read("web/app/(protected)/swipe/SwipeDeck.i18n.ts"));
    expect(detail).toHaveLength(7);
    expect(detail).toEqual(swipe);
  });
});
