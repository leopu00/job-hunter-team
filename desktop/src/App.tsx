import { useCallback, useEffect } from "react";
import { LoginScreen } from "./components/login-screen";
import {
  clearGoogleIdentitySelection,
  selectGoogleIdentity,
} from "./lib/identity-choice";
import { DASHBOARD_PAGE, goTo } from "./lib/pages";
import { clearLocalIdentitySelection } from "./lib/local-profile";
import { useDeferredSession } from "./lib/supabase";

/**
 * The secondary entrypoint is authentication-only. Runtime setup belongs to
 * DashboardApp, after a real Google session has been restored, so the shipped
 * app has no alternate API-key/team-start route.
 */
export default function App() {
  const { session, restore } = useDeferredSession();

  useEffect(() => {
    // index.html is always the identity boundary. A marker from an earlier
    // same-window navigation must not authorize a fresh entry frame.
    clearGoogleIdentitySelection();
  }, []);

  useEffect(() => {
    if (session) goTo(DASHBOARD_PAGE);
  }, [session]);

  const chooseGoogle = useCallback(async () => {
    clearLocalIdentitySelection();
    selectGoogleIdentity();
    return Boolean(await restore());
  }, [restore]);

  const localReady = useCallback(() => {
    clearGoogleIdentitySelection();
    goTo(DASHBOARD_PAGE);
  }, []);

  return (
    <LoginScreen
      onChooseGoogle={chooseGoogle}
      onLocalReady={localReady}
    />
  );
}
