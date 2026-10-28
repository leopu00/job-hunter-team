import { useCallback, useEffect, useState } from "react";
import { explicitLocale } from "./lib/app-locale";
import { LanguageScreen } from "./onboarding/LanguageScreen";
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
  // The language is the first thing the app asks, before any other text: until the person has said it, on this
  // computer or in the settings, nothing else shows.
  const [languageSaid, setLanguageSaid] = useState(() => explicitLocale() !== null);

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

  if (!languageSaid) return <LanguageScreen onChosen={() => setLanguageSaid(true)} />;
  return (
    <LoginScreen
      onChooseGoogle={chooseGoogle}
      onLocalReady={localReady}
    />
  );
}
