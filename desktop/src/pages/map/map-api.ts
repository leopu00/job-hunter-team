import { resolveCityPins } from "@/lib/city-coords";
import type { PositionCoord } from "@/lib/local-queries";
import {
  buildLocationTree,
  getPositionLocations,
  getPositionsWithCoords,
  getPositionsWithoutCoords,
  type PositionNoCoord,
} from "@/lib/queries";
import { existingTeamView } from "../../lib/existing-team-readonly";
import { readVpsMapShared, resetVpsPositionsShared } from "../../lib/existing-team-positions-shared";
import type { DesktopVpsMapRow } from "../../lib/existing-team-positions";
import { apiPath, json, type ApiFetch } from "../../shell/api-bridge";

/**
 * The globe's data routes, answered in the desktop by the same web/lib/queries
 * functions the web routes call, with the user's session (RLS):
 *   web/app/api/positions/coords/route.ts     GET → getPositionsWithCoords()
 *   web/app/api/positions/no-coords/route.ts  GET → getPositionsWithoutCoords()
 *   web/app/api/positions/locations/route.ts  GET → getPositionLocations()
 * The web routes also check the sign-in (requireAuth) and the demo persona:
 * the desktop shell only exists signed in, and has no demo.
 *
 * While an existing team's VPS is only being read (lib/existing-team-readonly.ts)
 * the same three answers are built from the team's own positions, read once with
 * the core's `map` read (the fields the globe draws, in one reply for a team of a
 * few thousand), with the web's own placement: no cloud row is read. A
 * position is placed on its office when the list gives its coordinates, by its
 * city otherwise (the web's grid north of the city's centre; a jobs.db without
 * the office columns gives none), and one that cannot be placed goes to the
 * "without coordinates" list, as on the web. Nothing invented.
 */
const ROUTES: Record<string, () => Promise<unknown>> = {
  "/api/positions/coords": getPositionsWithCoords,
  "/api/positions/no-coords": getPositionsWithoutCoords,
  "/api/positions/locations": getPositionLocations,
};

type VpsRow = DesktopVpsMapRow;

/** The team's positions the web's map would show: not excluded. A failed read is an empty map. */
function vpsRows(now = Date.now()): Promise<VpsRow[]> {
  return readVpsMapShared(now).then((read) =>
    read.source === "vps" ? read.data.filter((row) => row.status !== "excluded") : []);
}

/** Forgets the shared read (a test, or a new view). */
export function resetMapVpsRead(): void {
  resetVpsPositionsShared();
}

const score = (row: VpsRow) => (typeof row.score === "number" ? row.score : null);
const finite = (value: unknown, limit: number) =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;

function pinsOf(rows: VpsRow[]) {
  return resolveCityPins(rows.map((row) => ({
    loc_country: row.loc_country ?? null,
    loc_city: row.loc_city ?? null,
    office_lat: finite(row.office_lat, 90),
    office_lon: finite(row.office_lon, 180),
    id: String(row.id),
    score: score(row),
    company: row.company ?? null,
    remote_type: row.remote_type ?? null,
  })));
}

/** getPositionsWithCoords, on the team's rows. */
export function vpsCoords(rows: VpsRow[]): PositionCoord[] {
  const pins = pinsOf(rows);
  return rows.flatMap((row, index) => {
    const pin = pins[index];
    return pin ? [{
      id: String(row.id),
      title: row.title,
      company: row.company,
      status: row.status,
      role_family: row.role_family ?? null,
      score: score(row),
      lat: pin.lat,
      lon: pin.lon,
      is_remote: row.remote_type === "full_remote",
      remote_type: row.remote_type ?? null,
      location: row.location ?? null,
      loc_country: row.loc_country ?? null,
      loc_city: row.loc_city ?? null,
      office_address: typeof row.office_address === "string" ? row.office_address : null,
      created_at: row.found_at ?? null,
    }] : [];
  });
}

/** getPositionsWithoutCoords, on the team's rows: the ones the globe cannot place. */
export function vpsNoCoords(rows: VpsRow[]): PositionNoCoord[] {
  const pins = pinsOf(rows);
  return rows.flatMap((row, index) => pins[index] ? [] : [{
    id: String(row.id),
    title: row.title ?? null,
    company: row.company ?? null,
    status: row.status,
    role_family: row.role_family ?? null,
    score: score(row),
    is_remote: row.remote_type === "full_remote",
    remote_type: row.remote_type ?? null,
    location: row.location ?? null,
    loc_country: row.loc_country ?? null,
    loc_city: row.loc_city ?? null,
    created_at: row.found_at ?? null,
  }]);
}

/** getPositionLocations, on the team's rows: country → city → positions. */
export function vpsLocations(rows: VpsRow[]) {
  return buildLocationTree(rows.map((row) => ({
    id: String(row.id),
    title: row.title ?? null,
    company: row.company ?? null,
    loc_country: row.loc_country ?? null,
    loc_city: row.loc_city ?? null,
    score: score(row),
  })));
}

const VPS_ROUTES: Record<string, (rows: VpsRow[]) => unknown> = {
  "/api/positions/coords": vpsCoords,
  "/api/positions/no-coords": vpsNoCoords,
  "/api/positions/locations": vpsLocations,
};

export function mapApi(next: ApiFetch): ApiFetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = apiPath(input) ?? "";
    const read = ROUTES[path];
    if (!read || method !== "GET") return next(input, init);
    if (existingTeamView()) return json(VPS_ROUTES[path](await vpsRows()));
    return json(await read());
  };
}
