import { useEffect, useMemo } from "react";
import { DashboardI18nProvider } from "@/app/components/DashboardI18n";
import MainChrome from "@/app/components/MainChrome";
import NavLinks from "@/app/components/NavLinks";
import Link from "../web-shims/next-link";
import { SETUP_PAGE } from "../lib/pages";
import { signOut } from "../lib/supabase";
import { matchRoute, navigate, refresh, useLocation } from "./router";
import { HOME, ROUTES } from "./routes";

/**
 * The signed-in app: the web's protected layout (navbar on top, MainChrome
 * around the page) with a client router in place of Next's. The navbar links
 * are the web's NavLinks; on the right, what the desktop adds: refresh the
 * page's data, the local team setup, sign out.
 */
function Navbar() {
  const button =
    "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] transition-colors text-[var(--color-muted)] hover:text-[var(--color-bright)] no-underline";
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
      <nav aria-label="Navigazione app" className="px-5 sm:px-6 h-14 flex items-center gap-4">
        <Link href={HOME} className="flex items-center no-underline group flex-shrink-0">
          <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)] group-hover:opacity-80 transition-opacity">
            JHT
          </span>
        </Link>
        <div className="flex items-center mx-auto">
          <NavLinks />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" className={button} onClick={refresh}>
            Aggiorna
          </button>
          <a href={SETUP_PAGE} className={button}>
            Team locale
          </a>
          <button type="button" className={button} onClick={() => void signOut()}>
            Esci
          </button>
        </div>
      </nav>
    </header>
  );
}

export default function Shell() {
  const { path, search } = useLocation();
  const match = matchRoute(ROUTES, path);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  // An empty or unknown hash lands on the dashboard.
  useEffect(() => {
    if (!match) navigate(HOME, { replace: true });
  }, [match]);

  const Page = match?.route.page;
  return (
    <DashboardI18nProvider>
      <div style={{ position: "relative", zIndex: 1 }}>
        <Navbar />
        <MainChrome>{Page && <Page key={path} params={match.params} search={params} />}</MainChrome>
      </div>
    </DashboardI18nProvider>
  );
}
