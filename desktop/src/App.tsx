import { useEffect } from "react";
import { LoginScreen } from "./components/login-screen";
import { DASHBOARD_PAGE, goTo } from "./lib/pages";
import { localIdentitySelected } from "./lib/local-profile";
import { useSession } from "./lib/supabase";

/**
 * The secondary entrypoint is authentication-only. Runtime setup belongs to
 * DashboardApp, after a real Google session has been restored, so the shipped
 * app has no alternate API-key/team-start route.
 */
export default function App() {
  const { session } = useSession();
  const localSelected = localIdentitySelected();

  useEffect(() => {
    if (session || localSelected) goTo(DASHBOARD_PAGE);
  }, [localSelected, session]);

  return <LoginScreen />;
}
