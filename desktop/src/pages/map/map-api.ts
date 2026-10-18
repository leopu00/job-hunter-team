import { resolveCityPins } from "@/lib/city-coords";
import type { PositionCoord } from "@/lib/local-queries";
import {
  buildLocationTree,
  getPositionLocations,
  getPositionsWithCoords,
  getPositionsWithoutCoords,
  type PositionNoCoord,
} from "@/lib/queries";
import type { PositionWithScore } from "@/lib/types";
import { existingTeamReadOnly } from "../../lib/existing-team-readonly";
import { readDesktopVpsPositions } from "../../lib/existing-team-positions";
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
 * the same three answers are built from the team's own positions, the list the
 * Posizioni page reads, with the web's own placement: no cloud row is read. The
 * core's list carries no office coordinates, so every position is placed by its
 * city (the web's grid north of the city's centre) and one whose city cannot be
 * placed goes to the "without coordinates" list, as on the web. Nothing invented.
 */
const ROUTES: Record<string, () => Promise<unknown>> = {
  "/api/positions/coords": getPositionsWithCoords,
  "/api/positions/no-coords": getPositionsWithoutCoords,
  "/api/positions/locations": getPositionLocations,
};

/** All the team's positions in one bounded read per page (the native side pages by 600). */
const ALL_ROWS = { limit: 20_000 } as const;
/** The globe asks for its three routes together (coords twice): one read of the VPS serves them. */
const SHARED_READ_MS = 5_000;

type VpsRow = Pick<PositionWithScore, "id" | "title" | "company" | "status" | "role_family" | "location" |
  "remote_type" | "loc_country" | "loc_city"> & { score?: number | null; found_at?: string | null };

let shared: { at: number; rows: Promise<VpsRow[]> } | null = null;

/** The team's positions the web's map would show: not excluded. A failed read is an empty map. */
function vpsRows(now = Date.now()): Promise<VpsRow[]> {
  if (shared && now - shared.at < SHARED_READ_MS) return shared.rows;
  const rows = readDesktopVpsPositions(ALL_ROWS).then((read) =>
    read.source === "vps" ? (read.data as VpsRow[]).filter((row) => row.status !== "excluded") : []);
  shared = { at: now, rows };
  return rows;
}

/** Forgets the shared read (a test, or a new view). */
export function resetMapVpsRead(): void {
  shared = null;
}

const score = (row: VpsRow) => (typeof row.score === "number" ? row.score : null);

function pinsOf(rows: VpsRow[]) {
  return resolveCityPins(rows.map((row) => ({
    loc_country: row.loc_country ?? null,
    loc_city: row.loc_city ?? null,
    office_lat: null,
    office_lon: null,
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
      office_address: null,
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
    if (existingTeamReadOnly()) return json(VPS_ROUTES[path](await vpsRows()));
    return json(await read());
  };
}
