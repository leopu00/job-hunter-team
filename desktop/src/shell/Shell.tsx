import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DashboardI18nProvider, useDashboardT } from "@/app/components/DashboardI18n";
import MainChrome from "@/app/components/MainChrome";
import Link from "../web-shims/next-link";
import { DesktopWriteProvider } from "@/lib/desktop-write";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";
import { useLocalTeamData, useLocalTeamSavedAt } from "../lib/local-team-data";
import { LOCAL_TEAM_DATA_TEXT } from "../lib/local-team-data.i18n";
import { LocalTeamStoppedBar } from "./LocalTeamStoppedBar";
import { signOut } from "../lib/supabase";
import { appLocale } from "../lib/app-locale";
import {
  existingTeamNotFullReason,
  existingTeamReadOnlyReason,
  useExistingTeamReadNotice,
  useExistingTeamReadOnly,
  useExistingTeamView,
} from "../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { LeaveReadOnlyContext } from "../lib/leave-read-only";
import { ChooseDestinationContext } from "../lib/choose-destination";
import { ConnectInFull } from "./ConnectInFull";
import { VpsLinkBar } from "./VpsLinkBar";
import { SHELL_TEXT } from "./shell.i18n";
import { MailRotationBanner } from "./MailRotationBanner";
import { SignOutContext } from "../lib/account-actions";
import { NewVersionBanner } from "./NewVersionBanner";
import { TeamUpdateNotice } from "./TeamUpdateNotice";
import { TeamOffBanner } from "./TeamOffBanner";
import { LocalTeamOwnerBanner } from "./LocalTeamOwnerBanner";
import { WriteAccessRestoredBanner } from "./WriteAccessRestoredBanner";
import { AwayGreeting } from "./AwayGreeting";
import NavStrip from "./NavStrip";
import PageErrorBoundary from "./PageErrorBoundary";
import { EXIT_OPEN_EVENT } from "../lib/app-exit";
import { APP_EXIT_TEXT } from "../components/AppExitDialog.i18n";
import { beginPageLoad } from "../lib/page-timing";
import { forgetReadsInFlight } from "../lib/read-deadline";
import { matchRoute, navigate, refresh, useLocation } from "./router";
import DocumentPreviewHost from "../pages/positions/DocumentPreviewHost";
import { HOME, READ_ONLY_HOME, READ_ONLY_ROUTES, ROUTES } from "./routes";
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

/** A full-bleed page's column: as tall as the window, the navbar and its bars on top, the page in the rest, no page scroll. */
const FULL_BLEED_COLUMN: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  height: "calc(100svh / var(--zoom, 1))",
  overflow: "hidden",
};

export default function Shell({ onLogout, onCloseReadOnly, onChooseDestination, identityKey }: ShellProps) {
  const { path, search } = useLocation();
  // The existing team's VPS is what the pages read, in either kind of link; only the read-only one
  // disables what writes (a team connected in full has the same pages, with their controls on).
  const linkedTeam = useExistingTeamView();
  const readOnlyTeam = useExistingTeamReadOnly();
  const notFullReason = readOnlyTeam ? existingTeamNotFullReason(readOnlyTeam) : null;
  const readNotice = useExistingTeamReadNotice();
  const readOnly = linkedTeam !== null;
  // A profile with no cloud account: the pages show the team of this computer, which they only read.
  const localTeam = useLocalTeamData();
  // The page of one position is the exception: what the person says or asks there is written in the team's own
  // database through the native command (lib/local-judgement-api.ts), so its controls stay on.
  const onPositionPage = /^\/positions\/[^/]+\/?$/.test(path);
  // The pages show what the team saved while it is off: nothing that needs the team is written from them, the position page included.
  const savedOnShow = useLocalTeamSavedAt() !== null;
  const localReadOnly = useMemo(
    () =>
      localTeam && savedOnShow
        ? { readOnly: true, teamOff: true, reason: LOCAL_TEAM_DATA_TEXT[appLocale()].savedHint }
        : localTeam && !onPositionPage
        ? { readOnly: true, reason: LOCAL_TEAM_DATA_TEXT[appLocale()].readOnly }
        : // on the page of a position the authorisation of an application is on too, in two steps: the host's preview
          // (summary, destination, digest), then the person's click carrying the digest and the destination back
          { readOnly: false, reason: "", ...(localTeam ? { applyTwoStep: true } : {}) },
    [localTeam, onPositionPage, savedOnShow],
  );
  const match = matchRoute(readOnly ? READ_ONLY_ROUTES : ROUTES, path);
  // The old address of a page that is now a section of Settings: it goes on to the section, before anything is drawn.
  const moved = redirectFor(path, search);
  const params = useMemo(() => new URLSearchParams(search), [search]);

  // The shell is made again for every account (it is keyed by it): a read the last account started is never the one the next waits for.
  useEffect(() => {
    forgetReadsInFlight();
    return forgetReadsInFlight;
  }, []);

  // An old address goes on to its section; an empty or unknown hash lands on the dashboard.
  useEffect(() => {
    if (moved) navigate(moved, { replace: true });
    else if (!match) navigate(readOnly ? READ_ONLY_HOME : HOME, { replace: true });
  }, [match, moved, readOnly]);

  // How long the page of a linked team takes to show its data (the load-times log, on this computer).
  useEffect(() => {
    beginPageLoad(readOnly ? path : "");
  }, [path, search, readOnly]);

  const Page = moved ? undefined : match?.route.page;
  const page = Page && match && (
    <SignOutContext.Provider value={onLogout ?? null}>
      <ChooseDestinationContext.Provider value={onChooseDestination ?? null}>
        <PageErrorBoundary key={path} onHome={() => navigate(readOnly ? READ_ONLY_HOME : HOME)}>
          <Page params={match.params} search={params} />
        </PageErrorBoundary>
      </ChooseDestinationContext.Provider>
      {/* the preview of a CV or a letter lives with the page (closed when the page is left) and with the signed-in app (closed with the account) */}
      <DocumentPreviewHost key={`preview:${path}`} />
    </SignOutContext.Provider>
  );
  if (linkedTeam) {
    const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
    const navbar = <Navbar onLogout={onLogout} onCloseReadOnly={onCloseReadOnly} readOnly />;
    const strips = (
      <>
        {readOnlyTeam && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)]">
            <p
              role="status"
              data-testid="existing-team-readonly-banner"
              className="min-w-0 flex-1 text-[11px] text-[var(--color-muted)]"
            >
              <strong className="text-[var(--color-bright)]">{existingTeamReadOnlyReason(readOnlyTeam)}.</strong>{" "}
              {text.banner} <span data-testid="existing-team-judgement-how">{text.judgementHow}</span>
              {notFullReason && <>{" "}<span data-testid="existing-team-readonly-why">{notFullReason}</span></>}
            </p>
            <ConnectInFull />
          </div>
        )}
        {/* the sort the VPS cannot do is told only on the read-only link: a team connected in full is not «read only» */}
        {readOnlyTeam && readNotice === "sort_last_action" && (
          <p role="status" data-testid="existing-team-readonly-notice" className="px-4 py-2 text-[11px] text-[var(--color-muted)]">
            {text.sortLastAction}
          </p>
        )}
        <VpsLinkBar onCloseReadOnly={onCloseReadOnly} onChooseDestination={onChooseDestination} />
        <WriteAccessRestoredBanner />
        {identityKey && <AwayGreeting identityKey={identityKey} />}
      </>
    );
    return (
      <DashboardI18nProvider>
        <ReadOnlyActionsProvider value={readOnlyTeam ? { readOnly: true, reason: existingTeamReadOnlyReason(readOnlyTeam) } : { readOnly: false, reason: "" }}>
          <LeaveReadOnlyContext.Provider value={onCloseReadOnly ?? null}>
          {match?.route.fullBleed ? (
            // a full-bleed page: the same window-tall column as in the full shell; the read-only bars under the navbar take a third of the window at most and scroll past it
            <div style={FULL_BLEED_COLUMN}>
              {navbar}
              <div className="shrink-0 max-h-[34%] overflow-y-auto" data-testid="full-bleed-bars">
                {strips}
              </div>
              <main className="relative min-h-0 flex-1" data-testid="full-bleed">
                {page}
              </main>
            </div>
          ) : (
            <div style={{ position: "relative", zIndex: 1 }}>
              {navbar}
              {strips}
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
        <DesktopWriteProvider value={{ canChange: true }}>
          <ReadOnlyActionsProvider value={localReadOnly}>
          <div style={FULL_BLEED_COLUMN}>
            <Navbar onLogout={onLogout} />
            {/* The bars take what they need up to a third of the window and scroll beyond it: the page under them always keeps room, and the navbar above is never pushed out. */}
            <div className="shrink-0 max-h-[34%] overflow-y-auto" data-testid="full-bleed-bars">
              <MailRotationBanner />
              <NewVersionBanner />
          <TeamUpdateNotice />
              <TeamOffBanner />
              <LocalTeamOwnerBanner onSwitch={onLogout} />
              <LocalTeamStoppedBar />
              <WriteAccessRestoredBanner />
        {identityKey && <AwayGreeting identityKey={identityKey} />}
            </div>
            <main className="relative min-h-0 flex-1" data-testid="full-bleed">
              {page}
            </main>
          </div>
          </ReadOnlyActionsProvider>
        </DesktopWriteProvider>
      </DashboardI18nProvider>
    );
  }
  return (
    <DashboardI18nProvider>
      <DesktopWriteProvider value={{ canChange: true }}>
        <ReadOnlyActionsProvider value={localReadOnly}>
        <div style={{ position: "relative", zIndex: 1 }}>
        <Navbar onLogout={onLogout} />
          <MailRotationBanner />
          <NewVersionBanner />
          <TeamUpdateNotice />
          <TeamOffBanner />
          <LocalTeamOwnerBanner onSwitch={onLogout} />
          <LocalTeamStoppedBar />
            <WriteAccessRestoredBanner />
        {identityKey && <AwayGreeting identityKey={identityKey} />}
          <MainChrome>{page}</MainChrome>
        </div>
        </ReadOnlyActionsProvider>
      </DesktopWriteProvider>
    </DashboardI18nProvider>
  );
}
