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

function arrayRead<T>(value: DesktopVpsRead<T[]>): DesktopVpsRead<T[]> {
  return value.source === "vps" && !Array.isArray(value.data)
    ? { source: "unavailable", code: "desktop_bad_reply" }
    : value;
}

function detailRead<T extends object>(value: DesktopVpsRead<T | null>): DesktopVpsRead<T | null> {
  return value.source === "vps" && value.data !== null &&
    (typeof value.data !== "object" || Array.isArray(value.data))
    ? { source: "unavailable", code: "desktop_bad_reply" }
    : value;
}

export function readDesktopVpsPositions(
  opts?: PositionFilterOpts,
): Promise<DesktopVpsRead<PositionWithScore[]>> {
  return read<PositionWithScore[]>({ op: "list", filters: opts ?? null }).then(arrayRead);
}

export function readDesktopVpsPosition(
  id: string,
): Promise<DesktopVpsRead<PositionDetail | null>> {
  return read<PositionDetail | null>({ op: "detail", id }).then(detailRead);
}

export function readDesktopVpsPositionFacets(): Promise<
  DesktopVpsRead<PositionFacet[]>
> {
  return read<PositionFacet[]>({ op: "facets" }).then(arrayRead);
}
