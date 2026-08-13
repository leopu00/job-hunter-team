import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExclusionDecidedAt } from "../../../web/app/(protected)/positions/[id]/ExclusionDecidedAt";
import { OverviewScoreBadge } from "../../../web/app/(protected)/positions/[id]/OverviewScoreBadge";
import { T } from "../../../web/app/(protected)/positions/[id]/page.i18n";
import { formatPositionEventStamp } from "../../../web/lib/position-event-stamp";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const { createElement } = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server");
const page = readFileSync(
  join(repo, "web/app/(protected)/positions/[id]/page.tsx"),
  "utf8",
);

describe("data della decisione nel motivo di esclusione", () => {
  it("mostra data e ora di user_excluded_at nel riquadro quando esistono", () => {
    const excludedAt = "2026-08-13T09:42:00.000";
    const formatted = formatPositionEventStamp(excludedAt, "it");
    const html = renderToStaticMarkup(
      createElement(ExclusionDecidedAt, {
        label: T.exclusion_decided_at.it,
        excludedAt,
        formatted,
      }),
    );

    expect(html).toContain('data-exclusion-decided-at=""');
    expect(html).toContain(`dateTime="${excludedAt}"`);
    expect(html).toContain("Decisione presa il");
    expect(html).toContain("13/08, 09:42");
  });

  it("non inventa una data quando user_excluded_at manca o non e' valido", () => {
    for (const excludedAt of [null, "non-una-data"]) {
      const html = renderToStaticMarkup(
        createElement(ExclusionDecidedAt, {
          label: T.exclusion_decided_at.it,
          excludedAt,
          formatted: formatPositionEventStamp(excludedAt, "it"),
        }),
      );
      expect(html).toBe("");
    }
  });

  it("lega il riquadro solo al timestamp atomico dell'esclusione", () => {
    expect(page).toMatch(
      /const exclusionDecidedAt = formatPositionEventStamp\(\s*position\.user_excluded_at,\s*locale,\s*\);/,
    );
    expect(page).toContain("<ExclusionDecidedAt");
    expect(page).toContain("excludedAt={position.user_excluded_at}");
    expect(page).toContain("formatted={exclusionDecidedAt}");
    expect(page).not.toMatch(
      /exclusionDecidedAt\s*=\s*formatPositionEventStamp\(position\.(?:updated_at|found_at|last_checked)/,
    );
  });

  it("ha una label completa in EN+6", () => {
    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      expect(
        T.exclusion_decided_at[locale as keyof typeof T.exclusion_decided_at],
      )
        .toBeTypeOf("string")
        .not.toHaveLength(0);
    }
  });

  it("non sposta la data dello score nella Panoramica", () => {
    const overviewScore = renderToStaticMarkup(
      createElement(OverviewScoreBadge, { score: 71 }),
    );

    expect(overviewScore).toContain('data-overview-score=""');
    expect(overviewScore).not.toContain("<time");
    expect(overviewScore).not.toContain(T.score_assessed_at.it);
    expect(page).toContain("<OverviewScoreBadge score={score.total_score} />");
    expect(page).toContain("<ScoreAssessedAt");
    expect(page).toContain("scoredAt={score.scored_at}");
  });
});
