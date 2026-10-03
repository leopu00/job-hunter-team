import { useCallback, useState } from "react";
import { LoginScreen } from "../components/login-screen";
import { clearLocalIdentitySelection } from "../lib/local-profile";
import { onboardingPlaygroundEnabled } from "../lib/onboarding-playground";
import { useSession } from "../lib/supabase";
import DashboardApp from "./DashboardApp";

type PlaygroundChoice = "google" | "local" | null;

function PlaygroundDashboardEntry() {
  const { session } = useSession();
  const [choice, setChoice] = useState<PlaygroundChoice>(null);

  const chooseGoogle = useCallback(() => {
    clearLocalIdentitySelection();
    setChoice("google");
    return Boolean(session);
  }, [session]);

  const localReady = useCallback(() => {
    setChoice("local");
  }, []);

  if (choice === "local" || (choice === "google" && session)) {
    return <DashboardApp />;
  }

  return <LoginScreen onChooseGoogle={chooseGoogle} onLocalReady={localReady} />;
}

/** The component mounted by dashboard.html, including its dev/test-only identity gate. */
export function DashboardEntrypoint() {
  return onboardingPlaygroundEnabled() ? <PlaygroundDashboardEntry /> : <DashboardApp />;
}
