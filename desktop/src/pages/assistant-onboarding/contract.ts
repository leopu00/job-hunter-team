export const ASSISTANT_ONBOARDING_PATHS = ["tour", "requirements", "explore"] as const;

export type AssistantOnboardingPath = (typeof ASSISTANT_ONBOARDING_PATHS)[number];
export type AssistantOnboardingStep = 0 | 1 | 2 | 3 | 4;

/**
 * Small, serializable UI snapshot. Persisting it is deliberately left to the
 * caller: this component does not know about the router, backend or chat.
 */
export type AssistantOnboardingState = {
  path: AssistantOnboardingPath | null;
  step: AssistantOnboardingStep;
};

export type AssistantOnboardingProps = {
  assistantName?: string;
  initialState?: AssistantOnboardingState;
  onStateChange?: (state: AssistantOnboardingState) => void;
  onComplete: (state: AssistantOnboardingState) => Promise<void>;
};

export const INITIAL_ASSISTANT_ONBOARDING_STATE: AssistantOnboardingState = {
  path: null,
  step: 0,
};
