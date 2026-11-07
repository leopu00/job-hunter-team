import { useEffect, useMemo, useState } from "react";
import { useDashboardT } from "@/app/components/DashboardI18n";
import Link from "../web-shims/next-link";
import { useLocalTeamData, useLocalTeamSavedAt } from "../lib/local-team-data";
import { LOCAL_TEAM_DATA_TEXT } from "../lib/local-team-data.i18n";
import { signOut } from "../lib/supabase";
import { appLocale } from "../lib/app-locale";
import {
  existingTeamReadOnlyReason,
  useExistingTeamReadNotice,
  useExistingTeamReadOnly,
  useExistingTeamView,
} from "../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { ChooseDestinationContext } from "../lib/choose-destination";
import { SHELL_TEXT } from "./shell.i18n";
import { SignOutContext } from "../lib/account-actions";
import NavStrip from "./NavStrip";
import PageErrorBoundary from "./PageErrorBoundary";
import { EXIT_OPEN_EVENT } from "../lib/app-exit";
import { APP_EXIT_TEXT } from "../components/AppExitDialog.i18n";
import { forgetReadsInFlight } from "../lib/read-deadline";
import { matchRoute, navigate, refresh, useLocation, type RouteMatch } from "./router";
import DocumentPreviewHost from "../pages/positions/DocumentPreviewHost";
import { HOME, READ_ONLY_HOME, READ_ONLY_ROUTES, ROUTES, type Route } from "./routes";
import { PageTimingBoundary } from "./PageTimingBoundary";
import { LinkedShellBars, LocalShellBars, ShellFrame, ShellProviders } from "./ShellFrames";
import ThemePicker from "./ThemePicker";
import MainNav from "./MainNav";
import { redirectFor } from "./redirects";
import UserMenu from "./UserMenu";
import { ACCOUNT_MENU_ITEMS, NAV_ITEMS, READ_ONLY_ACCOUNT_MENU_ITEMS, READ_ONLY_NAV_ITEMS } from "./nav-items";
import { RefreshIcon } from "./icons";

/**
 * The signed-in app: the web's protected layout (navbar on top, MainChrome
 * around the page) with a client router in place of Next's. The navbar links
 * are the positions and the team (nav-items.ts); the person's own pages and the ways out are in the account menu. The centre strip is
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
    "inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase px-2 xl:px-3 py-1.5 rounded border border-[var(--color-border)] transition-colors text-[var(--color-muted)] hover:text-[var(--color-bright)] no-underline";

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
      {/* overflow-x-clip, not overflow-hidden: hidden clips the «More ▾» menu too, which hangs below the 56 px bar. The bar still never grows past the window; only the horizontal axis is cut. */}
      <nav
        aria-label={shellText.navAria}
        className="max-w-full min-w-0 overflow-x-clip px-2 sm:px-4 lg:px-6 h-14 flex items-center gap-2 sm:gap-4"
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
          <MainNav
            items={readOnly ? READ_ONLY_NAV_ITEMS : NAV_ITEMS}
            hasPage={(href) => matchRoute(readOnly ? READ_ONLY_ROUTES : ROUTES, href) !== null}
            webText={dashboardT}
          />
        </NavStrip>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0" data-testid="navbar-actions">
          <button type="button" className={button} onClick={refresh}>
            <RefreshIcon />
            {shellText.refresh}
          </button>
          {signOutFailed && <span role="alert" className="sr-only">{shellText.signOutFailed}</span>}
          {readOnly && onCloseReadOnly && (
            <button type="button" className={button} onClick={onCloseReadOnly}>
              {readOnlyText.back}
            </button>
          )}
          {/* leaving the app, not the account: it asks what to do with the team (components/AppExitDialog) */}
          <UserMenu
            items={readOnly ? READ_ONLY_ACCOUNT_MENU_ITEMS : ACCOUNT_MENU_ITEMS}
            webText={dashboardT}
            className={button}
            actions={[
              {
                key: "exit",
                label: APP_EXIT_TEXT[appLocale()].menu,
                testId: "app-exit-button",
                onSelect: () => window.dispatchEvent(new Event(EXIT_OPEN_EVENT)),
              },
              {
                key: "sign-out",
                label: signingOut ? shellText.signingOut : shellText.signOut,
                title: shellText.signOutNote,
                disabled: signingOut,
                onSelect: () => void logout(),
              },
            ]}
          />
        </div>
      </nav>
    </header>
  );
}

export interface ShellProps {
  onLogout?: () => Promise<void>;
  /** Leaves the read-only view of an existing team (back to the setup). */
  onCloseReadOnly?: () => void;
  /** Opens the setup where the person chooses where the team runs (the saved destination is gone). */
  onChooseDestination?: () => void;
  /** Whose app this is (the account or the local profile): what the greeting on coming back remembers is theirs. */
  identityKey?: string;
}

/** Saved data is read only; a live position keeps its native two-step write controls. */
function useLocalReadOnly(localTeam: boolean, savedOnShow: boolean, path: string) {
  const onPositionPage = /^\/positions\/[^/]+\/?$/.test(path);
  return useMemo(
    () => localTeam && savedOnShow
      ? { readOnly: true, teamOff: true, reason: LOCAL_TEAM_DATA_TEXT[appLocale()].savedHint }
      : localTeam && !onPositionPage
      ? { readOnly: true, reason: LOCAL_TEAM_DATA_TEXT[appLocale()].readOnly }
      : { readOnly: false, reason: "", ...(localTeam ? { applyTwoStep: true } : {}) },
    [localTeam, onPositionPage, savedOnShow],
  );
}

type ShellPageProps = Pick<ShellProps, "onLogout" | "onChooseDestination"> & {
  match: RouteMatch<Route>;
  path: string;
  params: URLSearchParams;
  readOnly: boolean;
};

function ShellPage({ match, path, params, readOnly, onLogout, onChooseDestination }: ShellPageProps) {
  const Page = match.route.page;
  return (
    <SignOutContext.Provider value={onLogout ?? null}>
      <ChooseDestinationContext.Provider value={onChooseDestination ?? null}>
        <PageErrorBoundary key={path} onHome={() => navigate(readOnly ? READ_ONLY_HOME : HOME)}>
          <Page params={match.params} search={params} />
        </PageErrorBoundary>
      </ChooseDestinationContext.Provider>
      <DocumentPreviewHost key={`preview:${path}`} />
    </SignOutContext.Provider>
  );
}

export default function Shell({ onLogout, onCloseReadOnly, onChooseDestination, identityKey }: ShellProps) {
  const { path, search } = useLocation();
  const linkedTeam = useExistingTeamView();
  const readOnlyTeam = useExistingTeamReadOnly();
  const readNotice = useExistingTeamReadNotice();
  const readOnly = linkedTeam !== null;
  const localTeam = useLocalTeamData();
  const savedOnShow = useLocalTeamSavedAt() !== null;
  const localReadOnly = useLocalReadOnly(localTeam, savedOnShow, path);
  const match = matchRoute(readOnly ? READ_ONLY_ROUTES : ROUTES, path);
  const moved = redirectFor(path, search);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  // A new account must never wait for a read the last account started.
  useEffect(() => {
    forgetReadsInFlight();
    return forgetReadsInFlight;
  }, []);
  useEffect(() => {
    if (moved) navigate(moved, { replace: true });
    else if (!match) navigate(readOnly ? READ_ONLY_HOME : HOME, { replace: true });
  }, [match, moved, readOnly]);

  const page = !moved && match ? (
    <ShellPage match={match} path={path} params={params} readOnly={readOnly}
      onLogout={onLogout} onChooseDestination={onChooseDestination} />
  ) : null;
  const bars = linkedTeam ? (
    <LinkedShellBars readOnlyTeam={readOnlyTeam} readNotice={readNotice} identityKey={identityKey}
      onCloseReadOnly={onCloseReadOnly} onChooseDestination={onChooseDestination} />
  ) : <LocalShellBars onLogout={onLogout} identityKey={identityKey} />;
  const actions = linkedTeam
    ? readOnlyTeam ? { readOnly: true, reason: existingTeamReadOnlyReason(readOnlyTeam) } : { readOnly: false, reason: "" }
    : localReadOnly;
  return (
    <ShellProviders linked={readOnly} readOnly={actions} onCloseReadOnly={onCloseReadOnly}>
      <ShellFrame fullBleed={Boolean(match?.route.fullBleed)} bars={bars}
        navbar={<Navbar onLogout={onLogout} onCloseReadOnly={onCloseReadOnly} readOnly={readOnly} />}>
        <PageTimingBoundary path={page ? path : ""} search={search}>{page}</PageTimingBoundary>
      </ShellFrame>
    </ShellProviders>
  );
}
