import { useCallback, useState } from "react";
import { LoginScreen } from "../components/login-screen";
import {
  clearGoogleIdentitySelection,
  selectGoogleIdentity,
} from "../lib/identity-choice";
import {
  clearLocalIdentitySelection,
  resetPlaygroundLocalProfile,
} from "../lib/local-profile";
import { onboardingPlaygroundEnabled } from "../lib/onboarding-playground";
import { useDeferredSession } from "../lib/supabase";
import DashboardApp from "./DashboardApp";

type PlaygroundChoice = "google" | "local" | null;

function PlaygroundDashboardEntry() {
  const { session, restore } = useDeferredSession();
  const [choice, setChoice] = useState<PlaygroundChoice>(null);

  const chooseGoogle = useCallback(async () => {
    clearLocalIdentitySelection();
    selectGoogleIdentity();
    setChoice("google");
    return Boolean(await restore());
  }, [restore]);

  const localReady = useCallback(() => {
    clearGoogleIdentitySelection();
    setChoice("local");
  }, []);

  const resetLocalPlayground = useCallback(async () => {
    await resetPlaygroundLocalProfile();
    setChoice(null);
  }, []);

  if (choice === "local" || (choice === "google" && session)) {
    return <DashboardApp />;
  }

  return (
    <LoginScreen
      onChooseGoogle={chooseGoogle}
      onLocalReady={localReady}
      onResetLocalPlayground={resetLocalPlayground}
    />
  );
}

/** The component mounted by dashboard.html, including its dev/test-only identity gate. */
export function DashboardEntrypoint() {
  return onboardingPlaygroundEnabled() ? <PlaygroundDashboardEntry /> : <DashboardApp />;
}
