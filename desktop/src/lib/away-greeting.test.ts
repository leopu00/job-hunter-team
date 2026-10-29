import { beforeEach, describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import type { DashboardStats } from "../../../web/lib/types";
import { AWAY_GREETING_TEXT } from "./away-greeting.i18n";
import { AWAY_MINUTES, awayCounts, awaySentence, awaySince, loadSnapshot, saveSnapshot, worthSaving, type AwaySnapshot } from "./away-greeting";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

function stats(over: Partial<DashboardStats>): DashboardStats {
  return { total: 0, new: 0, checked: 0, scored: 0, writing: 0, review: 0, ready: 0, applied: 0, excluded: 0, response: 0, scored_open: 0, to_write: 0, ...over };
}
const snapshot = (minutesAgo: number, counts = { total: 10, evaluated: 4, documents: 1 }): AwaySnapshot => ({ at: NOW - minutesAgo * MIN, counts });

beforeEach(() => localStorage.clear());

describe("the numbers of the greeting", () => {
  it("counts every position, the ones past the evaluation and the ones with a CV written", () => {
    expect(awayCounts(stats({ total: 30, new: 5, checked: 4, scored: 6, writing: 2, review: 1, ready: 3, applied: 4, response: 1, excluded: 4 }))).toEqual({
      total: 30,
      evaluated: 6 + 2 + 1 + 3 + 4 + 1,
      documents: 3 + 4 + 1,
    });
  });

  it("takes a number that is missing, negative or not a number as zero", () => {
    expect(awayCounts({ total: Number.NaN, scored: -3, ready: undefined } as unknown as DashboardStats)).toEqual({ total: 0, evaluated: 0, documents: 0 });
  });
});

describe("when it is said", () => {
  const now = { total: 15, evaluated: 7, documents: 2 };

  it("says what went up since the last time, after half an hour", () => {
    expect(awaySince(snapshot(120), now, NOW)).toEqual({ positions: 5, evaluated: 3, documents: 1 });
    expect(awaySince(snapshot(AWAY_MINUTES), now, NOW)).not.toBeNull();
  });

  it("says nothing the first time, or when the person was away for less than half an hour", () => {
    expect(awaySince(null, now, NOW)).toBeNull();
    expect(awaySince(snapshot(AWAY_MINUTES - 1), now, NOW)).toBeNull();
    expect(awaySince(snapshot(15), now, NOW)).toBeNull();
    expect(AWAY_MINUTES).toBe(30);
  });

  it("says nothing when nothing went up, and counts only what did", () => {
    expect(awaySince(snapshot(120), { total: 10, evaluated: 4, documents: 1 }, NOW)).toBeNull();
    expect(awaySince(snapshot(120), { total: 8, evaluated: 2, documents: 0 }, NOW)).toBeNull();
    expect(awaySince(snapshot(120), { total: 12, evaluated: 3, documents: 1 }, NOW)).toEqual({ positions: 2, evaluated: 0, documents: 0 });
  });

  it("does not believe a reading from the future or a team that reads as empty after a full one", () => {
    expect(awaySince({ at: NOW + 5 * MIN, counts: { total: 1, evaluated: 0, documents: 0 } }, now, NOW)).toBeNull();
    expect(awaySince(snapshot(120), { total: 0, evaluated: 0, documents: 0 }, NOW)).toBeNull();
    expect(worthSaving(snapshot(120), { total: 0, evaluated: 0, documents: 0 })).toBe(false);
    expect(worthSaving(null, { total: 0, evaluated: 0, documents: 0 })).toBe(true);
    expect(worthSaving(snapshot(120), { total: 3, evaluated: 0, documents: 0 })).toBe(true);
  });
});

describe("what is kept", () => {
  it("keeps one reading per key and gives back exactly it", () => {
    const one = snapshot(0, { total: 3, evaluated: 2, documents: 1 });
    saveSnapshot("google:a|cloud", one);
    expect(loadSnapshot("google:a|cloud")).toEqual(one);
    expect(loadSnapshot("google:b|cloud")).toBeNull();
    expect(loadSnapshot("google:a|team:x")).toBeNull();
  });

  it("does not believe what is not a reading", () => {
    for (const odd of ["", "null", "[]", "{", '{"at":"now","counts":{}}', '{"at":1,"counts":{"total":-1,"evaluated":0,"documents":0}}', '{"at":1,"counts":{"total":1}}']) {
      localStorage.setItem("jht-away:k", odd);
      expect(loadSnapshot("k"), odd).toBeNull();
    }
  });

  it("survives a storage that refuses", () => {
    const set = Storage.prototype.setItem;
    const get = Storage.prototype.getItem;
    Storage.prototype.setItem = () => { throw new Error("full"); };
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try {
      expect(() => saveSnapshot("k", snapshot(0))).not.toThrow();
      expect(loadSnapshot("k")).toBeNull();
    } finally {
      Storage.prototype.setItem = set;
      Storage.prototype.getItem = get;
    }
  });
});

describe("the sentence, in the seven languages", () => {
  it("says only what went up, with the singular or the plural, and ends with a full stop", () => {
    for (const locale of locales) {
      const text = AWAY_GREETING_TEXT[locale];
      const many = awaySentence(locale, { positions: 5, evaluated: 3, documents: 2 });
      expect(many.startsWith(text.intro), locale).toBe(true);
      expect(many.endsWith("."), locale).toBe(true);
      for (const n of ["5", "3", "2"]) expect(many, `${locale} ${n}`).toContain(n);
      const one = awaySentence(locale, { positions: 1, evaluated: 0, documents: 0 });
      expect(one, locale).toContain(text.positions.one.replace("{count}", "1"));
      expect(one, locale).not.toContain("0");
      const only = awaySentence(locale, { positions: 0, evaluated: 0, documents: 4 });
      expect(only, locale).toContain(text.documents.other.replace("{count}", "4"));
      expect(only, locale).not.toContain(text.positions.other.replace("{count}", "0"));
    }
    expect(awaySentence("it", { positions: 5, evaluated: 3, documents: 1 })).toBe("Mentre eri via: 5 posizioni nuove, 3 valutate e 1 CV o lettera pronto.");
    expect(awaySentence("en", { positions: 1, evaluated: 3, documents: 0 })).toBe("While you were away: 1 new position and 3 evaluated.");
  });

  it("speaks to the person informally in French and German and keeps every slot", () => {
    for (const locale of locales) {
      const text = AWAY_GREETING_TEXT[locale];
      for (const value of [text.intro, text.seePositions, text.seeDashboard, text.close, ...Object.values(text.positions), ...Object.values(text.evaluated), ...Object.values(text.documents)]) {
        expect(value.trim().length, `${locale} ${value}`).toBeGreaterThan(1);
        expect(value, `${locale} ${value}`).not.toMatch(/\b(vous|votre|Sie|Ihr\w*)\b/);
      }
      for (const forms of [text.positions, text.evaluated, text.documents]) {
        expect(forms.one, locale).toContain("{count}");
        expect(forms.other, locale).toContain("{count}");
      }
    }
  });
});
