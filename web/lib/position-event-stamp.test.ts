import { describe, expect, it } from "vitest";
import { formatPositionEventStamp } from "./position-event-stamp";

describe("formatPositionEventStamp", () => {
  it("mostra insieme data e ora esatta", () => {
    const stamp = formatPositionEventStamp("2026-08-12T10:34:00+00:00", "it");
    const local = new Date("2026-08-12T10:34:00Z");
    const p = (n: number) => String(n).padStart(2, "0");

    expect(stamp).toContain(`${p(local.getDate())}/${p(local.getMonth() + 1)}`);
    expect(stamp).toContain(`${p(local.getHours())}:${p(local.getMinutes())}`);
  });

  it("legge un timbro senza fuso come UTC e lo scrive nell'ora locale della persona", () => {
    // SQLite scrive «YYYY-MM-DD HH:MM:SS» in UTC: la stessa riga, con o senza «Z», dice la stessa ora
    expect(formatPositionEventStamp("2026-08-12 10:34:00", "it")).toBe(formatPositionEventStamp("2026-08-12T10:34:00Z", "it"));
    expect(formatPositionEventStamp("2026-08-12T10:34:00", "en")).toBe(formatPositionEventStamp("2026-08-12T10:34:00Z", "en"));
  });

  it("non inventa un timbro per valori assenti o invalidi", () => {
    expect(formatPositionEventStamp(null, "it")).toBeNull();
    expect(formatPositionEventStamp("not-a-date", "it")).toBeNull();
  });
});
