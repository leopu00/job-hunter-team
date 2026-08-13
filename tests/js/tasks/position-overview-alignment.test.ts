import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OverviewFactRow,
  OverviewFacts,
} from "../../../web/app/(protected)/positions/[id]/OverviewFacts";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const { createElement } = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server");
const page = readFileSync(
  join(repo, "web/app/(protected)/positions/[id]/page.tsx"),
  "utf8",
);

const FACTS = [
  ["salary", "Estimated salary", "EUR 42,000 – 58,000"],
  ["work-mode", "Work mode", "Hybrid"],
  ["category", "Category", "Software Engineering"],
  ["source", "Source", "Example source"],
  ["found", "Found", "2026-08-13"],
] as const;

describe("allineamento fatti nella Panoramica posizione", () => {
  it("mappa ogni header alla propria cella nel render SSR", () => {
    const html = renderToStaticMarkup(
      createElement(
        OverviewFacts,
        null,
        ...FACTS.map(([factId, label, value]) =>
          createElement(OverviewFactRow, { key: factId, factId, label }, value),
        ),
      ),
    );

    expect(html.match(/data-overview-fact-row=/g)).toHaveLength(FACTS.length);
    expect(html.match(/data-overview-fact-label=/g)).toHaveLength(FACTS.length);
    expect(html.match(/data-overview-fact-cell=/g)).toHaveLength(FACTS.length);

    let previous = -1;
    for (const [factId, label, value] of FACTS) {
      const rowAt = html.indexOf(`data-overview-fact-row="${factId}"`);
      expect(rowAt).toBeGreaterThan(previous);
      previous = rowAt;
      expect(html).toContain(`data-overview-fact-label="${factId}"`);
      expect(html).toContain(`id="overview-fact-${factId}-label"`);
      expect(html).toContain(`data-overview-fact-cell="${factId}"`);
      expect(html).toContain(`aria-labelledby="overview-fact-${factId}-label"`);
      expect(html).toContain(label);
      expect(html).toContain(value);
    }
  });

  it("mantiene cinque righe condizionali senza celle orfane", () => {
    const ids = [...page.matchAll(/<OverviewFactRow\s+factId="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(ids).toEqual(FACTS.map(([factId]) => factId));
    expect(page).not.toContain("<OverviewRow");
  });

  it("riserva spazio al valore e non lo spezza una lettera per riga", () => {
    const html = renderToStaticMarkup(
      createElement(
        OverviewFacts,
        null,
        createElement(
          OverviewFactRow,
          { factId: "salary", label: "Estimated salary" },
          "EUR 42,000 – 58,000",
        ),
      ),
    );

    expect(html).toContain("grid-cols-[minmax(0,1fr)_minmax(7rem,auto)]");
    expect(html).toContain("break-normal");
    expect(html).not.toContain("break-words");
  });
});
