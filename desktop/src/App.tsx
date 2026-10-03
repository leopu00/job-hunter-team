import { useCallback, useEffect, useState } from "react";
import { LoginScreen } from "./components/login-screen";
import { DASHBOARD_PAGE, goTo } from "./lib/pages";
import { clearLocalIdentitySelection, localIdentitySelected } from "./lib/local-profile";
import { onboardingPlaygroundEnabled } from "./lib/onboarding-playground";
import { useSession } from "./lib/supabase";

/**
 * The secondary entrypoint is authentication-only. Runtime setup belongs to
 * DashboardApp, after a real Google session has been restored, so the shipped
 * app has no alternate API-key/team-start route.
 */
export default function App() {
  const { session } = useSession();
  const localSelected = localIdentitySelected();
  const playground = onboardingPlaygroundEnabled();
  const [playgroundChoiceMade, setPlaygroundChoiceMade] = useState(false);

  useEffect(() => {
    if ((session || localSelected) && (!playground || playgroundChoiceMade)) {
      goTo(DASHBOARD_PAGE);
    }
  }, [localSelected, playground, playgroundChoiceMade, session]);

  const chooseGoogle = useCallback(() => {
    clearLocalIdentitySelection();
    setPlaygroundChoiceMade(true);
    return Boolean(session);
  }, [session]);

  const localReady = useCallback(() => {
    setPlaygroundChoiceMade(true);
    goTo(DASHBOARD_PAGE);
  }, []);

  return (
    <LoginScreen
      {...(playground ? { onChooseGoogle: chooseGoogle, onLocalReady: localReady } : {})}
    />
  );
}
