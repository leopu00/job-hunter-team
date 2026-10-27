import { json, apiPath, type ApiFetch } from "../../shell/api-bridge";
import { readDesktopVpsDirectives } from "../../lib/existing-team-positions";
import { localTeamData } from "../../lib/local-team-data";
import { localTeamState } from "./local-team-state";

/**
 * The two reads of the Team page that a local profile answers from the team of this computer instead of the
 * cloud (it has no cloud account): the board of standing orders, in the shape the web's local branch uses
 * (`{ directives, source: "local" }`), and the status card's row (`{ state }`). Only GET, only in that mode;
 * every other method and route, and every other profile, go where they went. It stands in front of the routes
 * that would have answered from the cloud.
 */
export function localTeamApi(next: ApiFetch): ApiFetch {
  return async (input, init) => {
    if (!localTeamData()) return next(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = apiPath(input);
    if (method === "GET" && path === "/api/team-directives") {
      const read = await readDesktopVpsDirectives();
      return read.source === "vps"
        ? json({ directives: read.data.items, source: "local" })
        : json({ error: read.source === "unavailable" ? read.code : "not_in_desktop" }, 503);
    }
    if (method === "GET" && path === "/api/team-state") return json({ state: await localTeamState() });
    return next(input, init);
  };
}
