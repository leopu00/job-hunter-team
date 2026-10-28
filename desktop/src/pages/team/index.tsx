import TeamLoading from "@/app/(protected)/team/loading";
import WebTeamPage from "@/app/(protected)/team/page";
import { TeamStatusControls } from "@/app/(protected)/team/MobileTeamStatus";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";
import { useState } from "react";
import CloserDesktopPanel from "../../closer-desktop/CloserDesktopPanel";
import { desktopCopy } from "../../closer-desktop/text";
import TeamControlsLink from "./TeamControlsLink";
import { appLocale } from "../../lib/app-locale";
import { useLocalTeamData } from "../../lib/local-team-data";
import { LOCAL_TEAM_DATA_TEXT } from "../../lib/local-team-data.i18n";

/**
 * The web's /team (web/app/(protected)/team/page.tsx), run as it is: the
 * team's status, the activity charts over the chosen range, the board of
 * standing orders. The separate native assisted-browser panel uses only the
 * authenticated fixed desktop bridge, not the web team's command routes.
 * The range lives in the query string, so the page
 * reads again when it changes, keeping the screen meanwhile.
 */
export default function TeamPage({ search }: PageProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const searchParams = Object.fromEntries(search);
  // A local profile has no cloud account: the status, the standing orders and the activity are cloud data.
  const localTeam = useLocalTeamData();
  return (
    <>
      {/* on the right of the page's first row (the breadcrumb), not above it */}
      <div className="closer-desktop-entry-row">
        <button type="button" className="closer-desktop-entry" aria-expanded={browserOpen}
          onClick={() => setBrowserOpen((open) => !open)}>{desktopCopy().open}</button>
      </div>
      {browserOpen && <CloserDesktopPanel onClose={() => setBrowserOpen(false)} />}
      {localTeam ? (
        <p role="status" data-testid="team-local-profile" className="max-w-3xl mx-auto px-5 pt-8 text-[13px] text-[var(--color-muted)]">
          {LOCAL_TEAM_DATA_TEXT[appLocale()].teamPage}
        </p>
      ) : (
      // the status card links to the agents' panel instead of stopping the team itself
      <TeamStatusControls.Provider value={<TeamControlsLink />}>
        <ServerPage
          runKey={search.toString()}
          render={() => WebTeamPage({ searchParams: Promise.resolve(searchParams) })}
          fallback={<TeamLoading />}
        />
      </TeamStatusControls.Provider>
      )}
    </>
  );
}
