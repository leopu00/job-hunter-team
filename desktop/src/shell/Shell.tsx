import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DashboardI18nProvider, useDashboardT } from "@/app/components/DashboardI18n";
import MainChrome from "@/app/components/MainChrome";
import NavLinks from "@/app/components/NavLinks";
import Link from "../web-shims/next-link";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";
import { signOut } from "../lib/supabase";
import { appLocale } from "../lib/app-locale";
import {
  existingTeamReadOnlyReason,
  useExistingTeamReadNotice,
  useExistingTeamReadOnly,
} from "../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { LeaveReadOnlyContext } from "../lib/leave-read-only";
import { VpsLinkBar } from "./VpsLinkBar";
import { localUninstallAvailable } from "../lib/local-uninstall";
import { COMPUTER_TEXT } from "../pages/computer/computer.i18n";
import { desktopLinks } from "./desktop-links";
import { SHELL_TEXT } from "./shell.i18n";
import { MailRotationBanner } from "./MailRotationBanner";
import NavStrip from "./NavStrip";
import { matchRoute, navigate, refresh, useLocation } from "./router";
import { HOME, READ_ONLY_HOME, READ_ONLY_NAV, READ_ONLY_ROUTES, ROUTES } from "./routes";
import ThemePicker from "./ThemePicker";

/** The desktop's own pages (desktopLinks): same look as NavLinks' NavLink, active on the path. */
function DesktopLinks() {
  const { path } = useLocation();
  // «This computer» (removing JHT) only where the removal can run.
  const [computer, setComputer] = useState(false);
  useEffect(() => {
    let active = true;
    void localUninstallAvailable().then((yes) => { if (active) setComputer(yes); });
    return () => { active = false; };
  }, []);
  const own = desktopLinks(appLocale());
  const links = computer ? [...own, { href: "/computer", label: COMPUTER_TEXT[appLocale()].navLabel }] : own;
  return (
    <div className="flex items-center gap-1">
      {links.map(({ href, label }) => {
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
function Navbar({
  onLogout = signOut,
  onCloseReadOnly,
  readOnly = false,
}: {
  onLogout?: () => Promise<void>;
  /** Reading an existing team's VPS: one page, and the way back to the setup. */
  onCloseReadOnly?: () => void;
  readOnly?: boolean;
}) {
  const readOnlyText = EXISTING_TEAM_READONLY_TEXT[appLocale()];
  const shellText = SHELL_TEXT[appLocale()];
  const { t: dashboardT } = useDashboardT();
  const { path } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const button =
    "text-[10px] font-semibold tracking-widest uppercase px-2 xl:px-3 py-1.5 rounded border border-[var(--color-border)] transition-colors text-[var(--color-muted)] hover:text-[var(--color-bright)] no-underline";

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
        aria-label={shellText.navAria}
        className="max-w-full min-w-0 overflow-hidden px-2 sm:px-4 lg:px-6 h-14 flex items-center gap-2 sm:gap-4"
      >
        <div className="flex items-center flex-shrink-0">
          <Link href={readOnly ? READ_ONLY_HOME : HOME} className="flex items-center no-underline group">
            <span className="text-[13px] font-bold tracking-widest text-[var(--color-white)] group-hover:opacity-80 transition-opacity">
              JHT
            </span>
          </Link>
          <ThemePicker />
        </div>
        <NavStrip>
          {readOnly ? (
            READ_ONLY_NAV.map(({ href, label }) => {
              const active = path === href || path.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="relative px-2 xl:px-3 py-1.5 text-[11px] font-semibold tracking-widest hover:bg-[var(--color-card)] rounded transition-colors no-underline inline-block"
                  style={{ color: active ? "var(--color-white)" : "var(--color-muted)" }}
                >
                  {label.startsWith("own:") ? readOnlyText[label.slice(4) as "team" | "profile" | "office" | "agents" | "settings"] : dashboardT(label)}
                </Link>
              );
            })
          ) : (
            <>
              <NavLinks />
              <DesktopLinks />
            </>
          )}
        </NavStrip>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0" data-testid="navbar-actions">
          <button type="button" className={button} onClick={refresh}>
            {shellText.refresh}
          </button>
          {signOutFailed && <span role="alert" className="sr-only">{shellText.signOutFailed}</span>}
          {readOnly && onCloseReadOnly && (
            <button type="button" className={button} onClick={onCloseReadOnly}>
              {readOnlyText.back}
            </button>
          )}
          <button type="button" className={button} onClick={() => void logout()} disabled={signingOut}>
            {signingOut ? shellText.signingOut : shellText.signOut}
          </button>
        </div>
      </nav>
    </header>
  );
}

export interface ShellProps {
  onLogout?: () => Promise<void>;
  /** Leaves the read-only view of an existing team (back to the setup). */
  onCloseReadOnly?: () => void;
}

/** A full-bleed page's column: as tall as the window, the navbar and its bars on top, the page in the rest, no page scroll. */
const FULL_BLEED_COLUMN: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  height: "calc(100svh / var(--zoom, 1))",
  overflow: "hidden",
};

export default function Shell({ onLogout, onCloseReadOnly }: ShellProps) {
  const { path, search } = useLocation();
  const readOnlyTeam = useExistingTeamReadOnly();
  const readNotice = useExistingTeamReadNotice();
  const readOnly = readOnlyTeam !== null;
  const match = matchRoute(readOnly ? READ_ONLY_ROUTES : ROUTES, path);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  // An empty or unknown hash lands on the dashboard.
  useEffect(() => {
    if (!match) navigate(readOnly ? READ_ONLY_HOME : HOME, { replace: true });
  }, [match, readOnly]);

  const Page = match?.route.page;
  const page = Page && <Page key={path} params={match.params} search={params} />;
  if (readOnlyTeam) {
    const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
    const bars = (
      <>
        <Navbar onLogout={onLogout} onCloseReadOnly={onCloseReadOnly} readOnly />
        <p
          role="status"
          data-testid="existing-team-readonly-banner"
          className="px-4 py-2 text-[11px] border-b border-[var(--color-border)] text-[var(--color-muted)]"
        >
          <strong className="text-[var(--color-bright)]">{existingTeamReadOnlyReason(readOnlyTeam)}.</strong>{" "}
          {text.banner} <span data-testid="existing-team-judgement-coming">{text.judgementComing}</span>
        </p>
        {readNotice === "sort_last_action" && (
          <p role="status" data-testid="existing-team-readonly-notice" className="px-4 py-2 text-[11px] text-[var(--color-muted)]">
            {text.sortLastAction}
          </p>
        )}
        <VpsLinkBar onCloseReadOnly={onCloseReadOnly} />
      </>
    );
    return (
      <DashboardI18nProvider>
        <ReadOnlyActionsProvider value={{ readOnly: true, reason: existingTeamReadOnlyReason(readOnlyTeam) }}>
          <LeaveReadOnlyContext.Provider value={onCloseReadOnly ?? null}>
          {match?.route.fullBleed ? (
            // the office: the same window-tall column as in the full shell, the read-only bars under the navbar
            <div style={FULL_BLEED_COLUMN}>
              {bars}
              <main className="relative min-h-0 flex-1" data-testid="full-bleed">
                {page}
              </main>
            </div>
          ) : (
            <div style={{ position: "relative", zIndex: 1 }}>
              {bars}
              <MainChrome>{page}</MainChrome>
            </div>
          )}
          </LeaveReadOnlyContext.Provider>
        </ReadOnlyActionsProvider>
      </DashboardI18nProvider>
    );
  }
  // A full-bleed page (the office) is a column as tall as the window: the
  // navbar, then the page in all the rest, with no margins and no page
  // scroll. Every other page keeps the web's MainChrome.
  if (match?.route.fullBleed) {
    return (
      <DashboardI18nProvider>
        <div style={FULL_BLEED_COLUMN}>
          <Navbar onLogout={onLogout} />
          <MailRotationBanner />
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
        <MailRotationBanner />
        <MainChrome>{page}</MainChrome>
      </div>
    </DashboardI18nProvider>
  );
}
