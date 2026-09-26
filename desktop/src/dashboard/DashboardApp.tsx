import { useEffect } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { goTo, LOGIN_PAGE } from "../lib/pages";
import { useSession } from "../lib/supabase";
import Shell from "../shell/Shell";

/**
 * The main window's first page: the signed-in app (navbar + pages, dashboard
 * first). Without a session (never signed in, or just signed out) it hands
 * over to the Google sign-in.
 */
export default function DashboardApp() {
  const { session, loading } = useSession();
  const signedOut = !loading && !session;

  useEffect(() => {
    if (signedOut) goTo(LOGIN_PAGE);
  }, [signedOut]);

  if (!session) return <DashboardSkeleton label="Caricamento dashboard" />;
  // Keyed by user: signing in as someone else starts from empty pages.
  return <Shell key={session.user.id} />;
}
