import { describe, expect, it } from "vitest";
import { nextScreenWait, SCREEN_BACKOFF_MAX_MS, SCREEN_LIVE_MS, SCREEN_SLOW_MS, screenPace } from "./terminal-pace";

describe("the pace of the agent's terminal", () => {
  it("takes the pace the native side says, within the bounds; none or a strange one is the slow pace", () => {
    expect(screenPace(2_000)).toBe(2_000);
    expect(screenPace(10_000)).toBe(10_000);
    for (const value of [undefined, null, "2000", 0, 500, 1_999, 2_000.5, 60_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(screenPace(value)).toBe(SCREEN_SLOW_MS);
    }
  });

  it("a good read gives the next wait its own pace", () => {
    expect(nextScreenWait(SCREEN_SLOW_MS, { ok: true, pace: SCREEN_LIVE_MS })).toBe(SCREEN_LIVE_MS);
    expect(nextScreenWait(40_000, { ok: true, pace: SCREEN_SLOW_MS })).toBe(SCREEN_SLOW_MS);
  });

  it("a server that turns this computer away doubles the wait from the slow pace, up to a minute", () => {
    let wait = SCREEN_LIVE_MS;
    const waits = [];
    for (let i = 0; i < 5; i += 1) {
      wait = nextScreenWait(wait, { ok: false, code: "ssh_rate_limited" });
      waits.push(wait);
    }
    expect(waits).toEqual([20_000, 40_000, SCREEN_BACKOFF_MAX_MS, SCREEN_BACKOFF_MAX_MS, SCREEN_BACKOFF_MAX_MS]);
  });

  it("any other failure keeps the wait it had", () => {
    expect(nextScreenWait(SCREEN_LIVE_MS, { ok: false, code: "agents_unavailable" })).toBe(SCREEN_LIVE_MS);
    expect(nextScreenWait(40_000, { ok: false, code: "agent_screen_unfiltered" })).toBe(40_000);
  });
});
