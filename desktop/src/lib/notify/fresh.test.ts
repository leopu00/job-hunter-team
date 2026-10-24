import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { BACKLOG_MS, cleanText, createFreshFilter, notificationsFor, SEEN_MAX, TEXT_MAX, type FoundPosition } from "./fresh";
import { NOTIFY_TEXT } from "./notify.i18n";

const START = Date.parse("2026-10-19T12:00:00Z");
const at = (msFromStart: number) => new Date(START + msFromStart).toISOString();
const row = (id: string, foundAt: string | null = at(60_000), title = "Data engineer", company = "Example Co"): FoundPosition => ({ id, title, company, foundAt });

describe("createFreshFilter", () => {
  it("a list read again and again: the first read is silent, then only the positions not seen before", () => {
    const f = createFreshFilter({ startedAt: START, silentFirst: true });
    expect(f.take([row("1"), row("2"), row("3")])).toEqual([]);
    expect(f.take([row("1"), row("2"), row("3")])).toEqual([]);
    expect(f.take([row("4"), row("1"), row("2")]).map((r) => r.id)).toEqual(["4"]);
    expect(f.take([row("4")])).toEqual([]);
  });

  it("rows that come back late (an old found_at, a sync catching up) never make a storm", () => {
    const f = createFreshFilter({ startedAt: START, silentFirst: false });
    const backlog = Array.from({ length: 500 }, (_, i) => row(`old-${i}`, at(-BACKLOG_MS - 60_000 - i * 1000)));
    expect(f.take(backlog)).toEqual([]);
    // no time it was found: not said to be new
    expect(f.take([row("x", null)])).toEqual([]);
    // just inside the edge, and after the start: new
    expect(f.take([row("edge", at(-BACKLOG_MS + 1000)), row("now", at(5000))]).map((r) => r.id)).toEqual(["edge", "now"]);
  });

  it("remembers a bounded number of ids", () => {
    const f = createFreshFilter({ startedAt: START, silentFirst: false });
    f.take(Array.from({ length: SEEN_MAX + 10 }, (_, i) => row(`p${i}`)));
    // the oldest ids were forgotten, the newest are still known
    expect(f.take([row(`p${SEEN_MAX + 9}`)])).toEqual([]);
    expect(f.take([row("p0")]).map((r) => r.id)).toEqual(["p0"]);
  });
});

describe("notificationsFor", () => {
  const on = { enabled: true, details: true };
  it("off: nothing at all", () => {
    expect(notificationsFor([row("1")], { enabled: false, details: true }, "en")).toEqual([]);
  });

  it("without details: «New position found», never the title or the company", () => {
    const n = notificationsFor([row("1")], { enabled: true, details: false }, "en");
    expect(n).toEqual([{ title: "Job Hunter Team", body: "New position found" }]);
    expect(JSON.stringify(notificationsFor([row("1"), row("2")], { enabled: true, details: false }, "it"))).not.toMatch(/Data engineer|Example/);
    expect(notificationsFor([row("1"), row("2")], { enabled: true, details: false }, "it")[0]!.body).toBe("2 nuove posizioni trovate");
  });

  it("with details: the title and the company of each, up to three; more at once: how many, no names", () => {
    expect(notificationsFor([row("1"), row("2", undefined, "ML engineer", "Acme")], on, "en")).toEqual([
      { title: "Data engineer", body: "Example Co" },
      { title: "ML engineer", body: "Acme" },
    ]);
    const many = notificationsFor([row("1"), row("2"), row("3"), row("4")], on, "en");
    expect(many).toEqual([{ title: "Job Hunter Team", body: "4 new positions found" }]);
  });

  it("every sentence exists in every language, with no slot left", () => {
    for (const locale of locales) {
      const t = NOTIFY_TEXT[locale];
      for (const s of [t.appName, t.newOne, t.lockScreen, t.withDetails, t.switchTitle, t.switchLabel, t.newMany.one, t.newMany.other]) expect(s.length, locale).toBeGreaterThan(3);
      expect(notificationsFor([row("1"), row("2")], { enabled: true, details: false }, locale)[0]!.body, locale).not.toMatch(/\{/);
    }
  });
});

describe("cleanText", () => {
  it("drops controls and bidi marks, keeps a word's zero-width non-joiner, and cuts the length", () => {
    expect(cleanText("Dev‮oc elpmaxE‬\nOps")).toBe("Dev oc elpmaxE Ops");
    expect(cleanText("\u0000\u0007Acme⁦ SA⁩")).toBe("Acme SA");
    expect(cleanText("می‌خواهم")).toBe("می‌خواهم");
    const long = cleanText("x".repeat(200));
    expect(long.length).toBe(TEXT_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(cleanText(null)).toBe("");
  });
});
