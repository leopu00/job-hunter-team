import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { T } from "@/lib/dashboard-i18n";

const COMPONENT = readFileSync(
  resolve(__dirname, "../../../web/app/components/ApplicationTimeline.tsx"),
  "utf8",
);

describe("tooltip e accessibilità della timeline candidature", () => {
  it("offre lo stesso dettaglio a mouse, tastiera e touch", () => {
    expect(COMPONENT.startsWith('"use client"')).toBe(true);
    expect(COMPONENT).toContain('role="tooltip"');
    expect(COMPONENT).toContain("aria-describedby=");
    expect(COMPONENT).toContain("tabIndex={0}");
    expect(COMPONENT).toContain("onFocus=");
    expect(COMPONENT).toContain("onPointerEnter=");
    expect(COMPONENT).toContain("onPointerDown=");
    expect(COMPONENT).toContain('event.key === "Escape"');
    expect(COMPONENT).toContain('aria-live="polite"');
  });

  it("il tooltip contiene il breakdown grafico delle tre serie", () => {
    expect(COMPONENT).toContain("activePoint.submitted");
    expect(COMPONENT).toContain("activePoint.accepted");
    expect(COMPONENT).toContain("-activePoint.rejected");
    expect(COMPONENT).toContain("Math.abs(series.value) / dailyMax");
  });

  it("nomina invii, colloqui accettati e rifiuti in tutte le lingue", () => {
    for (const translation of Object.values(T)) {
      expect(translation.application_timeline_submitted).toBeTruthy();
      expect(translation.application_timeline_accepted).toBeTruthy();
      expect(translation.application_timeline_rejected).toBeTruthy();
    }
  });
});
