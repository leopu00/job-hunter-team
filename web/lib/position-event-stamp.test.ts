import { describe, expect, it } from "vitest";
import { formatPositionEventStamp } from "./position-event-stamp";

describe("formatPositionEventStamp", () => {
  it("mostra insieme data e ora esatta", () => {
    const stamp = formatPositionEventStamp("2026-08-12T10:34:00", "it");

    expect(stamp).toMatch(/12\/08/);
    expect(stamp).toContain("10:34");
  });

  it("non inventa un timbro per valori assenti o invalidi", () => {
    expect(formatPositionEventStamp(null, "it")).toBeNull();
    expect(formatPositionEventStamp("not-a-date", "it")).toBeNull();
  });
});
