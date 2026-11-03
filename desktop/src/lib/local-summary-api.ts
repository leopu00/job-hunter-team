import { apiPath, json, type ApiFetch } from "../shell/api-bridge";
import { readDesktopPositionSummary } from "./existing-team-positions";
import { localTeamData } from "./local-team-data";

/**
 * The description on the card of the Swipe, when the profile shows the team of this computer: the route asks the
 * cloud for it, and a local profile has no cloud account, so the card stayed on its loading shapes. Here the
 * description is read from the team's own database (the position's detail), and a read that cannot be done answers
 * with its closed code, so the card says so instead of waiting.
 *
 *   GET /api/positions/<n>/summary   { summary: string | null }
 */
export function localSummaryApi(next: ApiFetch): ApiFetch {
  return async (input, init) => {
    if (!localTeamData()) return next(input, init);
    const path = apiPath(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const match = method === "GET" && path ? /^\/api\/positions\/(\d+)\/summary$/.exec(path) : null;
    if (!match) return next(input, init);
    const read = await readDesktopPositionSummary(match[1]!);
    if (read.source === "vps") return json({ summary: read.data });
    return json({ error: read.source === "unavailable" ? read.code : "desktop_transport_unavailable" }, 503);
  };
}
