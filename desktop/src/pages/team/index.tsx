import TeamLoading from "@/app/(protected)/team/loading";
import WebTeamPage from "@/app/(protected)/team/page";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";

/**
 * The web's /team (web/app/(protected)/team/page.tsx), run as it is: the
 * team's status, the activity charts over the chosen range, the board of
 * standing orders. As on the web cloud deploy, the only command it can give
 * the team is the protected emergency stop; its routes are answered by
 * pages/team/team-api.ts. The range lives in the query string, so the page
 * reads again when it changes, keeping the screen meanwhile.
 */
export default function TeamPage({ search }: PageProps) {
  const searchParams = Object.fromEntries(search);
  return (
    <ServerPage
      runKey={search.toString()}
      render={() => WebTeamPage({ searchParams: Promise.resolve(searchParams) })}
      fallback={<TeamLoading />}
    />
  );
}
