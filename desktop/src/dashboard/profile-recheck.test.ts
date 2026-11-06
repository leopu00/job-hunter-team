import { describe, expect, it } from "vitest";
import { PROFILE_RECHECK_STEPS_MS, profileRecheckDelay } from "./profile-recheck";

describe("the pace of the profile check", () => {
  it("starts quick, slows down at every look and stays at the last step", () => {
    expect([0, 1, 2, 3, 4].map(profileRecheckDelay)).toEqual([2_000, 5_000, 10_000, 20_000, 30_000]);
    expect(profileRecheckDelay(5)).toBe(30_000);
    expect(profileRecheckDelay(500)).toBe(30_000);
    expect(profileRecheckDelay(-1)).toBe(2_000);
  });

  it("never asks a computer more often than every two seconds, and ends no slower than every thirty", () => {
    expect(Math.min(...PROFILE_RECHECK_STEPS_MS)).toBeGreaterThanOrEqual(2_000);
    expect(Math.max(...PROFILE_RECHECK_STEPS_MS)).toBeLessThanOrEqual(30_000);
    for (let i = 1; i < PROFILE_RECHECK_STEPS_MS.length; i++) expect(PROFILE_RECHECK_STEPS_MS[i]).toBeGreaterThanOrEqual(PROFILE_RECHECK_STEPS_MS[i - 1]);
  });
});
