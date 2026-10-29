import { WEEKDAYS, type Weekday, type WorkingHours } from "../../lib/team-settings-native";

/** How long the team can go without writing before the chat says why. */
export const QUIET_AFTER_MS = 30 * 60_000;
/** The budget notice of the provider's window starts here, as it does in the game (a share of the window, not of the day). */
export const BUDGET_NEAR_PCT = 90;
export const BUDGET_FULL_PCT = 99.5;
const WEEK_MINUTES = 7 * 24 * 60;

/** What the team's box says about the provider's window; every field is a number or a code, read only. */
export interface BudgetWindowFact { usagePct: number; resetAtUnix: number | null }

/**
 * What the app knows about the team to explain its silence. Every field but `hours` may be missing: a box that does not
 * say is not read as «all is well», it just gives no cause of its own.
 */
export interface QuietFacts {
  /** `null`: the team works around the clock. */
  hours: WorkingHours | null;
  /** A «work flat out» burst is running: the hours do not hold back the team. */
  burstActive?: boolean;
  budget?: BudgetWindowFact | null;
  /** An agent of the team is held by a safety containment. */
  containment?: boolean | null;
  /** The provider has a login the team can use. */
  providerReady?: boolean | null;
}

export type QuietCause =
  | { kind: "containment" }
  | { kind: "provider" }
  | { kind: "budget"; full: boolean; usagePct: number; minutes: number }
  | { kind: "outside_hours"; opens: { time: string; daysAhead: number; weekday: Weekday } };

interface LocalNow { weekday: number; minutes: number }

const WEEKDAY_OF: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The clock of the team's zone: the day of the week (Monday is 0) and the minutes since midnight. `null`: a zone this system does not know. */
export function localNow(timezone: string, now: Date): LocalNow | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const weekday = WEEKDAY_OF[get("weekday")];
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return { weekday, minutes: (hour % 24) * 60 + minute };
  } catch {
    return null;
  }
}

function minutesOf(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Whether the team is on the clock, as the box counts it (shared/skills/working_hours.py): a window belongs to the day it starts on,
 * and one that ends before it starts (22:00 to 06:00) runs into the next morning. `null`: the hours cannot be read here.
 */
export function withinHours(hours: WorkingHours, now: Date): boolean | null {
  const here = localNow(hours.timezone, now);
  if (!here) return null;
  for (const window of hours.windows) {
    const start = minutesOf(window.start);
    const end = minutesOf(window.end);
    if (start === null || end === null) return null;
    const days = new Set(window.days.map((day) => WEEKDAYS.indexOf(day)));
    if (start <= end) {
      if (days.has(here.weekday) && here.minutes >= start && here.minutes < end) return true;
    } else {
      if (days.has(here.weekday) && here.minutes >= start) return true;
      if (days.has((here.weekday + 6) % 7) && here.minutes < end) return true;
    }
  }
  return false;
}

/** The next time a window opens, in the team's own clock, or null when there is none to find (no windows, an unreadable zone). */
export function nextOpening(hours: WorkingHours, now: Date): { time: string; daysAhead: number; weekday: Weekday } | null {
  const here = localNow(hours.timezone, now);
  if (!here) return null;
  const nowOfWeek = here.weekday * 1440 + here.minutes;
  let best: { away: number; time: string; weekday: Weekday } | null = null;
  for (const window of hours.windows) {
    const start = minutesOf(window.start);
    if (start === null) return null;
    for (const day of window.days) {
      const index = WEEKDAYS.indexOf(day);
      if (index < 0) return null;
      const away = (index * 1440 + start - nowOfWeek + WEEK_MINUTES) % WEEK_MINUTES;
      if (away === 0) continue;
      if (!best || away < best.away) best = { away, time: window.start, weekday: day };
    }
  }
  if (!best) return null;
  // whole calendar days between today and the opening, in the team's clock
  const daysAhead = Math.floor((here.minutes + best.away) / 1440);
  return { time: best.time, daysAhead, weekday: best.weekday };
}

/** Minutes until the provider's window opens again, or -1 when the box does not say. */
export function minutesToReset(budget: BudgetWindowFact, now: Date): number {
  if (budget.resetAtUnix === null || !Number.isFinite(budget.resetAtUnix)) return -1;
  const left = budget.resetAtUnix * 1000 - now.getTime();
  return left < 0 ? -1 : Math.ceil(left / 60_000);
}

/**
 * Why the team is not writing, if the facts say so; the most serious reason first: an agent held by a containment, a provider
 * with no login, a window of the provider that is used up (or nearly), then the hours. Null: no reason to give, so none is
 * made up.
 */
export function quietCause(facts: QuietFacts, now: Date): QuietCause | null {
  if (facts.containment === true) return { kind: "containment" };
  if (facts.providerReady === false) return { kind: "provider" };
  const budget = facts.budget;
  if (budget && Number.isFinite(budget.usagePct) && budget.usagePct >= BUDGET_NEAR_PCT) {
    const minutes = minutesToReset(budget, now);
    // a window that has already reset, or one with no reset time, is old data: silence is not explained by it
    if (minutes >= 0) return { kind: "budget", full: budget.usagePct >= BUDGET_FULL_PCT, usagePct: budget.usagePct, minutes };
  }
  if (facts.hours && !facts.burstActive && facts.hours.windows.length > 0) {
    if (withinHours(facts.hours, now) === false) {
      const opens = nextOpening(facts.hours, now);
      if (opens) return { kind: "outside_hours", opens };
    }
  }
  return null;
}
