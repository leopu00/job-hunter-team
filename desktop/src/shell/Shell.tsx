import { useEffect, useMemo, useState } from "react";
import { DashboardI18nProvider } from "@/app/components/DashboardI18n";
import MainChrome from "@/app/components/MainChrome";
import NavLinks from "@/app/components/NavLinks";
import Link from "../web-shims/next-link";
import { signOut } from "../lib/supabase";
import { DESKTOP_LINKS } from "./desktop-links";
import { matchRoute, navigate, refresh, useLocation } from "./router";
import { HOME, ROUTES } from "./routes";
import ThemePicker from "./ThemePicker";

/** The desktop's own pages (DESKTOP_LINKS): same look as NavLinks' NavLink, active on the path. */
function DesktopLinks() {
  const { path } = useLocation();
  return (
    <div className="flex items-center gap-1">
      {DESKTOP_LINKS.map(({ href, label }) => {
        const active = path === href || path.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="relative px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors no-underline inline-block"
            style={{ color: active ? "var(--color-white)" : "var(--color-muted)" }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The signed-in app: the web's protected layout (navbar on top, MainChrome
 * around the page) with a client router in place of Next's. The navbar links
 * are the web's NavLinks, then the desktop's own pages. The centre strip is
 * the only horizontal overflow plane, so narrow windows keep the brand and
 * both actions fully visible while every destination remains reachable.
 */
function Navbar({ onLogout = signOut }: { onLogout?: () => Promise<void> }) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const button =
    "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] transition-colors text-[var(--color-muted)] hover:text-[var(--color-bright)] no-underline";

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await onLogout();
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
      <nav
        aria-label="Navigazione app"
        className="max-w-full min-w-0 overflow-hidden px-2 sm:px-4 lg:px-6 h-14 flex items-center gap-2 sm:gap-4"
      >
        <div className="flex items-center flex-shrink-0">
          <Link href={HOME} className="flex items-center no-underline group">
            <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)] group-hover:opacity-80 transition-opacity">
              JHT
            </span>
          </Link>
          <ThemePicker />
        </div>
        <div
          className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
          data-testid="navbar-links-scroll"
        >
          <div className="flex w-max items-center gap-1 mx-auto">
            <NavLinks />
            <DesktopLinks />
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0" data-testid="navbar-actions">
          <button type="button" className={button} onClick={refresh}>
            Aggiorna
          </button>
          {signOutFailed && <span role="alert" className="sr-only">Disconnessione non riuscita. Il runtime resta bloccato su questo account.</span>}
          <button type="button" className={button} onClick={() => void logout()} disabled={signingOut}>
            {signingOut ? "Uscita…" : "Esci"}
          </button>
        </div>
      </nav>
    </header>
  );
}

export interface ShellProps { onLogout?: () => Promise<void> }

export default function Shell({ onLogout }: ShellProps) {
  const { path, search } = useLocation();
  const match = matchRoute(ROUTES, path);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  // An empty or unknown hash lands on the dashboard.
  useEffect(() => {
    if (!match) navigate(HOME, { replace: true });
  }, [match]);

  const Page = match?.route.page;
  const page = Page && <Page key={path} params={match.params} search={params} />;
  // A full-bleed page (the office) is a column as tall as the window: the
  // navbar, then the page in all the rest, with no margins and no page
  // scroll. Every other page keeps the web's MainChrome.
  if (match?.route.fullBleed) {
    return (
      <DashboardI18nProvider>
        <div
          style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "calc(100svh / var(--zoom, 1))", overflow: "hidden" }}
        >
          <Navbar onLogout={onLogout} />
          <main className="relative min-h-0 flex-1" data-testid="full-bleed">
            {page}
          </main>
        </div>
      </DashboardI18nProvider>
    );
  }
  return (
    <DashboardI18nProvider>
      <div style={{ position: "relative", zIndex: 1 }}>
      <Navbar onLogout={onLogout} />
        <MainChrome>{page}</MainChrome>
      </div>
    </DashboardI18nProvider>
  );
}
