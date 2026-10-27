import * as analistaActivity from "@/app/api/analista/activity/route";
import * as critico from "@/app/api/critico/route";
import * as scorerActivity from "@/app/api/scorer/activity/route";
import * as scoutActivity from "@/app/api/scout/activity/route";
import * as scrittoreActivity from "@/app/api/scrittore/activity/route";
import * as teamDirectives from "@/app/api/team-directives/route";
import * as emergencyStop from "./emergency-stop";
import * as teamSend from "@/app/api/team/send/route";
import * as teamStatus from "@/app/api/team/status/route";
import { apiPath, json, webRoutes, type ApiFetch } from "../../shell/api-bridge";
import { localTeamData } from "../../lib/local-team-data";
import { readDesktopVpsDirectives } from "../../lib/existing-team-positions";

/**
 * The /team pages' routes, run as the web routes themselves. They take the
 * web cloud deploy's branch, so they do there what they do here:
 *   GET  /api/{scout,scorer,analista,scrittore}/activity, /api/critico
 *        the agents' activity, read with the user's session
 *   GET  /api/team/status        each agent's state, from the team_commands
 *        history (not tmux)
 *   *    /api/team-directives    the board of standing orders (team_directives)
 *   POST /api/team-state/emergency-stop
 *        the stop of the team that needs no confirmation: the single door
 *        (request_action, team.emergency_stop) on the user's own session; the
 *        limits and the record are the database's, as on the web (./emergency-stop)
 *   POST /api/team/send          refused (403 read_only), as on the cloud: a
 *        keystroke into an agent's tmux belongs to the machine that runs it
 */
export function teamApi(next: ApiFetch): ApiFetch {
  const routes = webRoutes(
    {
      "/api/scout/activity": scoutActivity,
      "/api/scorer/activity": scorerActivity,
      "/api/analista/activity": analistaActivity,
      "/api/scrittore/activity": scrittoreActivity,
      "/api/critico": critico,
      "/api/team/status": teamStatus,
      "/api/team-directives": teamDirectives,
      "/api/team-state/emergency-stop": emergencyStop,
      "/api/team/send": teamSend,
    },
    next,
  );
  // A profile with no cloud account reads the board from the team's own database, as the web's local branch does
  // (`{ directives, source: "local" }`); anything else of the route, and every other route, goes where it went.
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (localTeamData() && method === "GET" && apiPath(input) === "/api/team-directives") {
      const read = await readDesktopVpsDirectives();
      return read.source === "vps"
        ? json({ directives: read.data.items, source: "local" })
        : json({ error: read.source === "unavailable" ? read.code : "not_in_desktop" }, 503);
    }
    return routes(input, init);
  };
}
