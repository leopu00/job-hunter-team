/** Archive validated DTOs, never rendered nodes or action capabilities. */
import { isTauri } from "@tauri-apps/api/core";
import type { PositionFilterOpts } from "../../../web/lib/queries";
import * as native from "./existing-team-positions";
import type { DesktopVpsRead } from "./existing-team-positions";
import { teamDataFromTheTeam } from "./local-team-data";
import { currentLocation } from "../shell/router";
import { pageData } from "./page-data";

const readers = new Set<(key: string, cached: boolean | undefined) => void>();
export function observePositionReads(listener: (key: string, cached: boolean | undefined) => void): () => void {
  readers.add(listener);
  return () => { readers.delete(listener); };
}

async function archived<T>(op: string, params: unknown, load: () => Promise<DesktopVpsRead<T>>): Promise<DesktopVpsRead<T>> {
  if (!isTauri() || !teamDataFromTheTeam() || currentLocation().path !== "/positions") return load();
  const request = currentLocation();
  const epoch = pageData.epoch();
  const current = () => pageData.epoch() === epoch && currentLocation().path === request.path
    && currentLocation().search === request.search;
  const key = pageData.key("positions", op, params);
  const cached = pageData.snapshot<T>(key, "positions").data !== undefined;
  readers.forEach((listener) => listener(key, undefined));
  const data = await pageData.read(key, "positions", async () => {
      if (!current()) throw { code: "account_scope_changed" };
      const value = await load();
      if (value.source !== "vps") throw { code: value.source === "unavailable" ? value.code : "existing_team_unavailable" };
      return value.data;
    }, current);
  if (!current()) throw { code: "account_scope_changed" };
  readers.forEach((listener) => listener(key, cached || pageData.snapshot(key, "positions").fromDisk));
  return { source: "vps", data };
}

export function readDesktopVpsPositions(opts?: PositionFilterOpts) {
  return archived("list", opts ?? {}, () => native.readDesktopVpsPositions(opts));
}
export function readDesktopVpsPositionsWindow(opts: PositionFilterOpts) {
  return archived("window", opts, () => native.readDesktopVpsPositionsWindow(opts));
}
export function readDesktopVpsPositionFacets() {
  return archived("facets", {}, () => native.readDesktopVpsPositionFacets(true));
}
