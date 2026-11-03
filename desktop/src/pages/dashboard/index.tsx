import { useCallback, useEffect, useRef, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import type { Locale } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";
import { cloudClient } from "../../lib/cloud-client";
import { readOnce, withReadDeadline } from "../../lib/read-deadline";
import CloudDataNotice, { useCloudDataBlocked } from "../../shell/CloudDataNotice";
import { useRefresh } from "../../shell/router";
import { SHELL_TEXT } from "../../shell/shell.i18n";
import type { PageProps } from "../types";
import DashboardScreen from "./DashboardScreen";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { ExistingTeamDashboardError, loadExistingTeamDashboard } from "../../lib/existing-team-dashboard";
import { useConnectTeam } from "../../lib/connect-team";
import { useExistingTeamView } from "../../lib/existing-team-readonly";
import { useLocalTeamData, useLocalTeamStopped } from "../../lib/local-team-data";
import { useTeamOff } from "../../lib/team-off";
import { isContainerOffCode } from "../../shell/team-off-failure";
import { PAGE_STATES_TEXT } from "../../lib/page-states.i18n";
import { CONNECT_TEAM_PROMPT_TEXT } from "./connect-team.i18n";
import { loadDashboard, type DashboardData } from "./load-dashboard";

type Load =
  | { state: "loading" }
  | { state: "ready"; data: DashboardData }
  | { state: "failed"; code: string | null };

/** web/app/(protected)/dashboard: the user's dashboard, read with their session. */
export default function DashboardPage(_props: PageProps) {
  const [locale] = useState<Locale>(readLocaleCookie);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const request = useRef(0);
  // An existing team that is only read: its own VPS answers, the cloud is not asked.
  // (and a local profile's team, read from this computer: no cloud account to ask)
  const localTeam = useLocalTeamData();
  const existingTeam = useExistingTeamView() !== null || localTeam;
  // The cloud notice is for a profile with nothing to show: the team of this computer is read from its own database.
  const blocked = useCloudDataBlocked() && !localTeam;
  // A set-up profile with no team linked: the way to link the one that is already on a VPS.
  const connectTeam = useConnectTeam();
  // The way to turn the team on is already on the screen (the banner of the app opened without the team, or the bar of a stopped team).
  const teamOff = useTeamOff();
  const stoppedBar = useLocalTeamStopped();

  const read = useCallback(() => {
    const mine = ++request.current;
    withReadDeadline(readOnce(`dashboard:${existingTeam ? "vps" : "cloud"}`, () => (existingTeam ? loadExistingTeamDashboard() : loadDashboard(cloudClient()))))
      .then((data) => {
        if (request.current === mine) setLoad({ state: "ready", data });
      })
      .catch((error: unknown) =>
        request.current === mine && setLoad((prev) =>
          prev.state === "ready"
            ? prev
            : { state: "failed", code: error instanceof ExistingTeamDashboardError ? error.code : null },
        ),
      );
  }, [existingTeam]);

  useEffect(() => {
    read();
    return () => { request.current++; };
  }, [read]);
  useRefresh(read);

  // No cloud session (a local profile): only the notice, no empty dashboard and no «connect a team» card.
  if (blocked) return <CloudDataNotice />;
  if (load.state === "loading") return <DashboardSkeleton label={PAGE_STATES_TEXT[appLocale()].loadingDashboard} />;
  if (load.state === "failed") {
    const text = PAGE_STATES_TEXT[appLocale()];
    // The team is off: not an error. One calm line (the banner or the bar above holds the single button that turns it
    // on), no red, no code, and no second «Try again»: the data come back by themselves once the team is on.
    if (isContainerOffCode(load.code) && (teamOff || stoppedBar)) {
      return (
        <div className="max-w-6xl mx-auto px-5 pt-8">
          <p role="status" data-testid="dashboard-team-off" className="text-[12px] text-[var(--color-muted)]">{text.dashboardTeamOff}</p>
        </div>
      );
    }
    // The core's own sentence and what to do, never its code: the code is for the log and the support report.
    const failure = load.code
      ? describeError(load.code, { fallback: "existing_team_unavailable", locale: appLocale() })
      : null;
    return (
      <div className="max-w-6xl mx-auto px-5 pt-8">
        <p role="alert" className="text-[12px]" style={{ color: "var(--color-red)" }}>
          {failure ? `${failure.text} ${failure.action}` : text.dashboardFailed}
        </p>
        <button
          type="button"
          className="mt-3 border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px]"
          onClick={() => { setLoad({ state: "loading" }); read(); }}
        >
          {SHELL_TEXT[appLocale()].retry}
        </button>
      </div>
    );
  }
  const prompt = connectTeam && !existingTeam ? CONNECT_TEAM_PROMPT_TEXT[appLocale()] : null;
  return (
    <>
      {prompt && (
        <section
          className="max-w-6xl mx-auto px-5 pt-6 flex flex-wrap items-center justify-between gap-3 text-[12px]"
          aria-label={prompt.title}
        >
          <div>
            <strong className="text-[var(--color-bright)]">{prompt.title}</strong>
            <p className="text-[var(--color-muted)]">{prompt.body}</p>
          </div>
          <button type="button" className="border border-[var(--color-border)] rounded px-3 py-1.5" onClick={() => connectTeam?.open()}>
            {prompt.button}
          </button>
        </section>
      )}
      <DashboardScreen data={load.data} locale={locale} />
    </>
  );
}
