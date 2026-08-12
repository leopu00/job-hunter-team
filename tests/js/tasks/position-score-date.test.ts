import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPositionEventStamp } from "../../../web/lib/position-event-stamp";
import { T } from "../../../web/app/(protected)/positions/[id]/page.i18n";

const repo = join(__dirname, "../../..");
const page = readFileSync(
  join(repo, "web/app/(protected)/positions/[id]/page.tsx"),
  "utf8",
);
describe("data della valutazione nella pagina posizione", () => {
  it("formatta la data gia' scritta dallo Scorer senza sostituirla con altre date", () => {
    const scoredAt = "2026-08-12T13:24:00.000Z";

    expect(formatPositionEventStamp(scoredAt, "it")).toBe("12/08, 15:24");
    expect(formatPositionEventStamp("", "it")).toBeNull();
    expect(formatPositionEventStamp("non-una-data", "it")).toBeNull();
  });

  it("lega semanticamente il testo visibile e time alla colonna scores.scored_at", () => {
    expect(page).toContain(
      "formatPositionEventStamp(score?.scored_at, locale)",
    );
    expect(page).toContain("<time dateTime={score.scored_at}>");
    expect(page).toContain('t("score_assessed_at")');
    expect(page).not.toMatch(
      /scoreAssessedAt\s*=\s*formatPositionEventStamp\(position\.(?:updated_at|found_at)/,
    );

    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      expect(T.score_assessed_at[locale as keyof typeof T.score_assessed_at])
        .toBeTypeOf("string")
        .not.toHaveLength(0);
    }
  });
});
