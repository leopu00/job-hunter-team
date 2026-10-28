import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { PROVIDER_WINDOW_TEXT } from "./provider-window.i18n";
import { WINDOW_STALE_SECONDS, localTime, windowNotice, windowNoticeText } from "./provider-window";
import type { ProviderWindowResult } from "./provider-window-native";

const NOW = 1_793_300_000_000; // ms
const sample = (over: Partial<{ usedPct: number | null; resetAtUnix: number | null; updatedAtUnix: number }> = {}): ProviderWindowResult => ({
  ok: true,
  window: { provider: "codex", usedPct: 50, resetAtUnix: NOW / 1000 + 3600, updatedAtUnix: NOW / 1000 - 60, ...over },
});

describe("windowNotice", () => {
  it("says nothing below 90%", () => {
    expect(windowNotice(sample({ usedPct: 0 }), NOW)).toBeNull();
    expect(windowNotice(sample({ usedPct: 89.9 }), NOW)).toBeNull();
  });
  it("warns from 90% up to the last half point, with the percent rounded down and never 100", () => {
    expect(windowNotice(sample({ usedPct: 90 }), NOW)).toEqual({ kind: "near", pct: 90 });
    expect(windowNotice(sample({ usedPct: 93.9 }), NOW)).toEqual({ kind: "near", pct: 93 });
    expect(windowNotice(sample({ usedPct: 99.4 }), NOW)).toEqual({ kind: "near", pct: 99 });
  });
  it("says the window is used up from 99.5%, with the instant it renews", () => {
    const reset = NOW / 1000 + 3600;
    expect(windowNotice(sample({ usedPct: 99.5 }), NOW)).toEqual({ kind: "done", resetAtUnix: reset });
    expect(windowNotice(sample({ usedPct: 100 }), NOW)).toEqual({ kind: "done", resetAtUnix: reset });
    expect(windowNotice(sample({ usedPct: 100, resetAtUnix: null }), NOW)).toEqual({ kind: "done", resetAtUnix: null });
  });
  it("says nothing once the renewal time has passed: the reading is out of date", () => {
    expect(windowNotice(sample({ usedPct: 100, resetAtUnix: NOW / 1000 - 1 }), NOW)).toBeNull();
  });
  it("says nothing on an old reading, without a percent, or when the team has no record", () => {
    expect(windowNotice(sample({ usedPct: 100, updatedAtUnix: NOW / 1000 - WINDOW_STALE_SECONDS - 1 }), NOW)).toBeNull();
    expect(windowNotice(sample({ usedPct: 100, updatedAtUnix: NOW / 1000 - WINDOW_STALE_SECONDS }), NOW)).not.toBeNull();
    expect(windowNotice(sample({ usedPct: null }), NOW)).toBeNull();
    expect(windowNotice({ ok: false, error: "window_unavailable" }, NOW)).toBeNull();
  });
});

describe("the words", () => {
  it("puts the percent and the local time in, in 24-hour HH:MM", () => {
    const at = new Date(2026, 9, 29, 7, 5, 0).getTime() / 1000; // local 07:05
    expect(localTime(at, "en")).toBe("07:05");
    expect(localTime(at, "de")).toBe("07:05");
    expect(windowNoticeText({ kind: "near", pct: 93 }, "en")).toBe("Your AI subscription is about to use up its work window (93%): the team may stop soon.");
    expect(windowNoticeText({ kind: "done", resetAtUnix: at }, "en")).toBe("The AI provider has used up its work window: the team resumes at 07:05.");
    expect(windowNoticeText({ kind: "done", resetAtUnix: null }, "en")).toBe("The AI provider has used up its work window: the team resumes as soon as the window renews.");
  });
  it("has the three texts in the seven languages, with their slots", () => {
    expect(Object.keys(PROVIDER_WINDOW_TEXT).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      const text = PROVIDER_WINDOW_TEXT[locale];
      expect(text.usageNear).toContain("{pct}");
      expect(text.usageDone).toContain("{time}");
      expect(text.usageDoneNoTime).not.toContain("{");
      const rendered = windowNoticeText({ kind: "done", resetAtUnix: 1_793_300_000 }, locale);
      expect(rendered).not.toContain("{");
      expect(windowNoticeText({ kind: "near", pct: 91 }, locale)).toContain("91");
    }
  });
});
