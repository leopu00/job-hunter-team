import type { DeptId } from "../contract";
import type { PanelClient } from "./types";

/**
 * What the office's panels show (D07), read from the cloud with the user's
 * session, the user's own rows only (user_id on top of the RLS). Only what
 * the cloud holds: the Godot panels' fields that live only on the box (the
 * pane's detail, CPU, tokens, the CV files) are not here.
 *
 * Scores and applications are read apart from the positions (several
 * foreign keys join them, an embed could be ambiguous) and joined here.
 */

type Client = PanelClient;

export type PanelPosition = {
  /** uuid, for the link to /positions/:id */
  id: string;
  legacyId: number | null;
  title: string | null;
  company: string | null;
  status: string | null;
  location: string | null;
  remoteType: string | null;
  foundAt: string | null;
  foundBy: string | null;
  jdSummary: string | null;
  score: number | null;
  writtenBy: string | null;
  writtenAt: string | null;
  verdict: string | null;
  criticScore: number | null;
  criticNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type PanelMove = { ts: string; from: string | null; to: string | null; position: PanelPosition | null };

export type AgentPanelData = {
  /** its last moves, newest first */
  moves: PanelMove[];
  /** positions whose last move is its own and that are still where it left them */
  inHand: PanelPosition[];
};

export const PANEL_LIST_MAX = 60;
const MOVES_MAX = 30;

const POSITION_COLUMNS = "id, legacy_id, title, company, status, location, remote_type, found_at, found_by, jd_summary";

type PositionRow = {
  id: string;
  legacy_id: number | null;
  title: string | null;
  company: string | null;
  status: string | null;
  location: string | null;
  remote_type: string | null;
  found_at: string | null;
  found_by: string | null;
  jd_summary: string | null;
};
type ScoreRow = { position_id: string; total_score: number | null };
type ApplicationRow = {
  position_id: string;
  written_by: string | null;
  written_at: string | null;
  critic_verdict: string | null;
  critic_score: number | null;
  critic_notes: string | null;
  reviewed_by: string | null;
  critic_reviewed_at: string | null;
};
type TransitionRow = { ts: string; by_agent: string | null; from_state: string | null; to_state: string | null; position_legacy_id: number };

async function userOf(client: Client): Promise<string> {
  const { data } = await client.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("nessuna sessione");
  return id;
}

function rows<T>(res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
}

/** The positions with their score and their application, joined. */
async function withDetails(client: Client, userId: string, positions: PositionRow[]): Promise<PanelPosition[]> {
  const ids = positions.map((p) => p.id);
  if (ids.length === 0) return [];
  const [scores, apps] = await Promise.all([
    client.from("scores").select("position_id, total_score").eq("user_id", userId).in("position_id", ids),
    client
      .from("applications")
      .select("position_id, written_by, written_at, critic_verdict, critic_score, critic_notes, reviewed_by, critic_reviewed_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("position_id", ids),
  ]);
  const score = new Map<string, number>();
  for (const s of rows<ScoreRow>(scores)) {
    if (typeof s.total_score === "number") score.set(s.position_id, Math.max(score.get(s.position_id) ?? -Infinity, s.total_score));
  }
  const app = new Map(rows<ApplicationRow>(apps).map((a) => [a.position_id, a]));
  return positions.map((p) => {
    const a = app.get(p.id);
    return {
      id: p.id,
      legacyId: p.legacy_id,
      title: p.title,
      company: p.company,
      status: p.status,
      location: p.location,
      remoteType: p.remote_type,
      foundAt: p.found_at,
      foundBy: p.found_by,
      jdSummary: p.jd_summary,
      score: score.get(p.id) ?? null,
      writtenBy: a?.written_by ?? null,
      writtenAt: a?.written_at ?? null,
      verdict: a?.critic_verdict ?? null,
      criticScore: a?.critic_score ?? null,
      criticNotes: a?.critic_notes ?? null,
      reviewedBy: a?.reviewed_by ?? null,
      reviewedAt: a?.critic_reviewed_at ?? null,
    };
  });
}

const isPass = (v: string | null) => (v ?? "").toLowerCase() === "pass";

/**
 * The positions of a phase, as the piles count them (data/load.ts readPiles,
 * pipeline_queue_defs.gd): Scout = new; Analisti = checked; Scorer = scored
 * the user did not ask to write; Scrittori = review, and ready without the
 * critic's PASS; Critici = ready with the PASS. Newest found first, at most
 * PANEL_LIST_MAX.
 */
export async function loadPhase(client: Client, dept: DeptId): Promise<PanelPosition[]> {
  const userId = await userOf(client);
  const base = () =>
    client.from("positions").select(POSITION_COLUMNS).eq("user_id", userId).is("deleted_at", null).order("found_at", { ascending: false });
  const read = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => rows<PositionRow>(await q);
  let list: PanelPosition[];
  switch (dept) {
    case "scout":
      return withDetails(client, userId, await read(base().eq("status", "new").limit(PANEL_LIST_MAX)));
    case "analisti":
      return withDetails(client, userId, await read(base().eq("status", "checked").limit(PANEL_LIST_MAX)));
    case "scorer":
      return withDetails(client, userId, await read(base().eq("status", "scored").eq("write_requested", false).limit(PANEL_LIST_MAX)));
    case "scrittori": {
      const [review, ready] = await Promise.all([
        read(base().eq("status", "review").limit(PANEL_LIST_MAX)),
        read(base().eq("status", "ready").limit(PANEL_LIST_MAX * 2)),
      ]);
      list = (await withDetails(client, userId, [...review, ...ready])).filter((p) => p.status === "review" || !isPass(p.verdict));
      return list.slice(0, PANEL_LIST_MAX);
    }
    case "critici": {
      const ready = await read(base().eq("status", "ready").limit(PANEL_LIST_MAX * 2));
      list = (await withDetails(client, userId, ready)).filter((p) => isPass(p.verdict));
      return list.slice(0, PANEL_LIST_MAX);
    }
  }
}

/**
 * An agent's last moves (position_transitions.by_agent is the office's uid)
 * and the positions in its hands: those whose latest transition, by anyone,
 * is its own and that are still in the state it left them in.
 */
export async function loadAgentPanel(client: Client, uid: string): Promise<AgentPanelData> {
  const userId = await userOf(client);
  const moves = rows<TransitionRow>(
    await client
      .from("position_transitions")
      .select("ts, by_agent, from_state, to_state, position_legacy_id")
      .eq("user_id", userId)
      .eq("by_agent", uid)
      .order("ts", { ascending: false })
      .limit(MOVES_MAX),
  );
  const legacyIds = [...new Set(moves.map((m) => m.position_legacy_id))];
  if (legacyIds.length === 0) return { moves: [], inHand: [] };
  const [latestRows, positionRows] = await Promise.all([
    client
      .from("position_transitions")
      .select("ts, by_agent, from_state, to_state, position_legacy_id")
      .eq("user_id", userId)
      .in("position_legacy_id", legacyIds)
      .order("ts", { ascending: false })
      .limit(1000),
    client.from("positions").select(POSITION_COLUMNS).eq("user_id", userId).is("deleted_at", null).in("legacy_id", legacyIds),
  ]);
  const latest = new Map<number, TransitionRow>();
  for (const t of rows<TransitionRow>(latestRows)) if (!latest.has(t.position_legacy_id)) latest.set(t.position_legacy_id, t);
  const positions = await withDetails(client, userId, rows<PositionRow>(positionRows));
  const byLegacy = new Map(positions.map((p) => [p.legacyId, p]));
  const inHand = positions.filter((p) => {
    const last = p.legacyId == null ? undefined : latest.get(p.legacyId);
    return last?.by_agent === uid && last.to_state != null && last.to_state === p.status;
  });
  return {
    moves: moves.map((m) => ({ ts: m.ts, from: m.from_state, to: m.to_state, position: byLegacy.get(m.position_legacy_id) ?? null })),
    inHand,
  };
}

type CountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }>;
async function count(q: CountQuery): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

/** Positions found per day over the last `days` days, oldest first (Godot's positions_timeline.gd, for the Scout). */
export type DayCount = { day: string; n: number };

export async function loadFoundPerDay(client: Client, now: number = Date.now(), days = 7): Promise<DayCount[]> {
  const userId = await userOf(client);
  const start = new Date(now - (days - 1) * 86_400_000);
  start.setHours(0, 0, 0, 0);
  const found = rows<{ found_at: string | null }>(
    await client
      .from("positions")
      .select("found_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("found_at", start.toISOString())
      .limit(5000),
  );
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const out = new Map<string, number>();
  for (let i = 0; i < days; i++) out.set(key(new Date(start.getTime() + i * 86_400_000)), 0);
  for (const r of found) {
    if (!r.found_at) continue;
    const k = key(new Date(r.found_at));
    if (out.has(k)) out.set(k, out.get(k)! + 1);
  }
  return [...out].map(([day, n]) => ({ day, n }));
}

/** The CVs produced (Godot's CV shelf, output_archive_panel.gd): totals and the newest written. */
export type CvShelfData = { written: number; passed: number; unreviewed: number; list: PanelPosition[] };

export async function loadCvShelf(client: Client): Promise<CvShelfData> {
  const userId = await userOf(client);
  const apps = () =>
    client.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null).not("written_at", "is", null);
  const [written, passed, unreviewed, newest] = await Promise.all([
    count(apps()),
    count(apps().ilike("critic_verdict", "pass")),
    count(apps().is("critic_verdict", null)),
    client
      .from("applications")
      .select("position_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .not("written_at", "is", null)
      .order("written_at", { ascending: false })
      .limit(PANEL_LIST_MAX),
  ]);
  const ids = rows<{ position_id: string }>(newest).map((a) => a.position_id);
  if (ids.length === 0) return { written, passed, unreviewed, list: [] };
  const positions = rows<PositionRow>(await client.from("positions").select(POSITION_COLUMNS).eq("user_id", userId).in("id", ids));
  const order = new Map(ids.map((id, i) => [id, i]));
  const list = (await withDetails(client, userId, positions)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { written, passed, unreviewed, list };
}

/** The corkboard (Godot's registry_panel.gd): the positions ready, sent and answered. */
export const BOARD_STATES = ["ready", "applied", "response"] as const;
export type BoardData = { counts: Record<(typeof BOARD_STATES)[number], number>; list: PanelPosition[] };

export async function loadBoard(client: Client): Promise<BoardData> {
  const userId = await userOf(client);
  const positions = () => client.from("positions").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null);
  const [ready, applied, response, list] = await Promise.all([
    count(positions().eq("status", "ready")),
    count(positions().eq("status", "applied")),
    count(positions().eq("status", "response")),
    client
      .from("positions")
      .select(POSITION_COLUMNS)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("status", [...BOARD_STATES])
      .order("found_at", { ascending: false })
      .limit(PANEL_LIST_MAX),
  ]);
  return { counts: { ready, applied, response }, list: await withDetails(client, userId, rows<PositionRow>(list)) };
}

/** The hologram (Godot opens the map): positions by place, the most frequent first. */
export type PlaceCount = { place: string; n: number };
export type PlacesData = { located: number; places: PlaceCount[] };

export async function loadPlaces(client: Client, top = 15): Promise<PlacesData> {
  const userId = await userOf(client);
  const [total, sample] = await Promise.all([
    count(client.from("positions").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null).not("location", "is", null)),
    client.from("positions").select("location").eq("user_id", userId).is("deleted_at", null).not("location", "is", null).limit(5000),
  ]);
  const located = rows<{ location: string | null }>(sample);
  const by = new Map<string, number>();
  for (const r of located) {
    const place = (r.location ?? "").trim();
    if (place) by.set(place, (by.get(place) ?? 0) + 1);
  }
  const places = [...by].map(([place, n]) => ({ place, n })).sort((a, b) => b.n - a.n || a.place.localeCompare(b.place));
  return { located: total, places: places.slice(0, top) };
}
