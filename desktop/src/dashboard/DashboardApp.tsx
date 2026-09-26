import { useCallback, useEffect, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import type { Locale } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";
import { LoginScreen } from "../components/login-screen";
import { signOut, supabase, useSession } from "../lib/supabase";
import DashboardScreen from "./DashboardScreen";
import { loadDashboard, type DashboardData } from "./load-dashboard";

/** The local team setup (welcome → Podman → team) lives on index.html. */
export const SETUP_PAGE = "index.html";

type Load =
  | { state: "loading" }
  | { state: "ready"; data: DashboardData }
  | { state: "failed" };

function Topbar({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const button =
    "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border transition-colors text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50";
  const border = { borderColor: "var(--color-border)" };
  return (
    <header
      className="sticky top-0 z-10 border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-void)" }}
    >
      <div className="max-w-6xl mx-auto px-5 h-12 flex items-center justify-between">
        <span
          className="text-[12px] font-bold tracking-[0.18em] uppercase"
          style={{ color: "var(--color-green)" }}
        >
          Job Hunter Team
        </span>
        <nav className="flex items-center gap-2" aria-label="Azioni">
          <button type="button" className={button} style={border} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Aggiorno…" : "Aggiorna"}
          </button>
          <a href={SETUP_PAGE} className={`${button} no-underline`} style={border}>
            Team locale
          </a>
          <button type="button" className={button} style={border} onClick={() => void signOut()}>
            Esci
          </button>
        </nav>
      </div>
    </header>
  );
}

function SignedInDashboard({ locale }: { locale: Locale }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    loadDashboard(supabase)
      .then((data) => setLoad({ state: "ready", data }))
      .catch(() => setLoad((prev) => (prev.state === "ready" ? prev : { state: "failed" })))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <>
      <Topbar onRefresh={refresh} refreshing={refreshing} />
      {load.state === "loading" && <DashboardSkeleton label="Caricamento dashboard" />}
      {load.state === "failed" && (
        <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
          Non riesco a leggere la dashboard. Controlla la connessione e premi «Aggiorna».
        </p>
      )}
      {load.state === "ready" && <DashboardScreen data={load.data} locale={locale} />}
    </>
  );
}

/**
 * The main window's first page: the Google sign-in until there is a session,
 * then the user's dashboard.
 */
export default function DashboardApp() {
  const { session, loading } = useSession();
  const [locale] = useState<Locale>(readLocaleCookie);

  if (loading) return <DashboardSkeleton label="Caricamento dashboard" />;
  if (!session) return <LoginScreen />;
  // Keyed by user: signing in as someone else starts from an empty screen.
  return <SignedInDashboard key={session.user.id} locale={locale} />;
}
