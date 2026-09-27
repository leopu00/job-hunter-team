import WebAnalistaPage from "@/app/(protected)/team/analista/page";
import WebCriticoPage from "@/app/(protected)/team/critico/page";
import TeamLoading from "@/app/(protected)/team/loading";
import WebActivityLogPage from "@/app/(protected)/team/log/page";
import ScorerLoading from "@/app/(protected)/team/scorer/loading";
import WebScorerPage from "@/app/(protected)/team/scorer/page";
import ScoutLoading from "@/app/(protected)/team/scout/loading";
import WebScoutPage from "@/app/(protected)/team/scout/page";
import WebScrittorePage from "@/app/(protected)/team/scrittore/page";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";

/**
 * The pages under the web's /team, run as they are. Scout, Scorer and the
 * activity log are server pages (async, through ServerPage); Analista,
 * Scrittore and Critico are client pages that read their own /api route
 * (answered by pages/team/team-api.ts) and render directly. Suspense is not
 * needed around them: they show their own loading state.
 */
export function TeamLogPage(_props: PageProps) {
  return <ServerPage render={() => WebActivityLogPage()} fallback={<TeamLoading />} />;
}

export function TeamScoutPage(_props: PageProps) {
  return <ServerPage render={() => WebScoutPage()} fallback={<ScoutLoading />} />;
}

export function TeamScorerPage(_props: PageProps) {
  return <ServerPage render={() => WebScorerPage()} fallback={<ScorerLoading />} />;
}

export function TeamAnalistaPage(_props: PageProps) {
  return <WebAnalistaPage />;
}

export function TeamScrittorePage(_props: PageProps) {
  return <WebScrittorePage />;
}

export function TeamCriticoPage(_props: PageProps) {
  return <WebCriticoPage />;
}

