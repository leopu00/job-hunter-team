import { invoke, isTauri } from "@tauri-apps/api/core";
import { existingTeamConnectionKey, reportPositionsNotice } from "./existing-team-readonly";
import { REFRESH_EVENT } from "../shell/router";
// The pages show an empty list for a list that could not be read, as the web does for a query
// that fails; the header (shell/VpsLinkBar) is how the person is told it was not empty, and why.
import { reportVpsRead } from "./vps-link";
import type {
  DesktopVpsPositionsWindow,
  DesktopVpsRead,
} from "../../../web/lib/desktop-vps-positions";
import type { DashboardStats, PositionWithScore } from "../../../web/lib/types";
import type { DashboardPosition } from "./dashboard-data";
import type {
  PositionDetail,
  PositionFacet,
  PositionFilterOpts,
} from "../../../web/lib/queries";

export type {
  DesktopVpsPositionsWindow,
  DesktopVpsRead,
} from "../../../web/lib/desktop-vps-positions";

/**
 * Fixed native read command. The native side resolves the account-scoped
 * binding and target before every request. The renderer supplies only a
 * bounded projection and typed filters; it never supplies SQL, a host, or a
 * container identifier.
 */
const COMMAND = "existing_team_positions_read";

type Request =
  | { op: "list"; filters?: PositionFilterOpts }
  | { op: "detail"; id: string }
  | { op: "facets" }
  | { op: "stats" }
  | { op: "map"; offset: number };

function listRequest(opts?: PositionFilterOpts): Request {
  return opts === undefined ? { op: "list" } : { op: "list", filters: opts };
}

function safeCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value)
    ? value
    : "runtime_data_unavailable";
}

function reply<T>(value: unknown): DesktopVpsRead<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { source: "unavailable", code: "desktop_bad_reply" };
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true && "data" in record) {
    return { source: "vps", data: record.data as T };
  }
  if (record.ok === false) {
    return { source: "unavailable", code: safeCode(record.error) };
  }
  return { source: "unavailable", code: "desktop_bad_reply" };
}

async function read<T>(request: Request): Promise<DesktopVpsRead<T>> {
  // Browser/web tests stay on their established data paths. In the packaged
  // desktop, absence or drift of the native binding fails closed below.
  if (!isTauri()) return { source: "not_desktop" };
  let result: DesktopVpsRead<T>;
  try {
    const answer = await invoke<unknown>(COMMAND, { request });
    result = reply<T>(answer);
    // A reply that says ok but carries no data is not a contact: the header says the reply was bad
    // (it is the one case the old «list not read» line had that a native failure code does not cover).
    reportVpsRead(result.source === "unavailable" && (answer as { ok?: unknown } | null)?.ok === true ? { ok: false, error: result.code } : answer);
  } catch {
    reportVpsRead({ ok: false, error: "desktop_transport_unavailable" });
    result = { source: "unavailable", code: "desktop_transport_unavailable" };
  }
  return result;
}

function arrayRead<T>(value: DesktopVpsRead<unknown>): DesktopVpsRead<T[]> {
  if (value.source !== "vps") return value;
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
    return { source: "unavailable", code: "desktop_bad_reply" };
  }
  const items = (value.data as Record<string, unknown>).items;
  return Array.isArray(items)
    ? { source: "vps", data: items as T[] }
    : { source: "unavailable", code: "desktop_bad_reply" };
}

/**
 * The team's jobs.db has no `legacy_id` column (it is the cloud's name for the
 * box row's id), so the core sends null for it, and the web's detail page shows
 * "Feedback e richieste" only for a position with one. The web reads such a row
 * the same way it reads a local workspace: the row's numeric id is the box id
 * (COALESCE(p.legacy_id, p.id) in local-queries, `applyLegacyId` in the page).
 * A legacy_id the core does send is kept as it is.
 */
function withBoxId(detail: PositionDetail): PositionDetail {
  const { position } = detail;
  if (!position || typeof position !== "object" || position.legacy_id != null) return detail;
  const id = typeof position.id === "string" && /^[1-9]\d{0,14}$/.test(position.id) ? Number(position.id) : null;
  return id === null ? detail : { ...detail, position: { ...position, legacy_id: id } };
}

function detailRead(value: DesktopVpsRead<unknown>): DesktopVpsRead<PositionDetail | null> {
  if (value.source !== "vps") return value;
  if (value.data === null) return { source: "vps", data: null };
  return typeof value.data === "object" && !Array.isArray(value.data) &&
    "position" in value.data
    ? { source: "vps", data: withBoxId(value.data as PositionDetail) }
    : { source: "unavailable", code: "desktop_bad_reply" };
}

function readPositionsPage(
  opts?: PositionFilterOpts,
): Promise<DesktopVpsRead<PositionWithScore[]>> {
  return read<unknown>(listRequest(opts)).then(arrayRead<PositionWithScore>);
}

/**
 * The most rows the native side returns in one reply (its request bound, and
 * the 2 MiB it lets a reply weigh). The web's list asks for up to 2000 at once
 * and filters and pages them itself, so a larger `limit` is read in order, one
 * bounded reply after the other, and joined: the same rows the web's own query
 * returns, never a silent empty list for a request the native side refuses.
 */
const NATIVE_PAGE_ROWS = 600;

export async function readDesktopVpsPositions(
  opts?: PositionFilterOpts,
): Promise<DesktopVpsRead<PositionWithScore[]>> {
  const wanted = opts?.limit;
  if (wanted === undefined || !Number.isInteger(wanted) || wanted <= NATIVE_PAGE_ROWS) {
    return readPositionsPage(opts);
  }
  const start = opts?.offset ?? 0;
  const rows: PositionWithScore[] = [];
  while (rows.length < wanted) {
    const size = Math.min(NATIVE_PAGE_ROWS, wanted - rows.length);
    const page = await readPositionsPage({ ...opts, limit: size, offset: start + rows.length });
    if (page.source !== "vps") return page;
    rows.push(...page.data);
    if (page.data.length < size) break;
  }
  return { source: "vps", data: rows };
}

/** What the globe needs of a position: the core's `map` read gives these and nothing more. */
export type DesktopVpsMapRow = Pick<PositionWithScore, "id" | "title" | "company" | "status" | "role_family" | "location" |
  "remote_type" | "loc_country" | "loc_city"> & {
  score?: number | null;
  found_at?: string | null;
  office_lat?: number | null;
  office_lon?: number | null;
  office_address?: string | null;
};

/** The most replies the globe's read follows: 600 KB each at the most, so far more positions than a team has. */
const MAP_REPLIES_MAX = 40;

/**
 * Every position the globe draws (the excluded ones are left out by the core), in the list's order.
 * One reply carries as many as fit in the core's byte budget (a team of a few thousand is one reply),
 * and `next` says where the following one starts: the globe waits for one request, not for six.
 */
export async function readDesktopVpsMap(): Promise<DesktopVpsRead<DesktopVpsMapRow[]>> {
  const rows: DesktopVpsMapRow[] = [];
  let offset = 0;
  for (let replies = 0; replies < MAP_REPLIES_MAX; replies += 1) {
    const value = await read<unknown>({ op: "map", offset });
    if (value.source !== "vps") return value;
    const data = value.data;
    if (!isRecord(data) || !Array.isArray(data.items) || !isCount(data.total) || !(data.next === null || isCount(data.next))) {
      return { source: "unavailable", code: "desktop_bad_reply" };
    }
    rows.push(...(data.items as DesktopVpsMapRow[]));
    if (data.next === null) return { source: "vps", data: rows };
    // A reply that does not move forward would loop: the read is a failed one.
    if (data.next <= offset) return { source: "unavailable", code: "desktop_bad_reply" };
    offset = data.next;
  }
  return { source: "unavailable", code: "desktop_bad_reply" };
}

/**
 * The columns the core's rows do not carry (the team's last action is not in
 * its projection): sorting by them would silently keep the date order, so the
 * date order is asked for by name and the person is told.
 */
const SORTS_THE_CORE_CANNOT_DO = new Set(["last_action_at", "last_action_by"]);

/**
 * The newest positions on the team's VPS, found first, at most `limit`: the new-position
 * notifications' read (lib/notify). The same read-only list the pages use, with no notice for the
 * pages: it runs in the background and must not change what a page says.
 */
export function readDesktopVpsNewestPositions(limit = 50): Promise<DesktopVpsRead<PositionWithScore[]>> {
  return readPositionsPage({ sort: "found_at", dir: "desc", limit, offset: 0 });
}

/**
 * One page, as the core serves it: at most `limit` light rows from `offset`, and
 * the total that match, so the person pages through the team's positions
 * without the app holding them all. `limit` is the native bound (600) at most.
 */
export async function readDesktopVpsPositionsWindow(
  opts: PositionFilterOpts,
): Promise<DesktopVpsRead<DesktopVpsPositionsWindow>> {
  const substituted = opts.sort !== undefined && SORTS_THE_CORE_CANNOT_DO.has(opts.sort);
  const value = await read<unknown>(listRequest(substituted ? { ...opts, sort: "found_at" } : opts));
  // The notice about the sort is for a list that has rows: over an empty one it
  // would sit on top of a page with nothing to sort.
  const rows = value.source === "vps" ? (value.data as { total?: unknown } | null)?.total : undefined;
  reportPositionsNotice(value.source === "vps" && substituted && typeof rows === "number" && rows > 0 ? "sort_last_action" : null);
  if (value.source !== "vps") return value;
  const data = value.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { source: "unavailable", code: "desktop_bad_reply" };
  }
  const { items, total, scamSection } = data as Record<string, unknown>;
  // The count of the «suspicious» section rides with the page when the core sent one.
  const section =
    typeof scamSection === "number" && Number.isInteger(scamSection) && scamSection >= 0 ? { scamSection } : {};
  return Array.isArray(items) && typeof total === "number" && Number.isInteger(total) && total >= 0
    ? { source: "vps", data: { items: items as PositionWithScore[], total, ...section } }
    : { source: "unavailable", code: "desktop_bad_reply" };
}

/** What the core's `stats` op serves: exact counts, and the bounded rows the charts draw. */
export interface DesktopVpsStats {
  stats: DashboardStats;
  /** Over the active (not excluded) positions. */
  distribution: {
    active: number;
    withScore: number;
    avgScore: number | null;
    buckets: Array<{ min: number; max: number; count: number }>;
  };
  sources: Array<{ source: string; count: number }>;
  types: Array<{ role_family: string | null; count: number }>;
  /** The newest scored positions, whatever the charts got. */
  recent: DashboardPosition[];
  /** `included` of the `of` active positions: the charts' rows. */
  points: { rows: DashboardPosition[]; included: number; of: number };
  /** `included` of the `of` submissions: the timeline's events. */
  events: {
    rows: Array<{ appliedAt: string; response: string | null; responseAt: string | null }>;
    included: number;
    of: number;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function boundedPart(value: unknown): value is { rows: unknown[]; included: number; of: number } {
  return isRecord(value) && Array.isArray(value.rows) && isCount(value.included) && isCount(value.of);
}

/**
 * The sidebar's facets and the dashboard's numbers weigh most of what a page of the linked team reads
 * (all the positions, light; the counts), and several pages ask for them one after the other. They are
 * kept for CACHED_READ_MS, for the connection they were read on (existingTeamConnectionKey: this opening
 * of the view, its account, VPS and team) and nothing is kept with the view closed. A page asked to
 * read again (Aggiorna, or router.refresh() after a change the person made) forgets them. A read that
 * did not succeed is not kept.
 */
const CACHED_READ_MS = 30_000;
const cached = new Map<string, { key: string; at: number; read: Promise<DesktopVpsRead<unknown>> }>();

if (typeof window !== "undefined") window.addEventListener(REFRESH_EVENT, () => cached.clear());

/** Forgets the kept reads (a test, or a new view). */
export function resetCachedReads(): void {
  cached.clear();
}

function readOnce<T>(request: Request): Promise<DesktopVpsRead<T>> {
  const key = existingTeamConnectionKey();
  if (key === null) return read<T>(request);
  const now = Date.now();
  const kept = cached.get(request.op);
  if (kept && kept.key === key && now >= kept.at && now - kept.at < CACHED_READ_MS) return kept.read as Promise<DesktopVpsRead<T>>;
  const fresh = read<T>(request).then((result) => {
    // Not kept when it failed, or when the view moved to another connection while it was read.
    if (result.source !== "vps" || existingTeamConnectionKey() !== key) {
      if (cached.get(request.op)?.read === fresh) cached.delete(request.op);
    }
    return result;
  });
  cached.set(request.op, { key, at: now, read: fresh });
  return fresh;
}

/**
 * The dashboard's numbers, as the core counts them on the team's VPS: one
 * reply, never rows downloaded to be counted here.
 */
export async function readDesktopVpsStats(): Promise<DesktopVpsRead<DesktopVpsStats>> {
  const value = await readOnce<unknown>({ op: "stats" });
  if (value.source !== "vps") return value;
  const data = value.data;
  if (
    !isRecord(data) ||
    !isRecord(data.stats) ||
    !isRecord(data.distribution) ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.types) ||
    !Array.isArray(data.recent) ||
    !boundedPart(data.points) ||
    !boundedPart(data.events)
  ) {
    return { source: "unavailable", code: "desktop_bad_reply" };
  }
  return { source: "vps", data: data as unknown as DesktopVpsStats };
}

export function readDesktopVpsPosition(
  id: string,
): Promise<DesktopVpsRead<PositionDetail | null>> {
  return read<unknown>({ op: "detail", id }).then(detailRead);
}

export function readDesktopVpsPositionFacets(): Promise<
  DesktopVpsRead<PositionFacet[]>
> {
  return readOnce<unknown>({ op: "facets" }).then(arrayRead<PositionFacet>);
}
