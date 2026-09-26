import { getPositionLocations, getPositionsWithCoords, getPositionsWithoutCoords } from "@/lib/queries";
import { apiPath, json, type ApiFetch } from "../../shell/api-bridge";

/**
 * The globe's data routes, answered in the desktop by the same web/lib/queries
 * functions the web routes call, with the user's session (RLS):
 *   web/app/api/positions/coords/route.ts     GET → getPositionsWithCoords()
 *   web/app/api/positions/no-coords/route.ts  GET → getPositionsWithoutCoords()
 *   web/app/api/positions/locations/route.ts  GET → getPositionLocations()
 * The web routes also check the sign-in (requireAuth) and the demo persona:
 * the desktop shell only exists signed in, and has no demo.
 */
const ROUTES: Record<string, () => Promise<unknown>> = {
  "/api/positions/coords": getPositionsWithCoords,
  "/api/positions/no-coords": getPositionsWithoutCoords,
  "/api/positions/locations": getPositionLocations,
};

export function mapApi(next: ApiFetch): ApiFetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = ROUTES[apiPath(input) ?? ""];
    if (read && method === "GET") return json(await read());
    return next(input, init);
  };
}
