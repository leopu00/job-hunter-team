import { describe, expect, it } from "vitest";
import {
  APPLICATION_TIMELINE_MAX_DAYS,
  buildApplicationTimeline,
  timelineOutcome,
} from "@/lib/application-timeline";

const TODAY = new Date("2026-08-24T12:00:00.000Z");

describe("buildApplicationTimeline", () => {
  it("non crea il grafico senza candidature valide", () => {
    expect(buildApplicationTimeline([], TODAY)).toBeNull();
    expect(
      buildApplicationTimeline(
        [
          { appliedAt: "non-una-data", response: null, responseAt: null },
          {
            appliedAt: "2026-08-25T09:00:00Z",
            response: null,
            responseAt: null,
          },
        ],
        TODAY,
      ),
    ).toBeNull();
  });

  it("parte dal primo giorno di invio e conserva i giorni vuoti", () => {
    const timeline = buildApplicationTimeline(
      [
        "2026-08-21T08:00:00Z",
        "2026-08-21T17:00:00Z",
        "2026-08-23T12:00:00Z",
      ].map((appliedAt) => ({ appliedAt, response: null, responseAt: null })),
      TODAY,
    );

    expect(timeline).toMatchObject({
      rangeStart: "2026-08-21",
      rangeEnd: "2026-08-24",
      rangeDays: 4,
      visibleSubmitted: 3,
      allTimeSubmitted: 3,
      isCapped: false,
    });
    expect(timeline?.points).toEqual([
      { date: "2026-08-21", count: 2, submitted: 2, accepted: 0, rejected: 0 },
      { date: "2026-08-22", count: 0, submitted: 0, accepted: 0, rejected: 0 },
      { date: "2026-08-23", count: 1, submitted: 1, accepted: 0, rejected: 0 },
      { date: "2026-08-24", count: 0, submitted: 0, accepted: 0, rejected: 0 },
    ]);
  });

  it("usa un solo punto quando il primo invio è oggi", () => {
    const timeline = buildApplicationTimeline(
      [
        {
          appliedAt: "2026-08-24T07:00:00+02:00",
          response: null,
          responseAt: null,
        },
      ],
      TODAY,
    );

    expect(timeline?.rangeDays).toBe(1);
    expect(timeline?.points).toEqual([
      { date: "2026-08-24", count: 1, submitted: 1, accepted: 0, rejected: 0 },
    ]);
  });

  it("limita la finestra agli ultimi 30 giorni senza perdere il totale storico", () => {
    const timeline = buildApplicationTimeline(
      [
        "2026-06-01T10:00:00Z",
        "2026-07-25T10:00:00Z",
        "2026-07-26T10:00:00Z",
        "2026-08-24T10:00:00Z",
      ].map((appliedAt) => ({ appliedAt, response: null, responseAt: null })),
      TODAY,
    );

    expect(timeline).toMatchObject({
      rangeStart: "2026-07-26",
      rangeEnd: "2026-08-24",
      rangeDays: APPLICATION_TIMELINE_MAX_DAYS,
      visibleSubmitted: 2,
      allTimeSubmitted: 4,
      isCapped: true,
    });
    expect(timeline?.points[0]).toEqual({
      date: "2026-07-26",
      count: 1,
      submitted: 1,
      accepted: 0,
      rejected: 0,
    });
    expect(timeline?.points.at(-1)).toEqual({
      date: "2026-08-24",
      count: 1,
      submitted: 1,
      accepted: 0,
      rejected: 0,
    });
  });

  it("rifiuta date di calendario impossibili", () => {
    const timeline = buildApplicationTimeline(
      ["2026-02-30T10:00:00Z", "2026-08-20 12:30:00"].map((appliedAt) => ({
        appliedAt,
        response: null,
        responseAt: null,
      })),
      TODAY,
    );

    expect(timeline?.rangeStart).toBe("2026-08-20");
    expect(timeline?.allTimeSubmitted).toBe(1);
  });

  it("mappa soltanto i due esiti canonici osservabili", () => {
    expect(timelineOutcome("interview")).toBe("accepted");
    expect(timelineOutcome("rejected")).toBe("rejected");
    expect(timelineOutcome("ghosted")).toBeNull();
    expect(timelineOutcome("accepted")).toBeNull();
    expect(timelineOutcome(null)).toBeNull();
  });

  it("aggrega gli esiti nel giorno della risposta, non dell'invio", () => {
    const timeline = buildApplicationTimeline(
      [
        {
          appliedAt: "2026-08-20T08:00:00Z",
          response: "interview",
          responseAt: "2026-08-22T11:00:00Z",
        },
        {
          appliedAt: "2026-08-20T09:00:00Z",
          response: "rejected",
          responseAt: "2026-08-22T14:00:00Z",
        },
        {
          appliedAt: "2026-08-21T09:00:00Z",
          response: "rejected",
          responseAt: "2026-08-23T14:00:00Z",
        },
      ],
      TODAY,
    );

    expect(timeline).toMatchObject({
      visibleSubmitted: 3,
      visibleAccepted: 1,
      visibleRejected: 2,
      allTimeAccepted: 1,
      allTimeRejected: 2,
    });
    expect(timeline?.points[2]).toEqual({
      date: "2026-08-22",
      count: 0,
      submitted: 0,
      accepted: 1,
      rejected: 1,
    });
  });

  it("ignora esiti futuri, malformati o anteriori all'invio", () => {
    const timeline = buildApplicationTimeline(
      [
        {
          appliedAt: "2026-08-20T08:00:00Z",
          response: "interview",
          responseAt: "2026-08-19T11:00:00Z",
        },
        {
          appliedAt: "2026-08-21T09:00:00Z",
          response: "rejected",
          responseAt: "2026-08-25T14:00:00Z",
        },
        {
          appliedAt: "2026-08-22T09:00:00Z",
          response: "rejected",
          responseAt: "nope",
        },
      ],
      TODAY,
    );

    expect(timeline?.visibleSubmitted).toBe(3);
    expect(timeline?.visibleAccepted).toBe(0);
    expect(timeline?.visibleRejected).toBe(0);
  });
});
