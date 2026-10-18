import type { PositionWithScore } from "@/lib/types";
import { readVpsPositionsShared } from "../../lib/existing-team-positions-shared";
import type { DeptId } from "../contract";
import {
  BOARD_STATES,
  PANEL_LIST_MAX,
  type BoardData,
  type CvShelfData,
  type DayCount,
  type PanelPosition,
  type PlaceCount,
  type PlacesData,
} from "./load-panels";

/**
 * The office's panels over an existing team's VPS (the read-only view). They
 * show the same things as the cloud's (load-panels.ts) from the same list of
 * positions the Posizioni page and the Map read: one bounded read of the
 * team's VPS, shared with the globe (readVpsPositionsShared), nothing read
 * from the cloud and nothing written.
 *
 * What the list carries is what the panels can say. It does not carry who
 * found, wrote or reviewed a position, the job description's summary or the
 * critic's notes: the position's rows leave those out, never invent them. It
 * does not carry the moves of an agent either (the panel of an agent has no
 * data here, and the page says so with a sentence instead of opening empty).
 *
 * A read that failed throws its code, so the panel tells the failure instead
 * of showing an empty team.
 */

const isPass = (v: string | null | undefined) => (v ?? "").toLowerCase() === "pass";

/** Every position of the team, or the reason it could not be read. */
async function rowsOfTheTeam(): Promise<PositionWithScore[]> {
  const read = await readVpsPositionsShared();
  if (read.source === "vps") return read.data;
  throw new Error(read.source === "unavailable" ? read.code : "desktop_transport_unavailable");
}

/** The panel's position, from a row of the core's list; what that list does not carry stays empty. */
export function panelPositionOf(row: PositionWithScore): PanelPosition {
  return {
    id: String(row.id),
    legacyId: row.legacy_id ?? null,
    title: row.title ?? null,
    company: row.company ?? null,
    status: row.status ?? null,
    location: row.location ?? null,
    remoteType: row.remote_type ?? null,
    foundAt: row.found_at ?? null,
    foundBy: null,
    jdSummary: null,
    score: typeof row.score === "number" ? row.score : null,
    writtenBy: null,
    writtenAt: row.written_at ?? null,
    verdict: row.critic_verdict ?? null,
    criticScore: typeof row.critic_score === "number" ? row.critic_score : null,
    criticNotes: null,
    reviewedBy: null,
    reviewedAt: null,
  };
}

const newestFirst = (a: PositionWithScore, b: PositionWithScore) => (b.found_at ?? "").localeCompare(a.found_at ?? "");

/** The positions of a phase as the piles count them (the cloud's loadPhase), newest found first. */
export function phaseOf(rows: PositionWithScore[], dept: DeptId): PanelPosition[] {
  const inPhase = (row: PositionWithScore): boolean => {
    switch (dept) {
      case "scout":
        return row.status === "new";
      case "analisti":
        return row.status === "checked";
      case "scorer":
        return row.status === "scored" && !row.write_requested;
      case "scrittori":
        return row.status === "review" || (row.status === "ready" && !isPass(row.critic_verdict));
      case "critici":
        return row.status === "ready" && isPass(row.critic_verdict);
    }
  };
  return rows.filter(inPhase).sort(newestFirst).slice(0, PANEL_LIST_MAX).map(panelPositionOf);
}

/** Positions found per calendar day over the last `days` days, oldest first (the cloud's loadFoundPerDay). */
export function foundPerDayOf(rows: PositionWithScore[], now: number = Date.now(), days = 7): DayCount[] {
  const today = new Date(now);
  const midnight = (i: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1) + i);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const found = rows.map((row) => Date.parse(row.found_at ?? "")).filter((t) => !Number.isNaN(t));
  return Array.from({ length: days }, (_, i) => {
    const from = midnight(i).getTime();
    const to = midnight(i + 1).getTime();
    return { day: key(midnight(i)), n: found.filter((t) => t >= from && t < to).length };
  });
}

/** The CVs written: totals, and the newest (the cloud's loadCvShelf). */
export function cvShelfOf(rows: PositionWithScore[]): CvShelfData {
  const written = rows.filter((row) => !!row.written_at);
  const newest = [...written].sort((a, b) => (b.written_at ?? "").localeCompare(a.written_at ?? ""));
  return {
    written: written.length,
    passed: written.filter((row) => isPass(row.critic_verdict)).length,
    unreviewed: written.filter((row) => !row.critic_verdict).length,
    list: newest.slice(0, PANEL_LIST_MAX).map(panelPositionOf),
  };
}

/** The positions ready, sent and answered (the cloud's loadBoard). */
export function boardOf(rows: PositionWithScore[]): BoardData {
  const onBoard = rows.filter((row) => (BOARD_STATES as readonly string[]).includes(row.status));
  const counts = { ready: 0, applied: 0, response: 0 };
  for (const row of onBoard) counts[row.status as keyof typeof counts]++;
  return { counts, list: [...onBoard].sort(newestFirst).slice(0, PANEL_LIST_MAX).map(panelPositionOf) };
}

/** Where the positions are, the most frequent first (the cloud's loadPlaces). */
export function placesOf(rows: PositionWithScore[], top = 15): PlacesData {
  const by = new Map<string, number>();
  let located = 0;
  for (const row of rows) {
    const place = (row.location ?? "").trim();
    if (!place) continue;
    located++;
    by.set(place, (by.get(place) ?? 0) + 1);
  }
  const places: PlaceCount[] = [...by].map(([place, n]) => ({ place, n })).sort((a, b) => b.n - a.n || a.place.localeCompare(b.place));
  return { located, places: places.slice(0, top) };
}

/** The panels' readers over the VPS: the same names and shapes as the cloud's, one shared read each. */
export const vpsPanelLoaders = {
  phase: async (dept: DeptId) => phaseOf(await rowsOfTheTeam(), dept),
  foundPerDay: async (now?: number) => foundPerDayOf(await rowsOfTheTeam(), now),
  cvShelf: async () => cvShelfOf(await rowsOfTheTeam()),
  board: async () => boardOf(await rowsOfTheTeam()),
  places: async () => placesOf(await rowsOfTheTeam()),
};
