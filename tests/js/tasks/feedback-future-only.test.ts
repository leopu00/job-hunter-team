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

  it("describes future-only learning in all seven public Scorer locales", () => {
    const scorer = read("web/app/agents/page.tsx")
      .split('slug: "scorer"')[1]
      .split('slug: "scrittore"')[0];
    const paragraphs = [...scorer.matchAll(/p2:\s*"([^"]+)"/g)].map(
      ([, copy]) => copy,
    );
    const futureTerms = [
      "futuro",
      "future",
      "futuro",
      "avenir",
      "künftig",
      "futuro",
      "jövőben",
    ];
    expect(paragraphs).toHaveLength(7);
    paragraphs.forEach((copy, index) =>
      expect(copy.toLowerCase()).toContain(futureTerms[index]),
    );
    expect(scorer.toLowerCase()).not.toMatch(
      /ricalibra|recalibrates|recalibra|recalibre|kalibriert|igazítja a pontszámot/,
    );
  });

  it("keeps the Mentor cross-reference on aggregate future themes in EN+6", () => {
    const locales = ["", ".it", ".es", ".fr", ".de", ".pt", ".hu"];
    for (const locale of locales) {
      const source = read(`agents/_skills/mentor-patterns/SKILL${locale}.md`);
      const crossReference = source
        .split("\n")
        .find((line) => line.startsWith("- `feedback-query`"));
      expect(crossReference).toBeDefined();
      expect(crossReference).not.toMatch(
        /one position at a time|una posizione alla volta|una posición a la vez|position par position|Position für Position|uma posição de cada vez|pozíciónként/,
      );
    }
  });

  it("does not advertise a feedback verdict as discard in swipe metadata", () => {
    const metadata = read("web/app/(protected)/swipe/layout.tsx");
    expect(metadata.match(/^    description:/gm)).toHaveLength(7);
    expect(metadata).not.toMatch(
      /sinistra per scartare|left to discard|balra, ha nem|izquierda para descartar|links zum Aussortieren|gauche pour écarter|esquerda para descartar/,
    );
  });
});
