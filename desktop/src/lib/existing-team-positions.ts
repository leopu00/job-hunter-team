import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DesktopVpsRead,
} from "../../../web/lib/desktop-vps-positions";
import type { PositionWithScore } from "../../../web/lib/types";
import type {
  PositionDetail,
  PositionFacet,
  PositionFilterOpts,
} from "../../../web/lib/queries";

export type { DesktopVpsRead } from "../../../web/lib/desktop-vps-positions";

/**
 * Fixed native read command. The native side resolves the account-scoped
 * binding and target before every request. The renderer supplies only a
 * bounded projection and typed filters; it never supplies SQL, a host, or a
 * container identifier.
 */
const COMMAND = "existing_team_positions_read";

type Request =
  | { op: "list"; filters: PositionFilterOpts | null }
  | { op: "detail"; id: string }
  | { op: "facets" };

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
  try {
    return reply<T>(await invoke<unknown>(COMMAND, { request }));
  } catch {
    return { source: "unavailable", code: "desktop_transport_unavailable" };
  }
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

export function readDesktopVpsPositions(
  opts?: PositionFilterOpts,
): Promise<DesktopVpsRead<PositionWithScore[]>> {
  return read<unknown>({ op: "list", filters: opts ?? null }).then(arrayRead<PositionWithScore>);
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
