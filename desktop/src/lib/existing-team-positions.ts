import { invoke, isTauri } from "@tauri-apps/api/core";
import { reportPositionsNotice, reportPositionsRead } from "./existing-team-readonly";
import type {
  DesktopVpsPositionsWindow,
  DesktopVpsRead,
} from "../../../web/lib/desktop-vps-positions";
import type { PositionWithScore } from "../../../web/lib/types";
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
  | { op: "facets" };

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
    result = reply<T>(await invoke<unknown>(COMMAND, { request }));
  } catch {
    result = { source: "unavailable", code: "desktop_transport_unavailable" };
  }
  reportPositionsRead(result.source === "unavailable" ? result.code : null);
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

function detailRead(value: DesktopVpsRead<unknown>): DesktopVpsRead<PositionDetail | null> {
  if (value.source !== "vps") return value;
  if (value.data === null) return { source: "vps", data: null };
  return typeof value.data === "object" && !Array.isArray(value.data) &&
    "position" in value.data
    ? { source: "vps", data: value.data as PositionDetail }
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

/**
 * The columns the core's rows do not carry (the team's last action is not in
 * its projection): sorting by them would silently keep the date order, so the
 * date order is asked for by name and the person is told.
 */
const SORTS_THE_CORE_CANNOT_DO = new Set(["last_action_at", "last_action_by"]);

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
  reportPositionsNotice(value.source === "vps" && substituted ? "sort_last_action" : null);
  if (value.source !== "vps") return value;
  const data = value.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { source: "unavailable", code: "desktop_bad_reply" };
  }
  const { items, total } = data as Record<string, unknown>;
  return Array.isArray(items) && typeof total === "number" && Number.isInteger(total) && total >= 0
    ? { source: "vps", data: { items: items as PositionWithScore[], total } }
    : { source: "unavailable", code: "desktop_bad_reply" };
}

export function readDesktopVpsPosition(
  id: string,
): Promise<DesktopVpsRead<PositionDetail | null>> {
  return read<unknown>({ op: "detail", id }).then(detailRead);
}

export function readDesktopVpsPositionFacets(): Promise<
  DesktopVpsRead<PositionFacet[]>
> {
  return read<unknown>({ op: "facets" }).then(arrayRead<PositionFacet>);
}
