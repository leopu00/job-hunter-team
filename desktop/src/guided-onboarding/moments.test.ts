import { describe, expect, it } from "vitest";
import {
  gateStaysRequired,
  guidedMoment,
  TEAM_START_PATIENCE_MS,
  teamStarted,
  teamWaitState,
  type FirstRunSignal,
  type GuidedSignals,
} from "./moments";

const burst = (workers: number, planDeclared = true): FirstRunSignal => ({ phase: "burst", workers, planDeclared });

function signals(over: Partial<GuidedSignals> = {}): GuidedSignals {
  return { profileFilled: 0, profileTotal: 8, profileReady: false, captainRunning: true, firstRun: null, ...over };
}

describe("the team has started", () => {
  it("only when the Captain runs and the burst is open with a worker launched", () => {
    expect(teamStarted({ captainRunning: true, firstRun: burst(1) })).toBe(true);
    expect(teamStarted({ captainRunning: true, firstRun: burst(4) })).toBe(true);
  });

  it("not with a burst that launched no worker, and not before the burst", () => {
    expect(teamStarted({ captainRunning: true, firstRun: burst(0) })).toBe(false);
    expect(teamStarted({ captainRunning: true, firstRun: { phase: "awaiting_profile", workers: 0, planDeclared: false } })).toBe(false);
    // a worker count without the burst open is not a start
    expect(teamStarted({ captainRunning: true, firstRun: { phase: "awaiting_profile", workers: 3, planDeclared: true } })).toBe(false);
  });

  it("not when the Captain does not run, and not when the state cannot be read", () => {
    expect(teamStarted({ captainRunning: false, firstRun: burst(2) })).toBe(false);
    expect(teamStarted({ captainRunning: true, firstRun: null })).toBe(false);
  });

  it("a burst that is already over was open once: it counts", () => {
    expect(teamStarted({ captainRunning: true, firstRun: { phase: "steady", workers: 0, planDeclared: true } })).toBe(true);
    expect(teamStarted({ captainRunning: false, firstRun: { phase: "steady", workers: 0, planDeclared: true } })).toBe(false);
  });
});

describe("the moment is derived from what the machine says", () => {
  it("interview while the fields are not all there", () => {
    expect(guidedMoment(signals())).toBe("interview");
    expect(guidedMoment(signals({ profileFilled: 7 }))).toBe("interview");
    // a card that could not count (total 0) is not a complete profile
    expect(guidedMoment(signals({ profileFilled: 0, profileTotal: 0 }))).toBe("interview");
  });

  it("confirm when the fields are all there and the profile is not confirmed", () => {
    expect(guidedMoment(signals({ profileFilled: 8 }))).toBe("confirm");
  });

  it("plan once the profile is confirmed and the plan is not declared", () => {
    expect(guidedMoment(signals({ profileReady: true, profileFilled: 8, firstRun: { phase: "awaiting_profile", workers: 0, planDeclared: false } }))).toBe("plan");
  });

  it("team, not plan, when nothing can be read of the first run: it waits and says it is late, it does not ask what may be done", () => {
    expect(guidedMoment(signals({ profileReady: true, profileFilled: 8, firstRun: null }))).toBe("team");
  });

  it("team once the plan is declared and nothing works yet", () => {
    expect(guidedMoment(signals({ profileReady: true, firstRun: { phase: "awaiting_profile", workers: 0, planDeclared: true } }))).toBe("team");
    expect(guidedMoment(signals({ profileReady: true, firstRun: burst(0) }))).toBe("team");
    expect(guidedMoment(signals({ profileReady: true, captainRunning: false, firstRun: burst(2) }))).toBe("team");
  });

  it("started when the team has", () => {
    expect(guidedMoment(signals({ profileReady: true, firstRun: burst(1) }))).toBe("started");
  });

  it("a confirmed profile with the plan «I don't know»: the burst opens with one worker and that is a start", () => {
    expect(guidedMoment(signals({ profileReady: true, profileFilled: 8, firstRun: burst(1) }))).toBe("started");
  });
});

describe("the gate and its way out", () => {
  it("stays required until the team has started", () => {
    expect(gateStaysRequired(signals(), false)).toBe(true);
    expect(gateStaysRequired(signals({ profileReady: true, firstRun: burst(0) }), false)).toBe(true);
    expect(gateStaysRequired(signals({ profileReady: true, firstRun: burst(1) }), false)).toBe(false);
  });

  it("«continue later» releases it in every state, whatever the signals say", () => {
    const states: GuidedSignals[] = [
      signals(),
      signals({ profileFilled: 8 }),
      signals({ profileReady: true, firstRun: null }),
      signals({ profileReady: true, firstRun: { phase: "awaiting_profile", workers: 0, planDeclared: false } }),
      signals({ profileReady: true, captainRunning: false, firstRun: burst(0) }),
      signals({ profileReady: true, firstRun: burst(3) }),
      signals({ profileTotal: 0 }),
    ];
    for (const state of states) expect(gateStaysRequired(state, true), JSON.stringify(state)).toBe(false);
  });
});

describe("the patience of the wait for the team", () => {
  it("is five minutes: before it the column waits, from it the column says so", () => {
    expect(TEAM_START_PATIENCE_MS).toBe(5 * 60 * 1000);
    expect(teamWaitState(0)).toBe("waiting");
    expect(teamWaitState(TEAM_START_PATIENCE_MS - 1)).toBe("waiting");
    expect(teamWaitState(TEAM_START_PATIENCE_MS)).toBe("late");
    expect(teamWaitState(60 * 60 * 1000)).toBe("late");
  });
});
