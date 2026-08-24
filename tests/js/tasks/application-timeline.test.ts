import { describe, expect, it } from "vitest";
import {
  APPLICATION_TIMELINE_MAX_DAYS,
  buildApplicationTimeline,
} from "@/lib/application-timeline";

const TODAY = new Date("2026-08-24T12:00:00.000Z");

describe("buildApplicationTimeline", () => {
  it("non crea il grafico senza candidature valide", () => {
    expect(buildApplicationTimeline([], TODAY)).toBeNull();
    expect(
      buildApplicationTimeline(["non-una-data", "2026-08-25T09:00:00Z"], TODAY),
    ).toBeNull();
  });

  it("parte dal primo giorno di invio e conserva i giorni vuoti", () => {
    const timeline = buildApplicationTimeline(
      [
        "2026-08-21T08:00:00Z",
        "2026-08-21T17:00:00Z",
        "2026-08-23T12:00:00Z",
      ],
      TODAY,
    );

    expect(timeline).toMatchObject({
      rangeStart: "2026-08-21",
      rangeEnd: "2026-08-24",
      rangeDays: 4,
      visibleTotal: 3,
      allTimeTotal: 3,
      isCapped: false,
    });
    expect(timeline?.points).toEqual([
      { date: "2026-08-21", count: 2 },
      { date: "2026-08-22", count: 0 },
      { date: "2026-08-23", count: 1 },
      { date: "2026-08-24", count: 0 },
    ]);
  });

  it("usa un solo punto quando il primo invio è oggi", () => {
    const timeline = buildApplicationTimeline(
      ["2026-08-24T07:00:00+02:00"],
      TODAY,
    );

    expect(timeline?.rangeDays).toBe(1);
    expect(timeline?.points).toEqual([{ date: "2026-08-24", count: 1 }]);
  });

  it("limita la finestra agli ultimi 30 giorni senza perdere il totale storico", () => {
    const timeline = buildApplicationTimeline(
      [
        "2026-06-01T10:00:00Z",
        "2026-07-25T10:00:00Z",
        "2026-07-26T10:00:00Z",
        "2026-08-24T10:00:00Z",
      ],
      TODAY,
    );

    expect(timeline).toMatchObject({
      rangeStart: "2026-07-26",
      rangeEnd: "2026-08-24",
      rangeDays: APPLICATION_TIMELINE_MAX_DAYS,
      visibleTotal: 2,
      allTimeTotal: 4,
      isCapped: true,
    });
    expect(timeline?.points[0]).toEqual({ date: "2026-07-26", count: 1 });
    expect(timeline?.points.at(-1)).toEqual({
      date: "2026-08-24",
      count: 1,
    });
  });

  it("rifiuta date di calendario impossibili", () => {
    const timeline = buildApplicationTimeline(
      ["2026-02-30T10:00:00Z", "2026-08-20 12:30:00"],
      TODAY,
    );

    expect(timeline?.rangeStart).toBe("2026-08-20");
    expect(timeline?.allTimeTotal).toBe(1);
  });
});
