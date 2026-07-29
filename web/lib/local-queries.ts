import { getDb } from "./db";
import { resolveCityPins } from "./city-coords";
import {
  aggregateRoleFamilies,
  type RoleFamilyCount,
} from "./position-classifier";
import {
  buildTeamActivity,
  normActor,
  type TeamActivity,
  type TeamActivityEvent,
  type RecentActivityEvent,
} from "./team-activity";
import type {
  DashboardStats,
  PositionWithScore,
  Position,
  Score,
  PositionHighlight,
  Company,
  Application,
  PendingMessage,
  PositionTicket,
} from "./types";

// Helpers per convertire ID integer -> string (compatibilita' con tipi TS)
function sid(v: number | null | undefined): string {
  return v != null ? String(v) : "";
}

// Vero se la tabella locale ha davvero quella colonna. Un workspace piu'
// vecchio del codice (seed da Supabase, container non ancora ri-deployato)
// puo' non avere le colonne aggiunte dalle migrazioni recenti: nominarle in
// una SELECT farebbe fallire l'intera query — e la pagina resterebbe vuota
// invece che leggermente meno ricca.
function hasColumn(
  db: ReturnType<typeof getDb>,
  table: string,
  column: string,
): boolean {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .some((r) => r.name === column);
  } catch {
    return false;
  }
}

// ── Dashboard Stats ────────────────────────────────────────────────
export function getDashboardStatsLocal(ws: string): DashboardStats {
  const db = getDb(ws);
  const rows = db
    .prepare("SELECT status, COUNT(*) as cnt FROM positions GROUP BY status")
    .all() as { status: string; cnt: number }[];

  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    counts[r.status] = r.cnt;
    total += r.cnt;
  }

  // Pipeline write-requested-aware: "Da scrivere" = selezionate dall'utente
  // (write_requested) con CV non ancora pronto; "Con lo score" = scored non
  // selezionate. Guardato in try/catch: workspace vecchi seedati da Supabase
  // potrebbero non avere ancora la colonna write_requested → degrada a 0.
  let to_write = 0;
  let scored_requested = 0;
  try {
    to_write = (
      db
        .prepare(
          "SELECT COUNT(*) as cnt FROM positions WHERE write_requested = 1 AND status IN ('scored','writing','review')",
        )
        .get() as { cnt: number }
    ).cnt;
    scored_requested = (
      db
        .prepare(
          "SELECT COUNT(*) as cnt FROM positions WHERE write_requested = 1 AND status = 'scored'",
        )
        .get() as { cnt: number }
    ).cnt;
  } catch {
    /* colonna write_requested assente: box 'Da scrivere' a 0 */
  }

  return {
    total,
    new: counts["new"] ?? 0,
    checked: counts["checked"] ?? 0,
    scored: counts["scored"] ?? 0,
    writing: counts["writing"] ?? 0,
    review: counts["review"] ?? 0,
    ready: counts["ready"] ?? 0,
    applied: counts["applied"] ?? 0,
    excluded: counts["excluded"] ?? 0,
    response: counts["response"] ?? 0,
    scored_open: (counts["scored"] ?? 0) - scored_requested,
    to_write,
  };
}

// ── Recent positions with scores ───────────────────────────────────
export function getRecentPositionsLocal(
  ws: string,
  limit = 15,
): PositionWithScore[] {
  const db = getDb(ws);
  // last_action_at = ULTIMA azione qualsiasi su una posizione: insert
  // dello Scout (found_at), check dell'Analista (last_checked), score
  // dello Scorer (scored_at). Versione "lite" — non guarda
  // status_changed_at perche' il trigger SQLite non e' garantito su
  // workspace seedati da Supabase (tipico dev locale).
  const rows = db
    .prepare(
      `
    SELECT p.*, s.total_score as score,
           MAX(
             COALESCE(p.found_at, '1970-01-01'),
             COALESCE(p.last_checked, '1970-01-01'),
             COALESCE(s.scored_at, '1970-01-01')
           ) AS last_action_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY last_action_at DESC
    LIMIT ?
  `,
    )
    .all(limit) as any[];

  return rows.map((r) => ({
    ...mapPosition(r),
    last_action_at: r.last_action_at,
  }));
}

// Posizioni ordinate per ULTIMA azione qualsiasi: insert dello Scout
// (found_at), check dell'Analista (last_checked), score dello Scorer
// (scored_at), o cambio di stato di Scrittore/Critico/User
// (status_changed_at, popolato dal trigger SQLite installato sul DB).
// Restituisce anche `last_action_at` e `last_action_by` (l'agente che
// ha causato l'ultima modifica), così la UI può mostrare il feed in
// tempo reale e attribuire l'evento.
export function getRecentlyTouchedPositionsLocal(
  ws: string,
  limit = 15,
): (PositionWithScore & {
  last_action_at: string;
  last_action_by: string;
  last_action_actor: string;
  voto: number | null;
})[] {
  const db = getDb(ws);
  // last_action_by: ruolo (scout, analista, scorer, scrittore, critico, user)
  // last_action_actor: identificativo dell'istanza concreta dove
  // disponibile (scout-1 da found_by, scorer-1 da scored_by); per gli
  // altri ruoli ricade sul nome del role perché lo schema attuale non
  // registra l'attore di analista/writer/critic/user.
  // voto: critic_score dalla applications (review del critico, 0-10).
  const rows = db
    .prepare(
      `
    SELECT p.*, s.total_score as score, s.scored_at as scored_at, s.scored_by as scored_by,
           a.critic_score as voto,
           MAX(
             COALESCE(p.found_at, '1970-01-01'),
             COALESCE(p.last_checked, '1970-01-01'),
             COALESCE(s.scored_at, '1970-01-01'),
             COALESCE(p.status_changed_at, '1970-01-01')
           ) AS last_action_at,
           CASE
             WHEN COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(s.scored_at, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.status_changed_at IS NOT NULL THEN
                CASE p.status
                  WHEN 'checked'  THEN 'analista'
                  WHEN 'excluded' THEN 'analista'
                  WHEN 'scored'   THEN 'scorer'
                  WHEN 'writing'  THEN 'scrittore'
                  WHEN 'review'   THEN 'scrittore'
                  WHEN 'ready'    THEN 'critico'
                  WHEN 'applied'  THEN 'user'
                  WHEN 'response' THEN 'user'
                  ELSE 'scout'
                END
             WHEN COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND s.scored_at IS NOT NULL THEN 'scorer'
             WHEN COALESCE(p.last_checked, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.last_checked IS NOT NULL THEN 'analista'
             ELSE 'scout'
           END AS last_action_by,
           CASE
             -- Quando il MAX viene da status_changed_at, usiamo last_actor
             -- (popolato da db_update.py con JHT_AGENT_NAME → es. 'scrittore-1',
             -- 'critico-s2'). Fallback al ruolo dedotto dallo status corrente
             -- se last_actor è ancora NULL (righe pre-migrazione).
             WHEN COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(s.scored_at, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.status_changed_at IS NOT NULL THEN
                COALESCE(p.last_actor,
                  CASE p.status
                    WHEN 'checked'  THEN 'analista'
                    WHEN 'excluded' THEN 'analista'
                    WHEN 'scored'   THEN COALESCE(s.scored_by, 'scorer')
                    WHEN 'writing'  THEN 'scrittore'
                    WHEN 'review'   THEN 'scrittore'
                    WHEN 'ready'    THEN 'critico'
                    WHEN 'applied'  THEN 'user'
                    WHEN 'response' THEN 'user'
                    ELSE COALESCE(p.found_by, 'scout')
                  END)
             WHEN COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND s.scored_at IS NOT NULL THEN COALESCE(s.scored_by, 'scorer')
             WHEN COALESCE(p.last_checked, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.last_checked IS NOT NULL THEN COALESCE(p.last_actor, 'analista')
             ELSE COALESCE(p.found_by, 'scout')
           END AS last_action_actor
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY last_action_at DESC
    LIMIT ?
  `,
    )
    .all(limit) as any[];

  return rows.map((r) => ({
    ...mapPosition(r),
    last_action_at: r.last_action_at,
    last_action_by: r.last_action_by,
    last_action_actor: r.last_action_actor,
    voto: typeof r.voto === "number" ? r.voto : null,
  }));
}

// ── All positions with optional filters ────────────────────────────
// Whitelist colonne sortabili → espressione SQL. NON inserire mai
// opts.sort raw nella query: SQLite non supporta prepared statement
// per ORDER BY, quindi la mappa qui sotto è l'unica difesa anti-injection.
const POSITION_SORT_COLUMNS: Record<string, string> = {
  id: "p.id",
  title: "p.title",
  company: "p.company",
  role_family: "p.role_family",
  source: "p.source",
  location: "p.location",
  score: "s.total_score",
  critic: "a.critic_score",
  found_at: "p.found_at",
  status: "p.status",
};

type LocalPositionFilterOpts = {
  statuses?: string[];
  remoteTypes?: string[];
  sources?: string[];
  verdicts?: string[];
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: "asc" | "desc";
};

export function getPositionsLocal(
  ws: string,
  opts?: LocalPositionFilterOpts,
): PositionWithScore[] {
  const db = getDb(ws);
  const where: string[] = [];
  const params: any[] = [];

  if (opts?.statuses?.length) {
    where.push(`p.status IN (${opts.statuses.map(() => "?").join(",")})`);
    params.push(...opts.statuses);
  }
  if (opts?.remoteTypes?.length) {
    where.push(
      `p.remote_type IN (${opts.remoteTypes.map(() => "?").join(",")})`,
    );
    params.push(...opts.remoteTypes);
  }
  if (opts?.sources?.length) {
    where.push(`p.source IN (${opts.sources.map(() => "?").join(",")})`);
    params.push(...opts.sources);
  }
  if (opts?.verdicts?.length) {
    where.push(
      `a.critic_verdict IN (${opts.verdicts.map(() => "?").join(",")})`,
    );
    params.push(...opts.verdicts);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limitClause = opts?.limit ? `LIMIT ?` : "";
  const offsetClause = opts?.offset ? `OFFSET ?` : "";
  if (opts?.limit) params.push(opts.limit);
  if (opts?.offset) params.push(opts.offset);

  const sortCol = POSITION_SORT_COLUMNS[opts?.sort ?? ""] ?? "p.found_at";
  const sortDir = opts?.dir === "asc" ? "ASC" : "DESC";
  const nullsLast =
    sortCol.startsWith("s.") || sortCol.startsWith("a.")
      ? `${sortCol} IS NULL, `
      : "";

  const sql = `
    SELECT p.*, s.total_score as score,
      s.stack_match, s.remote_fit, s.salary_fit, s.strategic_fit,
      s.scored_at, s.scored_by,
      a.critic_score, a.critic_verdict,
      a.written_at, a.written_by, a.critic_reviewed_at, a.reviewed_by,
      a.applied_at, a.response_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    ${whereClause}
    ORDER BY ${nullsLast}${sortCol} ${sortDir}
    ${limitClause} ${offsetClause}
  `;
  const rows = db.prepare(sql).all(...params) as any[];
  const mapped = rows.map((r) => {
    // Stipendio: stima del team se presente, altrimenti il dichiarato.
    const useEst =
      r.salary_estimated_min != null || r.salary_estimated_max != null;
    const salary_min =
      (useEst ? r.salary_estimated_min : r.salary_declared_min) ?? null;
    const salary_max =
      (useEst ? r.salary_estimated_max : r.salary_declared_max) ?? null;
    const salary_currency =
      (useEst ? r.salary_estimated_currency : r.salary_declared_currency) ??
      "EUR";
    const la = pickLastActionLocal([
      { ts: r.found_at, by: "scout", actor: r.found_by },
      { ts: r.last_checked, by: "analista", actor: "analista" },
      { ts: r.scored_at, by: "scorer", actor: r.scored_by },
      { ts: r.written_at, by: "scrittore", actor: r.written_by },
      { ts: r.critic_reviewed_at, by: "critico", actor: r.reviewed_by },
      { ts: r.applied_at, by: "user", actor: "user" },
      { ts: r.response_at, by: "user", actor: "user" },
      { ts: r.status_changed_at, by: "user", actor: r.last_actor },
    ]);
    return {
      ...mapPosition(r),
      salary_min,
      salary_max,
      salary_currency,
      last_action_at: la.at,
      last_action_by: la.by,
      last_action_actor: la.actor,
    };
  });
  // Sort in JS su QUALSIASI colonna (incluse quelle derivate: salary, voto,
  // last_action_*). Uniforme col path cloud, così ogni intestazione ordina
  // davvero anche in locale. La ORDER BY SQL resta come ordine di base.
  if (opts?.sort) {
    const mul = opts.dir === "asc" ? 1 : -1;
    const val = (p: PositionWithScore): string | number | null => {
      switch (opts.sort) {
        case "id":
          return p.legacy_id ?? null;
        case "score":
          return p.score ?? null;
        case "critic":
          return p.critic_score ?? null;
        case "salary":
        case "monthly":
          return p.salary_min ?? null;
        case "remote":
          return p.remote_type ?? null;
        case "last_action_by":
          return p.last_action_actor ?? null;
        case "last_action_at":
          return p.last_action_at ?? null;
        case "found_at":
          return p.found_at ?? null;
        case "role_family":
          return p.role_family ?? null;
        case "loc_country":
          return p.loc_country ?? null;
        case "loc_city":
          return p.loc_city ?? null;
        case "title":
          return p.title ?? null;
        case "company":
          return p.company ?? null;
        case "source":
          return p.source ?? null;
        case "location":
          return p.location ?? null;
        case "status":
          return p.status ?? null;
        default:
          return null;
      }
    };
    mapped.sort((a, b) => {
      const va = val(a),
        vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number")
        return (va - vb) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    });
  }
  return mapped;
}

// ── Single position with all details ───────────────────────────────
export function getPositionByIdLocal(
  ws: string,
  id: string,
): {
  position: Position;
  score: Score | null;
  highlights: PositionHighlight[];
  company: Company | null;
  application: Application | null;
  tickets: PositionTicket[];
} | null {
  const db = getDb(ws);
  const numId = Number(id);

  const pos = db
    .prepare("SELECT * FROM positions WHERE id = ?")
    .get(numId) as any;
  if (!pos) return null;

  const score = db
    .prepare("SELECT * FROM scores WHERE position_id = ?")
    .get(numId) as any;
  const highlights = db
    .prepare(
      "SELECT * FROM position_highlights WHERE position_id = ? ORDER BY type",
    )
    .all(numId) as any[];
  const app = db
    .prepare("SELECT * FROM applications WHERE position_id = ?")
    .get(numId) as any;

  // Ticket utente→team (tabella position_tickets). Guard: workspace seedati prima
  // della mig potrebbero non averla → degrada a nessun ticket.
  let tickets: PositionTicket[] = [];
  try {
    const tk = db
      .prepare(
        "SELECT * FROM position_tickets WHERE position_id = ? ORDER BY created_at ASC",
      )
      .all(numId) as any[];
    tickets = tk.map(mapTicket);
  } catch {
    /* tabella assente: nessun ticket */
  }

  let company: Company | null = null;
  if (pos.company_id) {
    const c = db
      .prepare("SELECT * FROM companies WHERE id = ?")
      .get(pos.company_id) as any;
    if (c) company = mapCompany(c);
  }

  return {
    position: mapPositionFull(pos),
    score: score ? mapScore(score) : null,
    highlights: highlights.map((h) => ({
      id: sid(h.id),
      position_id: sid(h.position_id),
      type: h.type,
      text: h.text,
    })),
    company,
    application: app ? mapApplication(app) : null,
    tickets,
  };
}

function mapTicket(r: any): PositionTicket {
  return {
    id: sid(r.id),
    position_id: sid(r.position_id),
    request_text: r.request_text,
    kind: r.kind ?? "custom",
    status: r.status,
    assigned_agent: r.assigned_agent ?? null,
    response_text: r.response_text ?? null,
    created_at: r.created_at ?? null,
    resolved_at: r.resolved_at ?? null,
  };
}

// ── Score distribution ──────────────────────────────────────────────
export function getScoreDistributionLocal(ws: string) {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT s.total_score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
  `,
    )
    .all() as { total_score: number | null }[];

  const allScores = rows.map((r) => r.total_score);
  const withScore = allScores.filter((s): s is number => s != null && s > 0);

  const buckets = [
    { label: "76\u2013100", min: 76, max: 100, color: "var(--color-green)" },
    { label: "61\u201375", min: 61, max: 75, color: "var(--color-yellow)" },
    { label: "41\u201360", min: 41, max: 60, color: "var(--color-orange)" },
    { label: "\u2264 40", min: 0, max: 40, color: "var(--color-red)" },
  ].map((b) => ({
    label: b.label,
    count: withScore.filter((s) => s >= b.min && s <= b.max).length,
    color: b.color,
  }));

  const sum = withScore.reduce((a, s) => a + s, 0);
  const avgScore =
    withScore.length > 0 ? Math.round(sum / withScore.length) : null;

  return {
    buckets,
    total: allScores.length,
    withScore: withScore.length,
    avgScore,
    scores: withScore,
  };
}

// ── Positions con coordinate ufficio (per JobsGlobe) ───────────────
export interface PositionCoord {
  id: string;
  title: string;
  company: string;
  status: string;
  role_family: string | null;
  score: number | null;
  lat: number;
  lon: number;
  is_remote: boolean;
  remote_type: string | null;
  location: string | null;
  loc_country: string | null;
  loc_city: string | null;
  office_address: string | null;
  created_at: string | null;
}
export function getPositionsWithCoordsLocal(ws: string): PositionCoord[] {
  const db = getDb(ws);
  // Tutte le non-escluse; le coordinate vengono risolte a livello città
  // (ufficio esatto o centro-città dai sibling geocodificati).
  const rows = db
    .prepare(
      `
    SELECT p.id, p.title, p.company, p.status, p.role_family, p.location,
           p.loc_country, p.loc_city, p.office_address, p.created_at,
           s.total_score as score,
           p.office_lat, p.office_lon,
           p.remote_type
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
  `,
    )
    .all() as any[];
  const pins = resolveCityPins(
    rows.map((r) => ({
      loc_country: r.loc_country ?? null,
      loc_city: r.loc_city ?? null,
      office_lat: r.office_lat ?? null,
      office_lon: r.office_lon ?? null,
      id: sid(r.id),
      score: typeof r.score === "number" ? r.score : null,
      company: r.company ?? null,
      remote_type: r.remote_type ?? null,
    })),
  );
  const out: PositionCoord[] = [];
  rows.forEach((r, i) => {
    const c = pins[i];
    if (!c) return;
    out.push({
      id: sid(r.id),
      title: r.title,
      company: r.company,
      status: r.status,
      role_family: r.role_family ?? null,
      score: typeof r.score === "number" ? r.score : null,
      lat: c.lat,
      lon: c.lon,
      // La colonna is_remote è storicamente sempre false (campo morto):
      // la verità sta in remote_type.
      is_remote: r.remote_type === "full_remote",
      remote_type: (r.remote_type as string | null) ?? null,
      location: r.location ?? null,
      loc_country: r.loc_country ?? null,
      loc_city: r.loc_city ?? null,
      office_address: r.office_address ?? null,
      created_at: r.created_at ?? null,
    });
  });
  return out;
}

// ── Tree gerarchico location (country → cities → positions) ──────
// Stessa forma prodotta da queries.ts (Supabase): il tipo vive in
// lib/types.ts perché le due corsie devono restituire la stessa cosa.
// Usa loc_country/loc_city strutturati.
import type {
  LocationPositionLite,
  LocationCity,
  LocationCountry,
} from "@/lib/types";
export type { LocationPositionLite, LocationCity, LocationCountry };

export function getPositionLocationsLocal(ws: string): LocationCountry[] {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT p.id, p.title, p.company, p.loc_country, p.loc_city,
           s.total_score AS score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
  `,
    )
    .all() as Array<{
    id: any;
    title: string | null;
    company: string | null;
    loc_country: string | null;
    loc_city: string | null;
    score: number | null;
  }>;
  const byCountry = new Map<
    string,
    Map<string | null, LocationPositionLite[]>
  >();
  for (const r of rows) {
    const country = r.loc_country?.trim() || "(unknown)";
    const city = r.loc_city?.trim() || null;
    const cMap =
      byCountry.get(country) ??
      new Map<string | null, LocationPositionLite[]>();
    const arr = cMap.get(city) ?? [];
    arr.push({
      id: sid(r.id),
      title: r.title,
      company: r.company,
      score: typeof r.score === "number" ? r.score : null,
    });
    cMap.set(city, arr);
    byCountry.set(country, cMap);
  }
  const out: LocationCountry[] = [];
  for (const [country, cMap] of byCountry) {
    const cities: LocationCity[] = [];
    let total = 0;
    for (const [city, positions] of cMap) {
      positions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      cities.push({ city, count: positions.length, positions });
      total += positions.length;
    }
    cities.sort((a, b) => {
      if (a.city == null) return 1;
      if (b.city == null) return -1;
      return b.count - a.count;
    });
    out.push({ country, count: total, cities });
  }
  out.sort((a, b) => {
    if (a.country === "(unknown)") return 1;
    if (b.country === "(unknown)") return -1;
    return b.count - a.count;
  });
  return out;
}

// ── Positions SENZA coordinate (per /map "remote bucket") ─────────
export function getPositionsWithoutCoordsLocal(ws: string) {
  const db = getDb(ws);
  // Tutte le non-escluse; tieni solo quelle senza pin città risolvibile.
  const rows = db
    .prepare(
      `
    SELECT p.id, p.title, p.company, p.status, p.location,
           p.loc_country, p.loc_city,
           p.role_family, p.created_at,
           s.total_score as score,
           p.is_remote, p.remote_type,
           p.office_lat, p.office_lon
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
  `,
    )
    .all() as any[];
  // Qui id/score non servono: interessa solo se il pin è risolvibile
  // (pins[i] truthy), non lo slot esatto nelle griglie. remote_type sì:
  // le full remote ora si risolvono (griglia-paese o isola) e devono
  // uscire da questo bucket.
  const pins = resolveCityPins(
    rows.map((r) => ({
      loc_country: r.loc_country ?? null,
      loc_city: r.loc_city ?? null,
      office_lat: r.office_lat ?? null,
      office_lon: r.office_lon ?? null,
      remote_type: r.remote_type ?? null,
    })),
  );
  const out: any[] = [];
  rows.forEach((r, i) => {
    if (pins[i]) return;
    out.push({
      id: sid(r.id),
      title: r.title as string | null,
      company: r.company as string | null,
      status: r.status as string,
      role_family: r.role_family as string | null,
      score: typeof r.score === "number" ? r.score : null,
      is_remote: r.remote_type === "full_remote",
      remote_type: (r.remote_type as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      loc_country: (r.loc_country as string | null) ?? null,
      loc_city: (r.loc_city as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
    });
  });
  return out;
}

// ── Faceting dataset per la sidebar /positions ────────────────────
// Universo completo (incluse excluded) con i campi per donut/score/location.
export function getPositionFacetsLocal(ws: string) {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT p.id, p.title, p.company, p.status, p.role_family,
           p.loc_country, p.loc_city,
           s.total_score as score,
           a.critic_score as critic_score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
  `,
    )
    .all() as any[];
  return rows.map((r) => ({
    id: sid(r.id),
    role_family: (r.role_family as string | null) ?? null,
    score: typeof r.score === "number" ? r.score : null,
    critic_score: typeof r.critic_score === "number" ? r.critic_score : null,
    loc_country: (r.loc_country as string | null) ?? null,
    loc_city: (r.loc_city as string | null) ?? null,
    status: r.status as string,
    title: (r.title as string | null) ?? null,
    company: (r.company as string | null) ?? null,
  }));
}

// ── Dataset dashboard: facet + campi tabella + recency (universo attivo) ──
// Sceglie l'evento col timestamp più recente (copia locale di pickLastAction
// in queries.ts: evita un import circolare local-queries <-> queries).
function pickLastActionLocal(
  cands: Array<{
    ts: string | null | undefined;
    by: string;
    actor: string | null | undefined;
  }>,
): { at: string; by: string; actor: string } {
  let best: { at: string; by: string; actor: string } | null = null;
  for (const c of cands) {
    if (!c.ts) continue;
    if (!best || c.ts > best.at)
      best = { at: c.ts, by: c.by, actor: c.actor || c.by };
  }
  return best ?? { at: "", by: "scout", actor: "scout" };
}

export function getDashboardPositionsLocal(ws: string) {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT p.id, p.legacy_id, p.title, p.company, p.location, p.remote_type,
           p.status, p.role_family, p.loc_country, p.loc_city, p.source,
           p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
           p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
           p.found_at, p.found_by,
           s.total_score as score, s.scored_at AS scored_at, s.scored_by AS scored_by,
           a.written_at AS written_at, a.written_by AS written_by,
           a.critic_reviewed_at AS critic_reviewed_at, a.reviewed_by AS reviewed_by,
           a.applied_at AS applied_at, a.response_at AS response_at,
           a.critic_score AS critic_score, a.critic_verdict AS critic_verdict,
           MAX(
             COALESCE(p.found_at, '1970-01-01'),
             COALESCE(p.last_checked, '1970-01-01'),
             COALESCE(s.scored_at, '1970-01-01'),
             COALESCE(a.written_at, '1970-01-01'),
             COALESCE(a.critic_reviewed_at, '1970-01-01'),
             COALESCE(a.applied_at, '1970-01-01'),
             COALESCE(a.response_at, '1970-01-01')
           ) AS last_action_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY last_action_at DESC
  `,
    )
    .all() as any[];
  return rows.map((r) => {
    const {
      at,
      by: last_action_by,
      actor: last_action_actor,
    } = pickLastActionLocal([
      { ts: r.found_at, by: "scout", actor: r.found_by },
      { ts: r.last_checked, by: "analista", actor: "analista" },
      { ts: r.scored_at, by: "scorer", actor: r.scored_by },
      { ts: r.written_at, by: "scrittore", actor: r.written_by },
      // critic_reviewed_at è scritto dallo SCRITTORE (chiamata --critic-score;
      // il critico non tocca mai il DB — single-writer rule, bug #21).
      { ts: r.critic_reviewed_at, by: "scrittore", actor: r.written_by },
      { ts: r.applied_at, by: "user", actor: "user" },
      { ts: r.response_at, by: "user", actor: "user" },
    ]);
    return {
      id: sid(r.id),
      legacy_id: (r.legacy_id as number | null) ?? null,
      title: (r.title as string | null) ?? null,
      company: (r.company as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      remote_type: (r.remote_type as string | null) ?? null,
      status: r.status as string,
      score: typeof r.score === "number" ? r.score : null,
      role_family: (r.role_family as string | null) ?? null,
      loc_country: (r.loc_country as string | null) ?? null,
      loc_city: (r.loc_city as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      salary_min:
        (((r.salary_estimated_min ?? r.salary_estimated_max) != null
          ? r.salary_estimated_min
          : r.salary_declared_min) as number | null) ?? null,
      salary_max:
        (((r.salary_estimated_min ?? r.salary_estimated_max) != null
          ? r.salary_estimated_max
          : r.salary_declared_max) as number | null) ?? null,
      salary_currency:
        (((r.salary_estimated_min ?? r.salary_estimated_max) != null
          ? r.salary_estimated_currency
          : r.salary_declared_currency) as string | null) ?? "EUR",
      found_at: (r.found_at as string | null) ?? null,
      scored_at: (r.scored_at as string | null) ?? null,
      last_action_at: ((r.last_action_at as string | null) ?? "") || at,
      last_action_by,
      last_action_actor,
      critic_score: typeof r.critic_score === "number" ? r.critic_score : null,
      critic_verdict: (r.critic_verdict as string | null) ?? null,
    };
  });
}

// ── Position state-history (timestamp transizioni) ────────────────
export function getPositionStateHistoryLocal(ws: string) {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT p.id AS id,
           p.status AS status,
           p.found_at AS found_at,
           p.last_checked AS last_checked,
           s.scored_at AS scored_at,
           a.written_at AS written_at,
           a.critic_reviewed_at AS critic_reviewed_at,
           a.critic_verdict AS critic_verdict,
           a.applied_at AS applied_at,
           a.response_at AS response_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
  `,
    )
    .all() as Array<{
    id: number | string;
    status: string;
    found_at: string | null;
    last_checked: string | null;
    scored_at: string | null;
    written_at: string | null;
    critic_reviewed_at: string | null;
    critic_verdict: string | null;
    applied_at: string | null;
    response_at: string | null;
  }>;
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

// ── Position type distribution ──────────────────────────────────────
// Legge la colonna positions.role_family (popolata dal team analyst).
// score → scores.total_score, critic → applications.critic_score (0-10).
// LEFT JOIN entrambi: aggregateRoleFamilies filtra null nel calcolo delle
// medie, includiamo anche posizioni senza voto.
export function getPositionTypeDistributionLocal(
  ws: string,
): RoleFamilyCount[] {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT p.role_family AS role_family,
           s.total_score AS score,
           a.critic_score AS critic
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    WHERE p.status != 'excluded'
  `,
    )
    .all() as {
    role_family: string | null;
    score: number | null;
    critic: number | null;
  }[];
  return aggregateRoleFamilies(rows);
}

// ── Source distribution ─────────────────────────────────────────────
export function getSourceDistributionLocal(
  ws: string,
): Array<{ source: string; count: number }> {
  const db = getDb(ws);
  const rows = db
    .prepare(
      `
    SELECT COALESCE(source, 'sconosciuta') as source, COUNT(*) as cnt
    FROM positions WHERE status != 'excluded'
    GROUP BY source ORDER BY cnt DESC LIMIT 8
  `,
    )
    .all() as { source: string; cnt: number }[];

  return rows.map((r) => ({ source: r.source, count: r.cnt }));
}

// ── Scout stats ─────────────────────────────────────────────────────
export function getScoutStatsLocal(ws: string) {
  const db = getDb(ws);
  const positions = db
    .prepare("SELECT id, found_by, status FROM positions")
    .all() as any[];
  const respondedIds = new Set(
    (
      db
        .prepare(
          "SELECT position_id FROM applications WHERE status = 'response' OR response IS NOT NULL",
        )
        .all() as any[]
    ).map((r) => r.position_id),
  );

  const grouped: Record<
    string,
    { total: number; excluded: number; applied: number; responded: number }
  > = {};
  for (const row of positions) {
    const key = row.found_by ?? "sconosciuto";
    if (!grouped[key])
      grouped[key] = { total: 0, excluded: 0, applied: 0, responded: 0 };
    grouped[key].total++;
    if (row.status === "excluded") grouped[key].excluded++;
    if (row.status === "applied" || row.status === "response")
      grouped[key].applied++;
    if (respondedIds.has(row.id)) grouped[key].responded++;
  }
  return Object.entries(grouped)
    .map(([scout, s]) => ({
      scout,
      total: s.total,
      active: s.total - s.excluded,
      excluded: s.excluded,
      applied: s.applied,
      responded: s.responded,
    }))
    .sort((a, b) => b.total - a.total);
}

// ── Scorer stats ────────────────────────────────────────────────────
export function getScorerStatsLocal(ws: string) {
  const db = getDb(ws);
  const rows = db
    .prepare("SELECT scored_by, total_score FROM scores")
    .all() as { scored_by: string | null; total_score: number }[];
  const grouped: Record<string, number[]> = {};
  for (const row of rows) {
    const key = row.scored_by ?? "sconosciuto";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row.total_score);
  }
  return Object.entries(grouped)
    .map(([scorer, scores]) => ({
      scorer,
      total: scores.length,
      avgScore:
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0,
      high: scores.filter((s) => s >= 70).length,
      mid: scores.filter((s) => s >= 40 && s < 70).length,
      low: scores.filter((s) => s < 40).length,
    }))
    .sort((a, b) => b.total - a.total);
}

// ── Analista activity (feed live) — local mirror di /api/analista/activity ──
// Categorizza il motivo di esclusione dalle notes (stessa euristica della route
// Supabase). Esportata perché la route la riusa anche nel ramo cloud (single
// source of truth, niente duplicazione delle regex).
export function categorizeExclusion(notes: string | null): string {
  const n = (notes || "").toLowerCase();
  const m = n.match(/esclus[ao]:\s*\[(\w+)\]/i);
  if (m) return m[1].toUpperCase();
  if (
    /link scaduto|link morto|404|redirect|lavoro occupato|pagina rimossa|url morto/.test(
      n,
    )
  )
    return "LINK_MORTO";
  if (/score < 40|score <40|score basso/.test(n)) return "SCORE_BASSO";
  if (/duplicat|già presente|stessa posizione/.test(n)) return "DUPLICATA";
  if (
    /us-only|uk-only|americas|restrizione geografica|work authorization uk|post-brexit/.test(
      n,
    )
  )
    return "GEO";
  if (/lingua croata|tedesco obbligat|polacco|ungherese|français|dutch/.test(n))
    return "LINGUA";
  if (/senior con 5\+|5\+ anni obbligatori|seniority troppo/.test(n))
    return "SENIORITY";
  if (/senza python|no python|solo java|solo node|stack incomp/.test(n))
    return "STACK";
  if (/zero sviluppo|mismatch|ruolo non-dev|iam analyst|no coding/.test(n))
    return "RUOLO";
  if (/scam|fantasma|red flag/.test(n)) return "SCAM";
  if (/voto critico|critic/.test(n)) return "CRITICO";
  return "NON_CATEGORIZZATA";
}

// Stessa shape JSON di GET /api/analista/activity, letta da jobs.db.
// Le date sono confronti lessicografici su stringhe ISO (YYYY-MM-DD prefix),
// fedeli al `.gte("last_checked", today)` della route Supabase.
export function getAnalistaActivityLocal(ws: string) {
  const db = getDb(ws);
  const today = new Date().toISOString().slice(0, 10);
  const recentCols =
    "id, title, company, location, remote_type, status, source, found_at, last_checked, notes";
  const queue = db
    .prepare(
      `SELECT id, title, company, location, remote_type, source, found_by, found_at, notes
         FROM positions WHERE status = 'new' ORDER BY id DESC LIMIT 10`,
    )
    .all();
  const recent_processed = db
    .prepare(
      `SELECT ${recentCols} FROM positions WHERE status = 'checked' ORDER BY last_checked DESC LIMIT 10`,
    )
    .all();
  const recent_excluded = db
    .prepare(
      `SELECT ${recentCols} FROM positions WHERE status = 'excluded' AND last_checked IS NOT NULL ORDER BY last_checked DESC LIMIT 10`,
    )
    .all();
  const countWhere = (where: string, ...args: any[]): number =>
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM positions WHERE ${where}`)
        .get(...args) as any
    ).c;
  const queue_size = countWhere("status = 'new'");
  const checked_total = countWhere("status = 'checked'");
  const analyzed_today = countWhere(
    "status = 'checked' AND last_checked >= ?",
    today,
  );
  const excluded_today = countWhere(
    "status = 'excluded' AND last_checked >= ?",
    today,
  );
  const excludedRows = db
    .prepare(
      `SELECT notes FROM positions WHERE status = 'excluded' AND last_checked >= ?`,
    )
    .all(today) as any[];
  const exclusion_categories: Record<string, number> = {};
  for (const row of excludedRows) {
    const cat = categorizeExclusion(row.notes);
    exclusion_categories[cat] = (exclusion_categories[cat] ?? 0) + 1;
  }
  return {
    queue,
    recent_processed,
    recent_excluded,
    queue_size,
    checked_total,
    analyzed_today,
    excluded_today,
    ratio: { checked: analyzed_today, excluded: excluded_today },
    exclusion_categories,
  };
}

// ── Scout activity — local mirror di /api/scout/activity ──────────────
export function getScoutActivityLocal(ws: string) {
  const db = getDb(ws);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const cnt = (where: string, ...a: any[]): number =>
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM positions WHERE ${where}`)
        .get(...a) as any
    ).c;
  const queue = db
    .prepare(
      `SELECT id, title, company, location, remote_type, found_at, found_by
         FROM positions WHERE status = 'new' ORDER BY found_at DESC LIMIT 10`,
    )
    .all();
  const recent = db
    .prepare(
      `SELECT id, title, company, location, remote_type, found_at, found_by, status
         FROM positions WHERE status <> 'excluded' ORDER BY found_at DESC LIMIT 10`,
    )
    .all();
  const excluded_today = db
    .prepare(
      `SELECT id, title, company, location, remote_type, found_at, notes
         FROM positions WHERE status = 'excluded' AND found_at >= ? ORDER BY found_at DESC LIMIT 10`,
    )
    .all(todayISO);
  return {
    stats: {
      found_today: cnt("found_at >= ?", todayISO),
      total_new: cnt("status = 'new'"),
    },
    queue,
    recent,
    excluded_today,
  };
}

// ── Scorer activity — local mirror di /api/scorer/activity ────────────
export function getScorerActivityLocal(ws: string) {
  const db = getDb(ws);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const queue = db
    .prepare(
      `SELECT id, title, company, location, remote_type, found_at AS last_checked,
              COALESCE(notes, '') AS notes
         FROM positions WHERE status = 'checked' ORDER BY found_at DESC LIMIT 10`,
    )
    .all();
  const queue_size = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM positions WHERE status = 'checked'`)
      .get() as any
  ).c;
  const scoredSelect = `SELECT s.position_id AS id, s.total_score, s.scored_at, s.scored_by,
                               COALESCE(p.title, '—') AS title, COALESCE(p.company, '—') AS company,
                               COALESCE(p.location, '') AS location, COALESCE(p.remote_type, '') AS remote_type
                          FROM scores s LEFT JOIN positions p ON p.id = s.position_id`;
  const recent_scored = db
    .prepare(
      `${scoredSelect} WHERE s.total_score >= 40 ORDER BY s.scored_at DESC LIMIT 10`,
    )
    .all();
  const recent_excluded = db
    .prepare(
      `${scoredSelect} WHERE s.total_score < 40 ORDER BY s.scored_at DESC LIMIT 10`,
    )
    .all();
  const scored_total = (
    db.prepare(`SELECT COUNT(*) AS c FROM scores`).get() as any
  ).c;
  const todayScores = (
    db
      .prepare(`SELECT total_score FROM scores WHERE scored_at >= ?`)
      .all(todayISO) as any[]
  ).map((r) => r.total_score as number);
  const scored_today = todayScores.length;
  const excluded_today = todayScores.filter((s) => s < 40).length;
  const avg_score_today =
    scored_today > 0
      ? +(todayScores.reduce((a, b) => a + b, 0) / scored_today).toFixed(1)
      : null;
  return {
    stats: {
      queue_size,
      scored_total,
      scored_today,
      excluded_today,
      avg_score_today,
    },
    queue,
    recent_scored,
    recent_excluded,
  };
}

// ── Critico activity — local mirror di /api/critico ───────────────────
// NB: `critic_round` non esiste nello schema SQLite (campo solo-cloud) → null.
export function getCriticoActivityLocal(ws: string) {
  const db = getDb(ws);
  const apps = db
    .prepare(
      `SELECT a.id, a.status, a.critic_score, a.critic_verdict, a.critic_reviewed_at,
              a.written_at, a.written_by, a.reviewed_by,
              COALESCE(p.title, '—') AS title, COALESCE(p.company, '—') AS company
         FROM applications a LEFT JOIN positions p ON p.id = a.position_id
        WHERE a.status = 'review' OR a.critic_verdict IS NOT NULL
        ORDER BY a.critic_reviewed_at IS NULL, a.critic_reviewed_at DESC`,
    )
    .all() as any[];
  const allReviewed = apps.filter((a) => a.critic_verdict != null);
  const pass = allReviewed.filter((a) => a.critic_verdict === "PASS").length;
  const needsWork = allReviewed.filter(
    (a) => a.critic_verdict === "NEEDS_WORK",
  ).length;
  const reject = allReviewed.filter(
    (a) => a.critic_verdict === "REJECT",
  ).length;
  const scores = allReviewed
    .map((a) => a.critic_score)
    .filter((s: any): s is number => s != null);
  const avgScore =
    scores.length > 0
      ? +(
          scores.reduce((a: number, b: number) => a + b, 0) / scores.length
        ).toFixed(1)
      : null;
  const queue = apps
    .filter((a) => a.status === "review" && a.critic_score == null)
    .map((a) => ({
      id: a.id,
      title: a.title,
      company: a.company,
      written_by: a.written_by,
      written_at: a.written_at,
    }));
  const feed = allReviewed.slice(0, 10).map((a) => ({
    id: a.id,
    title: a.title,
    company: a.company,
    critic_verdict: a.critic_verdict,
    critic_score: a.critic_score,
    critic_round: null,
    critic_reviewed_at: a.critic_reviewed_at,
    reviewed_by: a.reviewed_by,
    written_by: a.written_by,
  }));
  const agentMap: Record<
    string,
    { total: number; pass: number; needsWork: number; reject: number }
  > = {};
  for (const a of allReviewed) {
    const key = a.reviewed_by ?? "sconosciuto";
    if (!agentMap[key])
      agentMap[key] = { total: 0, pass: 0, needsWork: 0, reject: 0 };
    agentMap[key].total++;
    if (a.critic_verdict === "PASS") agentMap[key].pass++;
    if (a.critic_verdict === "NEEDS_WORK") agentMap[key].needsWork++;
    if (a.critic_verdict === "REJECT") agentMap[key].reject++;
  }
  const byAgent = Object.entries(agentMap)
    .map(([critico, s]) => ({ critico, ...s }))
    .sort((a, b) => b.total - a.total);
  return {
    stats: {
      total: allReviewed.length,
      pending: queue.length,
      pass,
      needsWork,
      reject,
      avgScore,
    },
    queue,
    feed,
    byAgent,
  };
}

// ── Scrittore activity — local mirror di /api/scrittore/activity ──────
// NB: `critic_round` non esiste nello schema SQLite (campo solo-cloud) → null.
export function getScrittoreActivityLocal(ws: string) {
  const db = getDb(ws);
  const today = new Date().toISOString().slice(0, 10);
  const queueRaw = db
    .prepare(
      `SELECT p.id, p.title, p.company, p.location, p.remote_type, p.notes, p.status,
              s.total_score AS total_score
         FROM positions p LEFT JOIN scores s ON s.position_id = p.id
        WHERE p.status = 'scored' ORDER BY p.id DESC LIMIT 30`,
    )
    .all() as any[];
  const queue = queueRaw
    .filter((p) => p.total_score != null && p.total_score >= 50)
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 15);
  const progRows = db
    .prepare(
      `SELECT p.id, p.title, p.company, p.location, p.remote_type, p.status, p.notes,
              s.total_score AS total_score,
              a.written_by, a.critic_score, a.critic_verdict, a.written_at, a.critic_reviewed_at
         FROM positions p
         LEFT JOIN scores s ON s.position_id = p.id
         LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.status IN ('writing', 'review') ORDER BY p.id DESC LIMIT 20`,
    )
    .all() as any[];
  const in_progress = progRows.map((p) => ({
    ...p,
    total_score: p.total_score ?? null,
    critic_round: null,
    critic_active: p.status === "review",
  }));
  const compRows = db
    .prepare(
      `SELECT p.id, p.title, p.company, p.location, p.remote_type, p.status,
              s.total_score AS total_score,
              a.written_by, a.critic_score, a.critic_verdict, a.critic_reviewed_at
         FROM positions p
         LEFT JOIN scores s ON s.position_id = p.id
         LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.status = 'ready' ORDER BY p.last_checked DESC LIMIT 10`,
    )
    .all() as any[];
  const recent_completed = compRows.map((p) => ({
    ...p,
    total_score: p.total_score ?? null,
    critic_round: null,
  }));
  const cnt = (sql: string, ...a: any[]): number =>
    (db.prepare(sql).get(...a) as any).c;
  const queue_size = cnt(
    `SELECT COUNT(*) AS c FROM positions WHERE status = 'scored'`,
  );
  const writing_today = cnt(
    `SELECT COUNT(*) AS c FROM applications WHERE written_at >= ?`,
    today,
  );
  const completed_today = cnt(
    `SELECT COUNT(*) AS c FROM applications WHERE critic_score IS NOT NULL AND critic_reviewed_at >= ?`,
    today,
  );
  const avgRows = db
    .prepare(
      `SELECT critic_score FROM applications WHERE critic_score IS NOT NULL AND critic_reviewed_at >= ?`,
    )
    .all(today) as any[];
  const avg_critic_score =
    avgRows.length > 0
      ? Math.round(
          (avgRows.reduce((acc, r) => acc + (r.critic_score ?? 0), 0) /
            avgRows.length) *
            10,
        ) / 10
      : null;
  return {
    queue,
    in_progress,
    recent_completed,
    queue_size,
    writing_today,
    completed_today,
    avg_critic_score,
  };
}

// Storico completo per la pagina /messages: stessi campi dei pendenti ma
// SENZA il filtro acknowledged (i letti restano visibili in coda alla lista).
// [JHT-CHAT-UNIFY] Niente più filtro `delivered_via='web'`: la colonna dice
// per quale CANALE è passata la notifica, non se il messaggio fa parte della
// conversazione. Con Telegram configurato, `jht-notify-user` marcava
// 'telegram' e quel turno spariva dalla chat del sito — metà delle risposte
// dell'agente invisibili sul web. `author` distingue i due lati della
// conversazione (colonna aggiunta da mig 060 / _db.py; i DB più vecchi non ce
// l'hanno, quindi si legge in modo difensivo).
export function getMessagesHistoryLocal(
  ws: string,
  limit = 200,
): PendingMessage[] {
  const db = getDb(ws);
  const author = hasColumn(db, "pending_user_messages", "author")
    ? "author"
    : "'agent' AS author";
  const rows = db
    .prepare(
      `
    SELECT id, agent, body, kind, ${author}, related_position_id,
           delivered_via, delivered_at, acknowledged_at,
           user_reply, user_reply_at, agent_seen_reply_at, created_at
    FROM pending_user_messages
    ORDER BY created_at DESC
    LIMIT ?
  `,
    )
    .all(limit) as any[];

  return rows.map((r) => ({
    id: sid(r.id),
    agent: r.agent,
    body: r.body,
    kind: r.kind,
    author: r.author === "user" ? "user" : "agent",
    related_position_id:
      r.related_position_id != null ? sid(r.related_position_id) : null,
    delivered_via: r.delivered_via,
    delivered_at: r.delivered_at,
    acknowledged_at: r.acknowledged_at,
    user_reply: r.user_reply,
    user_reply_at: r.user_reply_at,
    agent_seen_reply_at: r.agent_seen_reply_at,
    created_at: r.created_at,
  }));
}

// Conteggio esatto dei non letti (il banner in dashboard non deve saturare
// al limit della lista come faceva il vecchio "{n} non letti").
// Non letti = turni dell'AGENTE non ancora ack-ati. I turni scritti
// dall'utente non si contano (li ha scritti lui). Vedi la nota sul filtro
// `delivered_via` su getMessagesHistoryLocal.
export function countPendingMessagesLocal(ws: string): number {
  const db = getDb(ws);
  const onlyAgent = hasColumn(db, "pending_user_messages", "author")
    ? "author = 'agent' AND "
    : "";
  const row = db
    .prepare(
      `
    SELECT COUNT(*) AS n
    FROM pending_user_messages
    WHERE ${onlyAgent}acknowledged_at IS NULL
  `,
    )
    .get() as { n: number };
  return row?.n ?? 0;
}

export function ackPendingMessageLocal(ws: string, id: string): boolean {
  const db = getDb(ws);
  const result = db
    .prepare(
      `
    UPDATE pending_user_messages
    SET acknowledged_at = CURRENT_TIMESTAMP
    WHERE id = ? AND acknowledged_at IS NULL
  `,
    )
    .run(id);
  return result.changes > 0;
}

// Marca come letti tutti i messaggi web pendenti in un colpo solo. Il filtro
// (delivered_via='web' AND non ack) è lo stesso di countPendingMessagesLocal,
// cosi' azzera esattamente cio' che la dashboard mostra. Ritorna il n. di righe.
export function ackAllPendingMessagesLocal(ws: string): number {
  const db = getDb(ws);
  const result = db
    .prepare(
      `
    UPDATE pending_user_messages
    SET acknowledged_at = CURRENT_TIMESTAMP
    WHERE delivered_via = 'web' AND acknowledged_at IS NULL
  `,
    )
    .run();
  return result.changes;
}

// [JHT-CHAT-UNIFY] Turno dell'utente in modalità locale (desktop / tunnel).
// Nasce senza `chat_ts` e senza `delivered_at`: se ne occupa la corsia chat
// del daemon, che lo specchia in `chat.jsonl` (il gioco lo vede) e lo
// consegna al pane dell'agente con `jht-tmux-send`. Qui NON si tocca tmux:
// il web non lancia processi, li chiede.
export function sendUserChatLocal(
  ws: string,
  agent: string,
  body: string,
): string {
  const db = getDb(ws);
  if (!hasColumn(db, "pending_user_messages", "author")) {
    throw new Error(
      "il database locale non ha ancora la colonna `author`: riavvia il container per applicare le migrazioni",
    );
  }
  const result = db
    .prepare(
      `
    INSERT INTO pending_user_messages (agent, body, kind, author, delivered_via)
    VALUES (?, ?, 'notification', 'user', 'web')
  `,
    )
    .run(agent, body);
  return sid(Number(result.lastInsertRowid));
}

export function replyPendingMessageLocal(
  ws: string,
  id: string,
  reply: string,
): boolean {
  const db = getDb(ws);
  // Risposta + ack atomico: una reply implica visione.
  const result = db
    .prepare(
      `
    UPDATE pending_user_messages
    SET user_reply = ?,
        user_reply_at = CURRENT_TIMESTAMP,
        acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
    WHERE id = ?
  `,
    )
    .run(reply, id);
  return result.changes > 0;
}

// ── Team activity (per-agente nel tempo) ───────────────────────────
// Stream di eventi di lavoro: ogni timestamp = un'azione di un agente.
//   scout     → positions.found_at
//   analista  → positions.last_checked
//   scorer    → scores.scored_at
//   scrittore → applications.written_at
//   critico   → applications.critic_reviewed_at
// Tutte colonne su tabelle sincronizzate su Supabase, così la vista è
// identica in locale e in cloud. Bucketing + finestra li gestisce
// buildTeamActivity (vedi lib/team-activity.ts).
export function getTeamActivityLocal(
  ws: string,
  fromKey: string,
  toKey: string,
): TeamActivity {
  const db = getDb(ws);
  const events: TeamActivityEvent[] = [];
  // `actor` = id istanza dalla colonna *_by quando disponibile; l'Analista
  // (last_checked) non lo porta → normActor ricade sul ruolo. Filtriamo per
  // range su disco (substr(ts,1,10) ∈ [from,to]) per non caricare tutto lo
  // storico; buildTeamActivity ignora comunque ciò che è fuori range.
  // idCol = colonna con l'id della posizione (positions.id → 'id';
  // scores/applications → 'position_id') per il link al dettaglio.
  const collect = (
    col: string,
    actorExpr: string,
    idCol: string,
    table: string,
    role: TeamActivityEvent["role"],
  ) => {
    const sql =
      `SELECT ${col} AS ts, ${actorExpr} AS actor, ${idCol} AS pid FROM ${table} ` +
      `WHERE ${col} IS NOT NULL AND substr(${col},1,10) BETWEEN ? AND ?`;
    const rows = db.prepare(sql).all(fromKey, toKey) as {
      ts: string | null;
      actor: string | null;
      pid: number | string | null;
    }[];
    for (const r of rows)
      if (r.ts)
        events.push({
          role,
          actor: normActor(role, r.actor),
          ts: r.ts,
          pid: r.pid != null ? String(r.pid) : null,
        });
  };
  collect("found_at", "found_by", "id", "positions", "scout");
  collect("last_checked", "NULL", "id", "positions", "analista");
  collect("scored_at", "scored_by", "position_id", "scores", "scorer");
  collect(
    "written_at",
    "written_by",
    "position_id",
    "applications",
    "scrittore",
  );
  collect(
    "critic_reviewed_at",
    "reviewed_by",
    "position_id",
    "applications",
    "critico",
  );
  const act = buildTeamActivity(events, fromKey, toKey);

  // Arricchisce SOLO il feed recente (≤40) con titolo/azienda/id leggibile.
  const pids = [
    ...new Set(act.recent.map((r) => r.pid).filter((p): p is string => !!p)),
  ];
  if (pids.length) {
    const rows = db
      .prepare(
        `SELECT id, legacy_id, title, company FROM positions WHERE id IN (${pids.map(() => "?").join(",")})`,
      )
      .all(...pids) as {
      id: number | string;
      legacy_id: number | null;
      title: string | null;
      company: string | null;
    }[];
    const meta = new Map(rows.map((r) => [String(r.id), r]));
    for (const ev of act.recent) {
      const m = ev.pid ? meta.get(ev.pid) : undefined;
      if (m) {
        ev.title = m.title;
        ev.company = m.company;
        ev.legacyId = m.legacy_id;
      }
    }
  }
  return act;
}

// ── Activity log (TUTTE le azioni, per la pagina dedicata) ──────────
// UNION delle 5 sorgenti di eventi, arricchito con titolo/azienda/id leggibile
// via JOIN su positions, ordinato dal più recente. Per l'analista usiamo
// last_actor SE è un'istanza analista (posizione ancora in checked/excluded),
// altrimenti ricade su 'analista' (il cloud non ha proprio l'istanza analista).
export function getTeamActivityLogLocal(ws: string): RecentActivityEvent[] {
  const db = getDb(ws);
  let rows: any[];
  const SQL = (analistaActor: string) => `
    SELECT role, actor, ts, pid, title, company, legacy_id FROM (
      SELECT 'scout' role, found_by actor, found_at ts, id pid, title, company, legacy_id FROM positions WHERE found_at IS NOT NULL
      UNION ALL
      SELECT 'analista', ${analistaActor}, last_checked, id, title, company, legacy_id FROM positions WHERE last_checked IS NOT NULL
      UNION ALL
      SELECT 'scorer', s.scored_by, s.scored_at, p.id, p.title, p.company, p.legacy_id FROM scores s JOIN positions p ON p.id=s.position_id WHERE s.scored_at IS NOT NULL
      UNION ALL
      SELECT 'scrittore', a.written_by, a.written_at, p.id, p.title, p.company, p.legacy_id FROM applications a JOIN positions p ON p.id=a.position_id WHERE a.written_at IS NOT NULL
      UNION ALL
      SELECT 'critico', a.reviewed_by, a.critic_reviewed_at, p.id, p.title, p.company, p.legacy_id FROM applications a JOIN positions p ON p.id=a.position_id WHERE a.critic_reviewed_at IS NOT NULL
    ) ORDER BY ts DESC`;
  try {
    rows = db
      .prepare(
        SQL(
          "CASE WHEN last_actor LIKE 'analista%' THEN last_actor ELSE NULL END",
        ),
      )
      .all() as any[];
  } catch {
    // workspace senza colonna last_actor → analista aggregato
    rows = db.prepare(SQL("NULL")).all() as any[];
  }
  return rows.map((r) => ({
    role: r.role,
    actor: normActor(r.role, r.actor),
    ts: r.ts,
    pid: r.pid != null ? String(r.pid) : null,
    title: r.title ?? null,
    company: r.company ?? null,
    legacyId: r.legacy_id ?? null,
  }));
}

// ── Mapping helpers ─────────────────────────────────────────────────

function mapPosition(r: any): PositionWithScore {
  return {
    id: sid(r.id),
    legacy_id: r.legacy_id ?? null,
    title: r.title,
    company: r.company,
    company_id: r.company_id ? sid(r.company_id) : null,
    location: r.location,
    remote_type: r.remote_type,
    salary_declared_min: r.salary_declared_min,
    salary_declared_max: r.salary_declared_max,
    salary_declared_currency: r.salary_declared_currency ?? null,
    salary_estimated_min: r.salary_estimated_min ?? null,
    salary_estimated_max: r.salary_estimated_max ?? null,
    salary_estimated_currency: r.salary_estimated_currency ?? null,
    salary_estimated_source: r.salary_estimated_source ?? null,
    url: r.url,
    source: r.source,
    jd_text: r.jd_text ?? null,
    jd_summary: r.jd_summary ?? null,
    requirements: r.requirements ?? null,
    found_by: r.found_by,
    found_at: r.found_at ?? "",
    deadline: r.deadline ?? null,
    status: r.status,
    notes: r.notes ?? null,
    last_checked: r.last_checked ?? null,
    role_family: r.role_family ?? null,
    loc_country: r.loc_country ?? null,
    loc_city: r.loc_city ?? null,
    score: r.score ?? undefined,
    critic_score: r.critic_score ?? null,
    critic_verdict: r.critic_verdict ?? null,
    scores:
      r.stack_match != null
        ? {
            id: "",
            position_id: sid(r.id),
            total_score: r.score ?? 0,
            stack_match: r.stack_match,
            remote_fit: r.remote_fit,
            salary_fit: r.salary_fit,
            experience_fit: r.experience_fit ?? null,
            strategic_fit: r.strategic_fit,
            breakdown: null,
            notes: null,
            scored_by: null,
            scored_at: "",
          }
        : undefined,
  };
}

function mapPositionFull(r: any): Position {
  return {
    id: sid(r.id),
    legacy_id: r.legacy_id ?? null,
    title: r.title,
    company: r.company,
    company_id: r.company_id ? sid(r.company_id) : null,
    location: r.location,
    remote_type: r.remote_type,
    salary_declared_min: r.salary_declared_min,
    salary_declared_max: r.salary_declared_max,
    salary_declared_currency: r.salary_declared_currency ?? null,
    salary_estimated_min: r.salary_estimated_min ?? null,
    salary_estimated_max: r.salary_estimated_max ?? null,
    salary_estimated_currency: r.salary_estimated_currency ?? null,
    salary_estimated_source: r.salary_estimated_source ?? null,
    url: r.url,
    source: r.source,
    jd_text: r.jd_text ?? null,
    jd_summary: r.jd_summary ?? null,
    requirements: r.requirements ?? null,
    found_by: r.found_by,
    found_at: r.found_at ?? "",
    deadline: r.deadline ?? null,
    status: r.status,
    notes: r.notes ?? null,
    last_checked: r.last_checked ?? null,
    write_requested: r.write_requested === 1 || r.write_requested === true,
    write_requested_at: r.write_requested_at ?? null,
    geocode_requested:
      r.geocode_requested === 1 || r.geocode_requested === true,
    geocode_requested_at: r.geocode_requested_at ?? null,
    office_geocoded: r.office_geocoded === 1 || r.office_geocoded === true,
    user_excluded_reason: r.user_excluded_reason ?? null,
    user_excluded_note: r.user_excluded_note ?? null,
    user_excluded_at: r.user_excluded_at ?? null,
    user_excluded_prev_status: r.user_excluded_prev_status ?? null,
    recheck_requested:
      r.recheck_requested === 1 || r.recheck_requested === true,
    recheck_requested_at: r.recheck_requested_at ?? null,
    last_open_check: r.last_open_check ?? null,
  };
}

function mapScore(r: any): Score {
  return {
    id: sid(r.id),
    position_id: sid(r.position_id),
    total_score: r.total_score,
    stack_match: r.stack_match,
    remote_fit: r.remote_fit,
    salary_fit: r.salary_fit,
    experience_fit: r.experience_fit,
    strategic_fit: r.strategic_fit,
    breakdown: r.breakdown,
    notes: r.notes,
    scored_by: r.scored_by,
    scored_at: r.scored_at ?? "",
  };
}

function mapCompany(r: any): Company {
  return {
    id: sid(r.id),
    name: r.name,
    website: r.website,
    hq: r.hq_country ?? null,
    sector: r.sector,
    size: r.size,
    glassdoor_rating: r.glassdoor_rating,
    red_flags: r.red_flags,
    culture_notes: r.culture_notes,
    analyzed_by: r.analyzed_by,
    analyzed_at: r.analyzed_at,
    verdict: r.verdict,
    logo: r.logo ?? null,
  };
}

function mapApplication(r: any): Application {
  return {
    id: sid(r.id),
    position_id: sid(r.position_id),
    cv_path: r.cv_path,
    cl_path: r.cl_path,
    cv_pdf_path: r.cv_pdf_path,
    cl_pdf_path: r.cl_pdf_path,
    cv_drive_id: r.cv_drive_id ?? null,
    cl_drive_id: r.cl_drive_id ?? null,
    critic_verdict: r.critic_verdict,
    critic_score: r.critic_score,
    critic_notes: r.critic_notes,
    status: r.status,
    written_at: r.written_at,
    applied_at: r.applied_at,
    applied_via: r.applied_via,
    response: r.response,
    response_at: r.response_at,
    written_by: r.written_by,
    reviewed_by: r.reviewed_by,
    applied: !!r.applied,
    interview_round: r.interview_round,
  };
}

