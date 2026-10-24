import { useCallback, useEffect, useRef, useState } from "react";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import type { Locale } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import DashboardScreen from "./DashboardScreen";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { ExistingTeamDashboardError, loadExistingTeamDashboard } from "../../lib/existing-team-dashboard";
import { useConnectTeam } from "../../lib/connect-team";
import { useExistingTeamView } from "../../lib/existing-team-readonly";
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
  const existingTeam = useExistingTeamView() !== null;
  // A set-up profile with no team linked: the way to link the one that is already on a VPS.
  const connectTeam = useConnectTeam();

  const read = useCallback(() => {
    const mine = ++request.current;
    (existingTeam ? loadExistingTeamDashboard() : loadDashboard(supabase))
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

  if (load.state === "loading") return <DashboardSkeleton label={PAGE_STATES_TEXT[appLocale()].loadingDashboard} />;
  if (load.state === "failed") {
    // The core's own code and what it means, not a guess about the network.
    const failure = load.code
      ? describeError(load.code, { fallback: "existing_team_unavailable", locale: appLocale() })
      : null;
    return (
      <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
        {failure
          ? `${failure.text} ${failure.action} (${load.code})`
          : PAGE_STATES_TEXT[appLocale()].dashboardFailed}
      </p>
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
