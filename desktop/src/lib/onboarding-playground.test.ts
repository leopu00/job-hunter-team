import { describe, expect, it } from "vitest";
import { onboardingPlaygroundEnabled } from "./onboarding-playground";

describe("onboarding playground launch gate", () => {
  it("accepts only the explicit value in development or test", () => {
    expect(onboardingPlaygroundEnabled({ DEV: true, MODE: "development", VITE_JHT_ONBOARDING_PLAYGROUND: "1" })).toBe(true);
    expect(onboardingPlaygroundEnabled({ DEV: false, MODE: "test", VITE_JHT_ONBOARDING_PLAYGROUND: "1" })).toBe(true);
    expect(onboardingPlaygroundEnabled({ DEV: true, MODE: "development", VITE_JHT_ONBOARDING_PLAYGROUND: "true" })).toBe(false);
    expect(onboardingPlaygroundEnabled({ DEV: true, MODE: "development" })).toBe(false);
  });

  it("stays disabled in production even if the variable is present", () => {
    expect(onboardingPlaygroundEnabled({
      DEV: false,
      MODE: "production",
      VITE_JHT_ONBOARDING_PLAYGROUND: "1",
    })).toBe(false);
  });
});
