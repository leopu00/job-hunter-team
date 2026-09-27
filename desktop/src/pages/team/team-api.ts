import * as analistaActivity from "@/app/api/analista/activity/route";
import * as critico from "@/app/api/critico/route";
import * as scorerActivity from "@/app/api/scorer/activity/route";
import * as scoutActivity from "@/app/api/scout/activity/route";
import * as scrittoreActivity from "@/app/api/scrittore/activity/route";
import * as teamDirectives from "@/app/api/team-directives/route";
import * as emergencyStop from "@/app/api/team-state/emergency-stop/route";
import * as teamSend from "@/app/api/team/send/route";
import * as teamStatus from "@/app/api/team/status/route";
import { webRoutes, type ApiFetch } from "../../shell/api-bridge";

/**
 * The /team pages' routes, run as the web routes themselves. They take the
 * web cloud deploy's branch, so they do there what they do here:
 *   GET  /api/{scout,scorer,analista,scrittore}/activity, /api/critico
 *        the agents' activity, read with the user's session
 *   GET  /api/team/status        each agent's state, from the team_commands
 *        history (not tmux)
 *   *    /api/team-directives    the board of standing orders (team_directives)
 *   POST /api/team-state/emergency-stop
 *        the one team command the cloud allows: should_run=false, session
 *        only, confirmation and rate limit as on the web
 *   POST /api/team/send          refused (403 read_only), as on the cloud: a
 *        keystroke into an agent's tmux belongs to the machine that runs it
 */
export function teamApi(next: ApiFetch): ApiFetch {
  return webRoutes(
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
}
