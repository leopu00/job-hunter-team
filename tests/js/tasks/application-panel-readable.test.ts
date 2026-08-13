import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const DETAIL = readFileSync(
  join(ROOT, "web/app/(protected)/positions/[id]/page.tsx"),
  "utf8",
);
const LIST = readFileSync(
  join(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf8",
);

describe("pannello candidatura leggibile", () => {
  it("tiene etichetta e valore vicini nella stessa cella", () => {
    const infoRow = DETAIL.match(
      /function InfoRow[\s\S]*?\r?\n  \);\r?\n}/,
    )?.[0];

    expect(infoRow, "helper InfoRow non trovato").toBeTruthy();
    expect(infoRow).toContain("gap-2");
    expect(infoRow).not.toContain("justify-between");
  });

  it("lista e pannello usano lo stesso formatter del timbro evento", () => {
    const canonicalImport =
      'import { formatPositionEventStamp } from "@/lib/position-event-stamp";';

    expect(LIST).toContain(canonicalImport);
    expect(DETAIL).toContain(canonicalImport);
    expect(DETAIL).toContain(
      "formatPositionEventStamp(application.applied_at, locale)",
    );
    expect(DETAIL).not.toContain("application.applied_at.slice(0, 10)");
  });
});
