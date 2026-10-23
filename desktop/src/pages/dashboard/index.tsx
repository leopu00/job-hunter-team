import { useCallback, useEffect, useState } from "react";
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
import { useExistingTeamView } from "../../lib/existing-team-readonly";
import { PAGE_STATES_TEXT } from "../../lib/page-states.i18n";
import { loadDashboard, type DashboardData } from "./load-dashboard";

type Load =
  | { state: "loading" }
  | { state: "ready"; data: DashboardData }
  | { state: "failed"; code: string | null };

/** web/app/(protected)/dashboard: the user's dashboard, read with their session. */
export default function DashboardPage(_props: PageProps) {
  const [locale] = useState<Locale>(readLocaleCookie);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // An existing team that is only read: its own VPS answers, the cloud is not asked.
  const existingTeam = useExistingTeamView() !== null;

  const read = useCallback(() => {
    (existingTeam ? loadExistingTeamDashboard() : loadDashboard(supabase))
      .then((data) => setLoad({ state: "ready", data }))
      .catch((error: unknown) =>
        setLoad((prev) =>
          prev.state === "ready"
            ? prev
            : { state: "failed", code: error instanceof ExistingTeamDashboardError ? error.code : null },
        ),
      );
  }, [existingTeam]);

  useEffect(read, [read]);
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
  return <DashboardScreen data={load.data} locale={locale} />;
}
