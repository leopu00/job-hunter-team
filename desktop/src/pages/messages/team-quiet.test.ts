import { describe, expect, it } from "vitest";
import type { WorkingHours } from "../../lib/team-settings-native";
import { minutesToReset, nextOpening, quietCause, withinHours } from "./team-quiet";

const OFFICE: WorkingHours = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] };
const NIGHT: WorkingHours = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "22:00", end: "06:00" }] };
// January: Rome is one hour ahead of UTC. 10 January 2024 was a Wednesday.
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2024, 0, day, hour, minute));

describe("the working hours, as the box counts them", () => {
  it("is on the clock inside a window and off it outside, in the team's own zone", () => {
    expect(withinHours(OFFICE, at(10, 11))).toBe(true); // 12:00 in Rome
    expect(withinHours(OFFICE, at(10, 21))).toBe(false); // 22:00 in Rome
  });

  it("treats the opening minute as inside and the closing minute as outside", () => {
    expect(withinHours(OFFICE, at(10, 8, 0))).toBe(true); // 09:00 Rome
    expect(withinHours(OFFICE, at(10, 7, 59))).toBe(false); // 08:59 Rome
    expect(withinHours(OFFICE, at(10, 16, 59))).toBe(true); // 17:59 Rome
    expect(withinHours(OFFICE, at(10, 17, 0))).toBe(false); // 18:00 Rome
  });

  it("is off at the weekend", () => {
    expect(withinHours(OFFICE, at(13, 11))).toBe(false); // Saturday
  });

  it("runs a window that ends before it starts into the next morning, and belongs to the day it starts on", () => {
    expect(withinHours(NIGHT, at(9, 22))).toBe(true); // Tuesday 23:00 Rome, from Tuesday evening
    expect(withinHours(NIGHT, at(10, 2))).toBe(true); // Wednesday 03:00 Rome, tail of Tuesday's
    expect(withinHours(NIGHT, at(13, 2))).toBe(true); // Saturday 03:00 Rome, tail of Friday's
    expect(withinHours(NIGHT, at(14, 2))).toBe(false); // Sunday 03:00 Rome: Saturday has no window
    expect(withinHours(NIGHT, at(10, 12))).toBe(false);
  });

  it("does not say anything about a zone this system does not know, or a time it cannot read", () => {
    expect(withinHours({ ...OFFICE, timezone: "Nowhere/Land" }, at(10, 11))).toBeNull();
    expect(withinHours({ timezone: "Europe/Rome", windows: [{ days: ["mon"], start: "9:00", end: "18:00" }] }, at(8, 11))).toBeNull();
  });
});

describe("when the team starts again", () => {
  it("is the next opening: the same evening's tomorrow, or after the weekend", () => {
    expect(nextOpening(OFFICE, at(10, 21))).toEqual({ time: "09:00", daysAhead: 1, weekday: "thu" }); // Wednesday 22:00 Rome
    expect(nextOpening(OFFICE, at(13, 9))).toEqual({ time: "09:00", daysAhead: 2, weekday: "mon" }); // Saturday 10:00 Rome
  });

  it("is today before the opening", () => {
    expect(nextOpening(OFFICE, at(10, 6))).toEqual({ time: "09:00", daysAhead: 0, weekday: "wed" }); // 07:00 Rome
  });

  it("finds nothing without windows or with a zone it does not know", () => {
    expect(nextOpening({ timezone: "Europe/Rome", windows: [] }, at(10, 21))).toBeNull();
    expect(nextOpening({ ...OFFICE, timezone: "Nowhere/Land" }, at(10, 21))).toBeNull();
  });
});

describe("why the team is quiet", () => {
  const evening = at(10, 21);
  it("says the hours when the team is off the clock and no burst runs", () => {
    expect(quietCause({ hours: OFFICE }, evening)).toEqual({ kind: "outside_hours", opens: { time: "09:00", daysAhead: 1, weekday: "thu" } });
    expect(quietCause({ hours: OFFICE, burstActive: true }, evening)).toBeNull();
    expect(quietCause({ hours: OFFICE }, at(10, 11))).toBeNull();
  });

  it("gives no reason to a team that works around the clock, or one the hours cannot be read for", () => {
    expect(quietCause({ hours: null }, evening)).toBeNull();
    expect(quietCause({ hours: { ...OFFICE, timezone: "Nowhere/Land" } }, evening)).toBeNull();
  });

  it("says the window of the provider when it is used up or nearly, with the minutes it opens again", () => {
    const soon = Math.floor(evening.getTime() / 1000) + 90 * 60;
    expect(quietCause({ hours: null, budget: { usagePct: 100, resetAtUnix: soon } }, evening)).toEqual({ kind: "budget", full: true, usagePct: 100, minutes: 90 });
    expect(quietCause({ hours: null, budget: { usagePct: 93, resetAtUnix: soon } }, evening)).toMatchObject({ kind: "budget", full: false });
    expect(quietCause({ hours: null, budget: { usagePct: 80, resetAtUnix: soon } }, evening)).toBeNull();
    // a window that already opened again, or one with no time to open: old data explains nothing
    expect(quietCause({ hours: null, budget: { usagePct: 100, resetAtUnix: Math.floor(evening.getTime() / 1000) - 60 } }, evening)).toBeNull();
    expect(quietCause({ hours: null, budget: { usagePct: 100, resetAtUnix: null } }, evening)).toBeNull();
    expect(minutesToReset({ usagePct: 100, resetAtUnix: Number.NaN }, evening)).toBe(-1);
  });

  it("puts the serious reasons first: a containment, then a provider with no login, then the window, then the hours", () => {
    const all = { hours: OFFICE, budget: { usagePct: 100, resetAtUnix: Math.floor(evening.getTime() / 1000) + 600 }, providerReady: false, containment: true };
    expect(quietCause(all, evening)?.kind).toBe("containment");
    expect(quietCause({ ...all, containment: false }, evening)?.kind).toBe("provider");
    expect(quietCause({ ...all, containment: false, providerReady: true }, evening)?.kind).toBe("budget");
    expect(quietCause({ ...all, containment: false, providerReady: true, budget: null }, evening)?.kind).toBe("outside_hours");
  });

  it("does not read a box that does not say as «all is well» or as a fault", () => {
    expect(quietCause({ hours: null, containment: null, providerReady: null, budget: undefined }, evening)).toBeNull();
  });
});
