type PlaygroundEnvironment = {
  DEV?: boolean;
  MODE?: string;
  VITE_JHT_ONBOARDING_PLAYGROUND?: string;
};

/** A presentation-only launch gate. Production remains unchanged even if misconfigured. */
export function onboardingPlaygroundEnabled(
  environment: PlaygroundEnvironment = import.meta.env,
): boolean {
  const developmentOrTest = environment.DEV === true || environment.MODE === "test";
  return developmentOrTest && environment.VITE_JHT_ONBOARDING_PLAYGROUND === "1";
}
