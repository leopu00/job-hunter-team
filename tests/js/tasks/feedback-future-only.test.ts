import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  VERDICT_ORDER,
  VERDICT_SIGNAL,
  needsReason,
} from "@/lib/position-verdict";
import {
  FACTUAL_REASONS,
  REASON_ORDER,
  negativeSignalFor,
} from "@/app/(protected)/positions/[id]/exclusion-reasons";

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (relative: string) =>
  readFileSync(resolve(ROOT, relative), "utf8");

const FEEDBACK_SURFACES = [
  "web/app/(protected)/positions/[id]/FeedbackButtons.tsx",
  "web/app/(protected)/swipe/SwipeDeck.tsx",
];

describe("exclusion and feedback boundary", () => {
  it("keeps the preference signal explicit for the exclusion action", () => {
    expect(VERDICT_SIGNAL.no).toEqual({
      action: "dislike",
      score: 1,
      direction: "less_like_this",
    });
    for (const signal of Object.values(VERDICT_SIGNAL)) {
      expect(signal).not.toHaveProperty("exclude");
    }
  });

  // Il punto di chiamata dell'esclusione deve restare unico, successivo alla
  // validazione del motivo e alimentato dal segnale validato.
  it.each(FEEDBACK_SURFACES)(
    "%s reaches the exclusion writer from one guarded call site",
    (path) => {
      const source = read(path);
      expect(source).toContain("/feedback");
      expect(source.match(/\/user-exclude/g) ?? []).toHaveLength(1);
      const rule = source.indexOf("negativeSignalFor(");
      const guard = source.indexOf('signal.kind === "invalid"');
      const call = source.indexOf("/user-exclude");
      expect(rule, "la regola pura non viene nemmeno chiamata").toBeGreaterThan(
        -1,
      );
      expect(
        guard,
        "l'esclusione non è dietro la validazione del segnale",
      ).toBeGreaterThan(rule);
      expect(call, "si scrive prima di aver deciso").toBeGreaterThan(guard);
      // Il motivo spedito è quello che la regola ha validato: prenderlo da
      // un'altra parte rimetterebbe in giro un codice che nessuno ha
      // controllato.
      expect(source.slice(call, call + 400)).toContain("signal.reason");
    },
  );

  it.each(FEEDBACK_SURFACES)(
    "%s confirms excluded before updating feedback or UI state",
    (path) => {
      const source = read(path);
      const call = source.indexOf("/user-exclude");
      const flow = source.slice(call, call + 2_500);
      const acknowledgement = flow.indexOf('!== "excluded"');
      const optionalFeedback = flow.indexOf("signal.feedback");
      expect(acknowledgement).toBeGreaterThan(-1);
      expect(optionalFeedback).toBeGreaterThan(acknowledgement);
      if (path.includes("SwipeDeck")) {
        expect(flow.indexOf("setExcluded")).toBeGreaterThan(acknowledgement);
      } else {
        expect(flow.indexOf("router.refresh")).toBeGreaterThan(acknowledgement);
      }
    },
  );

  it("routes every negative reason through exclusion", () => {
    for (const path of FEEDBACK_SURFACES) {
      expect(read(path)).toContain("negativeSignalFor");
    }
    for (const reason of REASON_ORDER) {
      const signal = negativeSignalFor(reason, "un testo qualsiasi");
      expect(signal.kind, reason).toBe("exclude");
      if (signal.kind === "exclude") {
        expect(Boolean(signal.feedback), reason).toBe(
          !FACTUAL_REASONS.includes(reason),
        );
      }
    }
    // E il gesto che ci arriva è sempre e solo quello che ha chiesto il
    // perché: gli altri tre verdetti non hanno un motivo da valutare.
    expect(VERDICT_ORDER.filter(needsReason)).toEqual(["no"]);
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
