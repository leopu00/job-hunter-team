// fresh
import { createClient } from "@/lib/supabase/server";
import {
  getWorkspacePath,
  isSupabaseConfigured,
  workspaceHasDb,
} from "@/lib/workspace";
import { isLocalRequest } from "@/lib/auth";
import { verdictOf, type Verdict } from "@/lib/position-verdict";
import * as local from "@/lib/local-queries";
// [JHT-WEB-DEMO] Modalità demo (onboarding cloud): quando il cookie
// jht_demo_persona è attivo le query servono il dataset statico della
// persona scelta nel wizard /welcome invece di interrogare Supabase.
// Il ramo demo sta in TESTA a ogni funzione: vince su local e cloud.
import { activeDemoPersona } from "@/lib/demo/mode";
import * as demo from "@/lib/demo/queries";
import { resolveCityPins } from "@/lib/city-coords";
import { salaryPreference } from "@/lib/salary-source";
import {
  aggregateRoleFamilies,
  UNCATEGORIZED_LABEL,
  type RoleFamilyCount,
} from "@/lib/position-classifier";
import {
  addDaysKey,
  buildTeamActivity,
  normActor,
  resolveActivityRange,
  TEAM_ACTIVITY_ROLES,
  type TeamActivity,
  type TeamActivityEvent,
  type TeamActivityRole,
  type RecentActivityEvent,
} from "@/lib/team-activity";
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
  LocationPositionLite,
  LocationCity,
  LocationCountry,
} from "@/lib/types";

// Source of truth = origine della request:
//   - host=localhost (Mac dell'utente, JHT Desktop o browser locale) → SQLite
//   - host pubblico (deploy Vercel) → Supabase
// Vale per tutte le query (dashboard, positions, applications, scores...).
// In local mode il banner cloud-sync e il filtro synced/unsynced funzionano
// perché vediamo TUTTE le row locali e usiamo Supabase come overlay (non
// come fonte). In cloud puro Supabase è l'unica fonte.
async function ws(): Promise<string | null> {
  if (!(await isLocalRequest())) return null;
  const p = await getWorkspacePath();
  if (!p || !workspaceHasDb(p)) return null;
  return p;
}

// ── Dashboard Stats ────────────────────────────────────────────────
const EMPTY_STATS: DashboardStats = {
  total: 0,
  new: 0,
  checked: 0,
  scored: 0,
  writing: 0,
  review: 0,
  ready: 0,
  applied: 0,
  excluded: 0,
  response: 0,
  scored_open: 0,
  to_write: 0,
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoDashboardStats(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getDashboardStatsLocal(w);
    } catch {
      return EMPTY_STATS;
    }
  }
  if (!isSupabaseConfigured) return EMPTY_STATS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select("status, write_requested")
    .is("deleted_at", null);
  if (error || !data) return EMPTY_STATS;

  const counts = data.reduce(
    (acc: Record<string, number>, row: any) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Pipeline write-requested-aware: il box "Da scrivere" conta le posizioni
  // selezionate dall'utente (write_requested) ma con CV non ancora pronto
  // (scored/writing/review); "Con lo score" conta le scored NON selezionate.
  const TO_WRITE_STATUSES = new Set(["scored", "writing", "review"]);
  let to_write = 0;
  let scored_requested = 0;
  for (const row of data as any[]) {
    if (row.write_requested && TO_WRITE_STATUSES.has(row.status)) to_write++;
    if (row.write_requested && row.status === "scored") scored_requested++;
  }
  const scored_open = (counts["scored"] ?? 0) - scored_requested;

  return {
    total: data.length,
    new: counts["new"] ?? 0,
    checked: counts["checked"] ?? 0,
    scored: counts["scored"] ?? 0,
    writing: counts["writing"] ?? 0,
    review: counts["review"] ?? 0,
    ready: counts["ready"] ?? 0,
    applied: counts["applied"] ?? 0,
    excluded: counts["excluded"] ?? 0,
    response: counts["response"] ?? 0,
    scored_open,
    to_write,
  };
}

// ── Helper relazioni Supabase ─────────────────────────────────────
// PostgREST rende una relazione ora come array ora come oggetto a
// seconda della cardinalità dedotta: normalizziamo al primo elemento.
function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ── Recent positions with scores ───────────────────────────────────
export async function getRecentPositions(
  limit = 15,
): Promise<(PositionWithScore & { last_action_at?: string })[]> {
  const w = await ws();
  if (w) {
    try {
      return local.getRecentPositionsLocal(w, limit);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, url, source, found_at, last_checked, status, notes, scores ( total_score, scored_at )",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("found_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((p: any) => {
    // last_action_at = ULTIMA azione: scout / analista / scorer
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    const candidates = [p.found_at, p.last_checked, score?.scored_at].filter(
      Boolean,
    ) as string[];
    const last_action_at =
      candidates.length > 0
        ? candidates.reduce((acc, cur) => (cur > acc ? cur : acc))
        : p.found_at;
    return { ...p, score: score?.total_score ?? undefined, last_action_at };
  });
}

// ── All positions with optional filters ────────────────────────────
// Sort: la dir base è applicata via supabase.order() per `found_at`
// (default). Per gli altri ordinamenti (score, critic, ecc.) il fetch
// resta su found_at e poi riordiniamo in memoria — limit 600 in chiamata
// è gestibile e tiene la logica fuori da PostgREST nested ordering.
const POSITION_SORT_KEYS = [
  "id",
  "title",
  "company",
  "role_family",
  "source",
  "location",
  "loc_city",
  "loc_country",
  "remote",
  "score",
  "salary",
  "monthly",
  "last_action_by",
  "critic",
  "found_at",
  "last_action_at",
  "status",
  "written_at",
  "applied_at",
] as const;
type PositionSortKey = (typeof POSITION_SORT_KEYS)[number];

export type PositionFilterOpts = {
  statuses?: string[];
  remoteTypes?: string[];
  sources?: string[];
  verdicts?: string[]; // applications.critic_verdict (PASS|NEEDS_WORK|REJECT)
  // ── Filtri "intelligenti" (sidebar /positions, stile mappa) ──
  families?: string[]; // positions.role_family (UNCATEGORIZED_LABEL = "Da categorizzare")
  countries?: string[]; // loc_country ("(unknown)" = senza paese)
  cities?: string[]; // chiavi "Country|City" ("(country-only)" = senza città)
  scoreBands?: Array<{ lo: number; hi: number }>; // range score (OR tra loro)
  unscored?: boolean; // include posizioni senza score numerico
  criticBands?: Array<{ lo: number; hi: number }>; // range voto critico 0-10 (OR)
  criticUnscored?: boolean; // include posizioni senza voto del critico
  // true = solo selezionate dall'utente (write_requested); false = solo NON
  // selezionate; undefined = nessun filtro. Alimenta i deep-link delle card
  // pipeline "Da scrivere" / "Con lo score".
  writeRequested?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: "asc" | "desc";
};

// Chiave city coerente con la sidebar/mappa: "Country|City". Country vuoto
// → "(unknown)"; city vuota → "(country-only)".
function facetCityKey(
  country: string | null | undefined,
  city: string | null | undefined,
): string {
  const c = (country ?? "").trim() || "(unknown)";
  const ci = (city ?? "").trim() || "(country-only)";
  return `${c}|${ci}`;
}

// Filtri faceted applicati post-fetch (uniformi tra Supabase e local, così
// la logica vive in un solo posto). Tra dimensioni diverse: AND. Dentro la
// stessa dimensione: OR. Lo score band + unscored sono OR fra loro.
function applyFacetFilters(
  rows: PositionWithScore[],
  opts?: PositionFilterOpts,
): PositionWithScore[] {
  let out = rows;
  if (opts?.families?.length) {
    const set = new Set(opts.families);
    out = out.filter((p) =>
      set.has((p.role_family ?? "").trim() || UNCATEGORIZED_LABEL),
    );
  }
  if (opts?.countries?.length) {
    const set = new Set(opts.countries);
    out = out.filter((p) =>
      set.has((p.loc_country ?? "").trim() || "(unknown)"),
    );
  }
  if (opts?.cities?.length) {
    const set = new Set(opts.cities);
    out = out.filter((p) => set.has(facetCityKey(p.loc_country, p.loc_city)));
  }
  const bands = opts?.scoreBands ?? [];
  if (bands.length || opts?.unscored) {
    out = out.filter((p) => {
      const s = p.score;
      if (s == null || s === 0) return !!opts?.unscored;
      return bands.some((b) => s >= b.lo && s <= b.hi);
    });
  }
  const cbands = opts?.criticBands ?? [];
  if (cbands.length || opts?.criticUnscored) {
    out = out.filter((p) => {
      const c = p.critic_score;
      if (c == null) return !!opts?.criticUnscored;
      return cbands.some((b) => c >= b.lo && c <= b.hi);
    });
  }
  if (opts?.writeRequested != null) {
    out = out.filter((p) => Boolean(p.write_requested) === opts.writeRequested);
  }
  return out;
}

export async function getPositions(
  opts?: PositionFilterOpts,
): Promise<PositionWithScore[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoPositions(dp, opts);
  const w = await ws();
  if (w) {
    try {
      return applyFacetFilters(local.getPositionsLocal(w, opts), opts);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  let query = supabase
    .from("positions")
    .select(
      "id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, salary_declared_currency, salary_estimated_min, salary_estimated_max, salary_estimated_currency, url, source, found_at, found_by, last_checked, deadline, status, notes, score, role_family, loc_country, loc_city, write_requested, scores ( total_score, stack_match, remote_fit, salary_fit, strategic_fit, scored_at, scored_by ), applications ( critic_score, critic_verdict, written_at, written_by, critic_reviewed_at, reviewed_by, applied_at, response_at )",
    )
    .is("deleted_at", null)
    .order("found_at", { ascending: false });

  if (opts?.statuses?.length) query = query.in("status", opts.statuses);
  if (opts?.remoteTypes?.length)
    query = query.in("remote_type", opts.remoteTypes);
  if (opts?.sources?.length) query = query.in("source", opts.sources);
  if (opts?.limit) query = query.limit(opts.limit);
  if (opts?.offset)
    query = query.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);

  const { data, error } = await query;
  if (error || !data) return [];
  let mapped: PositionWithScore[] = data.map((p: any) => {
    const s = firstRelated<any>(p.scores);
    const app = firstRelated<any>(p.applications);
    // Stipendio: il DICHIARATO vince, la stima è il fallback (O-32). Vedi
    // `salaryPreference` per il perché; stessa fonte per min/max/currency,
    // così non mischiamo valute.
    const {
      min: salary_min,
      max: salary_max,
      currency: salary_currency,
    } = salaryPreference(p);
    // Ultima azione (stesso mapping di getDashboardPositions).
    const {
      at: last_action_at,
      by: last_action_by,
      actor: last_action_actor,
    } = pickLastAction([
      { ts: p.found_at, by: "scout", actor: p.found_by },
      { ts: p.last_checked, by: "analista", actor: "analista" },
      { ts: s?.scored_at, by: "scorer", actor: s?.scored_by },
      { ts: app?.written_at, by: "scrittore", actor: app?.written_by },
      { ts: app?.critic_reviewed_at, by: "critico", actor: app?.reviewed_by },
      { ts: app?.applied_at, by: "user", actor: "user" },
      { ts: app?.response_at, by: "user", actor: "user" },
    ]);
    return {
      ...p,
      score: p.score ?? s?.total_score ?? undefined,
      scores: p.scores ?? undefined,
      critic_score: app?.critic_score ?? null,
      critic_verdict: app?.critic_verdict ?? null,
      salary_min,
      salary_max,
      salary_currency,
      applied_at: app?.applied_at ?? null,
      // O-34: colonna "CV scritto il". Il campo è già nella select annidata,
      // ma `...p` porta l'array `applications`, non i suoi campi: senza
      // questa riga la colonna resterebbe vuota PROPRIO sul cloud.
      written_at: app?.written_at ?? null,
      last_action_at,
      last_action_by,
      last_action_actor,
    };
  });

  // Filtri post-fetch: verdict (nested join).
  if (opts?.verdicts?.length) {
    const set = new Set(opts.verdicts);
    mapped = mapped.filter(
      (p) => p.critic_verdict && set.has(p.critic_verdict),
    );
  }
  // O-31 (ramo cloud) — quali posizioni hanno un ticket ancora senza
  // risposta. UNA select in più, non una join: sul cloud i ticket sono
  // legati per `position_legacy_id`, non da una foreign key annidabile
  // nella select delle posizioni.
  //
  // `assigned` conta quanto `open`: un agente che ci lavora non è una
  // risposta arrivata. Stesso criterio del ramo locale — se i due
  // divergono, la stessa posizione dice due cose diverse a seconda di dove
  // la si guarda.
  const legacyIds = mapped
    .map((p) => p.legacy_id)
    .filter((id): id is number => typeof id === "number");
  if (legacyIds.length) {
    const { data: pending } = await supabase
      .from("position_tickets")
      .select("position_legacy_id")
      // Nessun filtro esplicito sull'utente: sul cloud lo applica la RLS,
      // come per le altre letture di questa funzione.
      .in("status", ["open", "assigned"])
      .in("position_legacy_id", legacyIds);
    if (pending?.length) {
      const waiting = new Set(
        (pending as { position_legacy_id: number }[]).map(
          (t) => t.position_legacy_id,
        ),
      );
      mapped = mapped.map((p) =>
        p.legacy_id != null && waiting.has(p.legacy_id)
          ? { ...p, has_open_ticket: true }
          : p,
      );
    }
  }

  // Filtri "intelligenti" sidebar (family/location/score band).
  mapped = applyFacetFilters(mapped, opts);

  // Sort in memoria per le colonne richieste dalla UI.
  const sortKey: PositionSortKey | null = POSITION_SORT_KEYS.includes(
    opts?.sort as PositionSortKey,
  )
    ? (opts!.sort as PositionSortKey)
    : null;
  if (!sortKey) return mapped;
  const dirMul = opts?.dir === "asc" ? 1 : -1;
  const getVal = (p: PositionWithScore): string | number | null => {
    switch (sortKey) {
      case "score":
        return p.score ?? null;
      case "critic":
        return p.critic_score ?? null;
      case "found_at":
        return p.found_at ?? null;
      case "remote":
        return p.remote_type ?? null;
      case "salary":
      case "monthly":
        return p.salary_min ?? null;
      case "last_action_by":
        return p.last_action_actor ?? null;
      case "id":
        return p.legacy_id ?? null;
      default:
        return (p as any)[sortKey] ?? null;
    }
  };
  return [...mapped].sort((a, b) => {
    const va = getVal(a),
      vb = getVal(b);
    // NULLS LAST in entrambe le direzioni
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number")
      return (va - vb) * dirMul;
    return String(va).localeCompare(String(vb)) * dirMul;
  });
}

// ── Single position with all details ───────────────────────────────
export async function getPositionById(id: string): Promise<{
  position: Position;
  score: Score | null;
  highlights: PositionHighlight[];
  company: Company | null;
  application: Application | null;
  tickets: PositionTicket[];
  // Nota privata dell'utente (O-22): vive SOLO in locale, quindi a box
  // spento è null — non è un errore, è dove la nota abita.
  userNote?: { body: string; updated_at: string } | null;
} | null> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoPositionById(dp, id);
  const w = await ws();
  if (w) {
    try {
      return local.getPositionByIdLocal(w, id);
    } catch {
      return null;
    }
  }
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const [posRes, scoreRes, hlRes, appRes] = await Promise.all([
    supabase
      .from("positions")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("scores")
      .select("*")
      .eq("position_id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("position_highlights")
      .select("*")
      .eq("position_id", id)
      .order("type"),
    supabase
      .from("applications")
      .select("*")
      .eq("position_id", id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (posRes.error || !posRes.data) return null;
  const position = posRes.data as Position;
  let company: Company | null = null;
  if (position.company_id) {
    const { data: compData } = await supabase
      .from("companies")
      .select("*")
      .eq("id", position.company_id)
      .maybeSingle();
    company = compData ?? null;
  }
  let tickets: PositionTicket[] = [];
  if (position.legacy_id != null) {
    const { data: tkData } = await supabase
      .from("position_tickets")
      .select("*")
      .eq("position_legacy_id", position.legacy_id)
      .order("created_at", { ascending: true });
    tickets = (tkData ?? []).map((t: any) => ({
      id: String(t.id),
      position_id: String(position.id),
      request_text: t.request_text,
      kind: t.kind ?? "custom",
      status: t.status,
      assigned_agent: t.assigned_agent ?? null,
      response_text: t.response_text ?? null,
      created_at: t.created_at ?? null,
      resolved_at: t.resolved_at ?? null,
    }));
  }
  return {
    position,
    score: scoreRes.data ?? null,
    highlights: (hlRes.data ?? []) as PositionHighlight[],
    company,
    application: appRes.data ?? null,
    tickets,
  };
}

// ── Score distribution ──────────────────────────────────────────────
export async function getScoreDistribution() {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoScoreDistribution(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getScoreDistributionLocal(w);
    } catch {
      /* fall through */
    }
  }

  const empty = {
    buckets: [] as Array<{ label: string; count: number; color: string }>,
    total: 0,
    withScore: 0,
    avgScore: null as number | null,
    scores: [] as number[],
  };
  if (!isSupabaseConfigured) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select("score, scores(total_score)")
    .not("status", "eq", "excluded")
    .is("deleted_at", null);
  if (error || !data) return empty;

  const scores = data.map(
    (r: any) =>
      (r.score as number | null) ?? (r as any).scores?.total_score ?? null,
  );
  const withScore = scores.filter((s: any): s is number => s != null && s > 0);
  const buckets = [
    { label: "76\u2013100", min: 76, max: 100, color: "var(--color-green)" },
    { label: "61\u201375", min: 61, max: 75, color: "var(--color-yellow)" },
    { label: "41\u201360", min: 41, max: 60, color: "var(--color-orange)" },
    { label: "\u2264 40", min: 0, max: 40, color: "var(--color-red)" },
  ].map((b) => ({
    label: b.label,
    count: withScore.filter((s: number) => s >= b.min && s <= b.max).length,
    color: b.color,
  }));
  const sum = withScore.reduce((a: number, s: number) => a + s, 0);
  return {
    buckets,
    total: scores.length,
    withScore: withScore.length,
    avgScore: withScore.length > 0 ? Math.round(sum / withScore.length) : null,
    scores: withScore,
  };
}

// ── Source distribution ─────────────────────────────────────────────
export async function getSourceDistribution(): Promise<
  Array<{ source: string; count: number }>
> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoSourceDistribution(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getSourceDistributionLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select("source")
    .not("status", "eq", "excluded")
    .is("deleted_at", null);
  if (error || !data) return [];
  const counts: Record<string, number> = {};
  for (const row of data) {
    const s = row.source ?? "sconosciuta";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

// ── Positions con coordinate ufficio (per JobsGlobe) ───────────────
// ── Faceting dataset per la sidebar /positions ─────────────────────
// Universo COMPLETO (incluse le excluded, che la tabella mostra) con i
// soli campi necessari a ricalcolare donut/istogramma/location lato
// client, con conteggi che si incrociano. Diverso da coords/no-coords
// del map (che escludono le 'excluded' e dipendono dalle coordinate).
export type PositionFacet = {
  id: string;
  role_family: string | null;
  score: number | null;
  critic_score: number | null;
  loc_country: string | null;
  loc_city: string | null;
  status: string;
  title: string | null;
  company: string | null;
};

export async function getPositionFacets(): Promise<PositionFacet[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoFacets(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getPositionFacetsLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, title, company, status, role_family, loc_country, loc_city, score, scores ( total_score ), applications ( critic_score )",
    )
    .is("deleted_at", null);
  if (error || !data) return [];
  return (data as any[]).map((p) => {
    const s = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    const score =
      (p.score as number | null) ??
      (typeof s?.total_score === "number" ? s.total_score : null);
    const app = Array.isArray(p.applications)
      ? p.applications[0]
      : p.applications;
    const critic =
      typeof app?.critic_score === "number" ? app.critic_score : null;
    return {
      id: String(p.id),
      role_family: p.role_family ?? null,
      score: typeof score === "number" ? score : null,
      critic_score: critic,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      status: p.status,
      title: p.title ?? null,
      company: p.company ?? null,
    };
  });
}

// ── Dataset dashboard: universo ATTIVO con campi-facet + campi-tabella ──
// Un solo fetch alimenta i grafici collegati (role_family/score/loc per le
// distribuzioni) E la tabella "Recent Positions" filtrata (legacy_id,
// location, remote_type, recency). Esclude le 'excluded', coerente con le
// altre metriche della dashboard. Ordinato per ultima azione desc.
export type DashboardPosition = {
  id: string;
  legacy_id: number | null;
  title: string | null;
  company: string | null;
  location: string | null;
  remote_type: string | null;
  status: string;
  score: number | null;
  role_family: string | null;
  loc_country: string | null;
  loc_city: string | null;
  source: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  found_at: string | null;
  // Quando lo Scorer ha assegnato lo score (scores.scored_at), null se
  // non ancora valutata — alimenta la tabella "posizioni nuove".
  scored_at: string | null;
  last_action_at: string;
  // Chi ha eseguito l'ultima azione: ruolo (scout/analista/scorer/scrittore/
  // critico/user) e nome istanza (es. 'scout-1', fallback al ruolo).
  last_action_by: string;
  last_action_actor: string;
  // Voto del Critico (0-10) + verdetto (PASS|NEEDS_WORK|REJECT), null se non
  // ancora revisionata.
  critic_score: number | null;
  critic_verdict: string | null;
  // true = già aperta dall'utente (position_views). undefined in local
  // mode: lì decide il client via localStorage (vedi UnseenDot).
  seen?: boolean;
};

// ── Posizioni viste (position_views, mig 055) ─────────────────────
// Set degli id posizione già aperti dall'utente corrente: la RLS scopa
// la select alla sessione, quindi niente .in() (con 1000 uuid la query
// string esploderebbe). In local mode lo stato vive in localStorage lato
// client (vedi lib/seen-positions) → set vuoto, decide il client.
export async function getSeenPositionIds(): Promise<Set<string>> {
  const dp = await activeDemoPersona();
  if (dp) {
    // Demo: risultano "già viste" le posizioni più vecchie di 24h, così
    // il marker "nuova" è dimostrabile senza rumore su tutta la lista.
    return new Set(
      (await demo.demoDashboardPositions(dp))
        .filter((p) => p.seen)
        .map((p) => p.id),
    );
  }
  if (await ws()) return new Set();
  if (!isSupabaseConfigured) return new Set();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("position_views")
    .select("position_id")
    .limit(10000);
  if (error || !data) return new Set();
  return new Set((data as any[]).map((r) => String(r.position_id)));
}

// ── Swipe decks ────────────────────────────────────────────────────
// [JHT-POSITIONS-SWIPE-TRIAGE] Due mazzi per la pagina /swipe, entrambi
// in ordine di arrivo (found_at asc, scelta utente 19/07):
//   pending  = scored/ready SENZA feedback → da giudicare. Le già
//              recensite non ricompaiono: una nuova sessione riparte
//              dalla più vecchia non giudicata.
//   reviewed = posizioni CON feedback (qualunque status, incluse le
//              escluse col "non interessante") + l'ultimo giudizio, per
//              la modalità "rivedi e cambia idea".
// In local mode position_feedback non esiste in SQLite → reviewed vuoto.
export type SwipeReviewedRow = {
  position: PositionWithScore;
  action: string;
  fb_score: number | null;
};

async function getLatestFeedbackByLegacyId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, { action: string; score: number | null }>> {
  const { data, error } = await supabase
    .from("position_feedback")
    .select("position_legacy_id, action, score, created_at")
    .in("action", ["like", "dislike", "hide", "star", "clear"])
    .order("created_at", { ascending: false })
    .limit(10000);
  const map = new Map<string, { action: string; score: number | null }>();
  if (error || !data) return map;
  // 'clear' (mig 059) più recente = voto ritirato: la posizione non deve
  // ripescare gli eventi più vecchi → si marca e si salta.
  const cleared = new Set<string>();
  for (const r of data as any[]) {
    const k = String(r.position_legacy_id);
    if (map.has(k) || cleared.has(k)) continue;
    if (r.action === "clear") cleared.add(k);
    else map.set(k, { action: r.action, score: r.score ?? null });
  }
  return map;
}

// true quando i dati arrivano da Supabase (e quindi il feedback utente —
// position_feedback — è disponibile); false in local mode (workspace SQLite).
// È la modalità DATI, distinta da isLocalRequest() che guarda la RICHIESTA.
export async function isCloudDataMode(): Promise<boolean> {
  return (await ws()) == null && isSupabaseConfigured;
}

// Ultimo evento feedback (like/dislike/hide/star) di UNA posizione — alimenta
// i bottoni giudizio della pagina posizione (stessa semantica di /swipe:
// event-log append-only, l'ultimo prevale). Cloud-only: in local mode il
// feedback non è disponibile (position_feedback vive su Supabase).
export async function getLatestFeedbackForLegacyId(
  legacyId: number,
): Promise<{ action: string; score: number | null } | null> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoLatestFeedbackForLegacyId(legacyId);
  const w = await ws();
  if (w) return null;
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("position_feedback")
    .select("action, score, created_at")
    .eq("position_legacy_id", legacyId)
    .in("action", ["like", "dislike", "hide", "star", "clear"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  // Ultimo evento 'clear' (mig 059) = voto ritirato.
  if (data[0].action === "clear") return null;
  return { action: data[0].action, score: data[0].score ?? null };
}

// Mappa legacy_id → giudizio a 4 livelli (ultimo evento feedback) per il
// filtro "Il tuo feedback" della pagina posizioni. Stessa mappatura inversa
// di /swipe. Cloud-only: {} in local mode.
export async function getVerdictMapByLegacyId(): Promise<
  Record<string, Verdict>
> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoVerdictMapByLegacyId();
  const w = await ws();
  if (w) return {};
  if (!isSupabaseConfigured) return {};
  const supabase = await createClient();
  const fb = await getLatestFeedbackByLegacyId(supabase);
  const out: Record<string, Verdict> = {};
  for (const [k, v] of fb) out[k] = verdictOf(v.action, v.score);
  return out;
}

// limit = tetto di SICUREZZA payload (e max righe per request di Supabase),
// non un cap voluto del mazzo: l'utente scorre tutto il backlog (20/07).
export async function getSwipeDecks(limit = 1000): Promise<{
  pending: PositionWithScore[];
  reviewed: SwipeReviewedRow[];
}> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoSwipeDecks(dp);
  const w = await ws();
  if (w) {
    try {
      // Ordine: dalla trovata meno di recente alla più recente (scelta
      // utente 18/07) — il triage smaltisce il backlog in ordine di arrivo.
      const pending = local.getPositionsLocal(w, {
        statuses: ["scored", "ready"],
        sort: "found_at",
        dir: "asc",
        limit,
      });
      return { pending, reviewed: [] };
    } catch {
      return { pending: [], reviewed: [] };
    }
  }
  if (!isSupabaseConfigured) return { pending: [], reviewed: [] };

  const supabase = await createClient();
  const [positionsRes, feedback] = await Promise.all([
    supabase
      .from("positions")
      .select(
        // NIENTE jd_summary/jd_text: senza cap il mazzo supera le 900 card e
        // i testi inline affossavano SSR/hydration — la card li scarica
        // on-demand da /api/positions/[legacyId]/summary.
        "id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, salary_declared_currency, salary_estimated_min, salary_estimated_max, salary_estimated_currency, url, source, found_at, status, score, role_family, loc_country, loc_city, scores ( total_score )",
      )
      // 'excluded' incluso: le posizioni giudicate "non interessante"
      // devono restare visitabili nel mazzo reviewed.
      .in("status", ["scored", "ready", "excluded"])
      .is("deleted_at", null)
      .order("found_at", { ascending: true })
      .limit(limit),
    getLatestFeedbackByLegacyId(supabase),
  ]);
  const { data, error } = positionsRes;
  if (error || !data) return { pending: [], reviewed: [] };

  const mapRow = (p: any): PositionWithScore => {
    const sc = firstRelated<any>(p.scores);
    // Dichiarato prima della stima (O-32): sullo swipe l'utente decide in un
    // gesto, quindi il numero sbagliato lì costa ancora meno attenzione.
    const salary = salaryPreference(p);
    return {
      ...p,
      score: p.score ?? sc?.total_score ?? undefined,
      scores: undefined,
      salary_min: salary.min,
      salary_max: salary.max,
      salary_currency: salary.currency,
    } as PositionWithScore;
  };

  const pending: PositionWithScore[] = [];
  const reviewed: SwipeReviewedRow[] = [];
  for (const p of data as any[]) {
    const fb = p.legacy_id != null ? feedback.get(String(p.legacy_id)) : null;
    if (fb) {
      if (reviewed.length < limit)
        reviewed.push({
          position: mapRow(p),
          action: fb.action,
          fb_score: fb.score,
        });
    } else if (
      (p.status === "scored" || p.status === "ready") &&
      pending.length < limit
    ) {
      pending.push(mapRow(p));
    }
    if (pending.length >= limit && reviewed.length >= limit) break;
  }
  return { pending, reviewed };
}

// Sceglie l'evento con timestamp più recente tra i candidati passati.
// Usato sia dal path cloud sia (replicato) dal path locale per derivare
// last_action_at/by/actor con lo stesso mapping ruolo/attore.
export type LastActionCandidate = {
  ts: string | null | undefined;
  by: string;
  actor: string | null | undefined;
};
export function pickLastAction(cands: LastActionCandidate[]): {
  at: string;
  by: string;
  actor: string;
} {
  let best: { at: string; by: string; actor: string } | null = null;
  for (const c of cands) {
    if (!c.ts) continue;
    if (!best || c.ts > best.at) {
      best = { at: c.ts, by: c.by, actor: c.actor || c.by };
    }
  }
  return best ?? { at: "", by: "scout", actor: "scout" };
}

export async function getDashboardPositions(): Promise<DashboardPosition[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoDashboardPositions(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getDashboardPositionsLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, legacy_id, title, company, location, remote_type, status, role_family, loc_country, loc_city, source, score, salary_estimated_min, salary_estimated_max, salary_estimated_currency, salary_declared_min, salary_declared_max, salary_declared_currency, found_at, found_by, last_checked, scores ( total_score, scored_at, scored_by ), applications ( critic_score, critic_verdict, written_at, written_by, critic_reviewed_at, reviewed_by, applied_at, response_at )",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("found_at", { ascending: false })
    .limit(1000);
  if (error || !data) return [];
  return (data as any[]).map((p) => {
    const s = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    const a = Array.isArray(p.applications)
      ? p.applications[0]
      : p.applications;
    const score =
      (p.score as number | null) ??
      (typeof s?.total_score === "number" ? s.total_score : null);
    // last_action_at + chi: stesso mapping ruolo/attore di
    // pickLastAction, ma derivato inline per riga.
    const {
      at: last_action_at,
      by: last_action_by,
      actor: last_action_actor,
    } = pickLastAction([
      { ts: p.found_at, by: "scout", actor: p.found_by },
      { ts: p.last_checked, by: "analista", actor: "analista" },
      { ts: s?.scored_at, by: "scorer", actor: s?.scored_by },
      { ts: a?.written_at, by: "scrittore", actor: a?.written_by },
      // critic_reviewed_at è auto-settato dalla chiamata --critic-score
      // che esegue lo SCRITTORE (single-writer rule, bug #21): il critico
      // non scrive mai sul DB. Quindi l'autore di quell'update è lo
      // scrittore, non il critico. Il voto del critico vive nella sua
      // colonna dedicata.
      { ts: a?.critic_reviewed_at, by: "scrittore", actor: a?.written_by },
      { ts: a?.applied_at, by: "user", actor: "user" },
      { ts: a?.response_at, by: "user", actor: "user" },
    ]);
    // Stipendio: il dichiarato vince, la stima è il fallback (O-32).
    // min/max/currency provengono dalla STESSA fonte per non mischiare valute.
    const {
      min: salary_min,
      max: salary_max,
      currency: salary_currency,
    } = salaryPreference(p);
    return {
      id: String(p.id),
      legacy_id: (p.legacy_id as number | null) ?? null,
      title: p.title ?? null,
      company: p.company ?? null,
      location: p.location ?? null,
      remote_type: p.remote_type ?? null,
      status: p.status,
      score: typeof score === "number" ? score : null,
      role_family: p.role_family ?? null,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      source: p.source ?? null,
      salary_min: typeof salary_min === "number" ? salary_min : null,
      salary_max: typeof salary_max === "number" ? salary_max : null,
      salary_currency,
      found_at: p.found_at ?? null,
      scored_at: (s?.scored_at as string | null) ?? null,
      last_action_at: last_action_at || (p.found_at ?? ""),
      last_action_by,
      last_action_actor,
      critic_score: typeof a?.critic_score === "number" ? a.critic_score : null,
      critic_verdict: a?.critic_verdict ?? null,
    };
  });
}

export async function getPositionsWithCoords(): Promise<local.PositionCoord[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoCoords(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getPositionsWithCoordsLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  // Niente più filtro office_lat: prendiamo TUTTE le non-escluse e risolviamo
  // le coordinate a livello città (ufficio esatto o centro-città).
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, title, company, status, role_family, location, loc_country, loc_city, office_address, office_lat, office_lon, remote_type, created_at, scores ( total_score )",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null);
  if (error || !data) return [];
  const rows = data as any[];
  const pins = resolveCityPins(
    rows.map((p) => {
      const s = Array.isArray(p.scores) ? p.scores[0] : p.scores;
      return {
        loc_country: p.loc_country ?? null,
        loc_city: p.loc_city ?? null,
        office_lat: p.office_lat,
        office_lon: p.office_lon,
        id: String(p.id),
        score: typeof s?.total_score === "number" ? s.total_score : null,
        company: p.company ?? null,
        remote_type: p.remote_type ?? null,
      };
    }),
  );
  const out: local.PositionCoord[] = [];
  rows.forEach((p, i) => {
    const c = pins[i];
    if (!c) return; // posizione non risolvibile → finisce tra i no-coords
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    out.push({
      id: String(p.id),
      title: p.title,
      company: p.company,
      status: p.status,
      role_family: p.role_family ?? null,
      score: typeof score?.total_score === "number" ? score.total_score : null,
      lat: c.lat,
      lon: c.lon,
      // La colonna is_remote è storicamente sempre false (campo morto):
      // la verità sta in remote_type. Derivato qui così contatori e
      // rendering remote funzionano.
      is_remote: p.remote_type === "full_remote",
      remote_type: p.remote_type ?? null,
      location: p.location ?? null,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      office_address: p.office_address ?? null,
      created_at: p.created_at ?? null,
    });
  });
  return out;
}

// ── Tree gerarchico per /map sidebar Location ──────────────────────
// Country → cities → positions. Usa `loc_country`/`loc_city` strutturati
// (popolati dall'analista via skill location-enrichment). Le positions
// senza loc_country finiscono sotto "(unknown)"; quelle senza loc_city
// sotto una città chiamata "(country-only)".
export type {
  LocationPositionLite,
  LocationCity,
  LocationCountry,
} from "@/lib/types";

function buildLocationTree(
  rows: Array<{
    id: string;
    title: string | null;
    company: string | null;
    loc_country: string | null;
    loc_city: string | null;
    score: number | null;
  }>,
): LocationCountry[] {
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
      id: r.id,
      title: r.title,
      company: r.company,
      score: r.score,
    });
    cMap.set(city, arr);
    byCountry.set(country, cMap);
  }
  const out: LocationCountry[] = [];
  for (const [country, cMap] of byCountry) {
    const cities: LocationCity[] = [];
    let total = 0;
    for (const [city, positions] of cMap) {
      // Ordina positions per score desc (null in fondo)
      positions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      cities.push({ city, count: positions.length, positions });
      total += positions.length;
    }
    // City con city=null in fondo
    cities.sort((a, b) => {
      if (a.city == null) return 1;
      if (b.city == null) return -1;
      return b.count - a.count;
    });
    out.push({ country, count: total, cities });
  }
  // Country sorted by count desc, "(unknown)" in fondo
  out.sort((a, b) => {
    if (a.country === "(unknown)") return 1;
    if (b.country === "(unknown)") return -1;
    return b.count - a.count;
  });
  return out;
}

export async function getPositionLocations(): Promise<LocationCountry[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoLocations(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getPositionLocationsLocal(w);
    } catch {
      /* fall through */
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("positions")
    .select("id, title, company, loc_country, loc_city, scores ( total_score )")
    .not("status", "eq", "excluded")
    .is("deleted_at", null);
  if (error || !data) return [];
  const rows = (data as any[]).map((p) => {
    const s = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    return {
      id: String(p.id),
      title: p.title ?? null,
      company: p.company ?? null,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      score: typeof s?.total_score === "number" ? s.total_score : null,
    };
  });
  return buildLocationTree(rows);
}

// ── Positions SENZA coordinate ufficio (per "remote bucket" /map) ─
// Speculare a getPositionsWithCoords: ritorna le posizioni che il
// globo non puo' renderizzare (office_lat null). Servono per il
// widget "+ N senza coord" sulla pagina /map che spiega la
// discrepanza tra chart e mappa.
export type PositionNoCoord = {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  role_family: string | null;
  score: number | null;
  is_remote: boolean;
  remote_type: string | null;
  location: string | null;
  loc_country: string | null;
  loc_city: string | null;
  created_at: string | null;
};
export async function getPositionsWithoutCoords(): Promise<PositionNoCoord[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoNoCoords(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getPositionsWithoutCoordsLocal(w);
    } catch {
      /* fall through */
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  // Tutte le non-escluse; tieni solo quelle la cui città NON è risolvibile a
  // pin (no città, o città senza alcun sibling geocodificato) → bucket residuo.
  const { data, error } = await supabase
    .from("positions")
    .select(
      "id, title, company, status, role_family, office_lat, office_lon, is_remote, remote_type, location, loc_country, loc_city, created_at, scores ( total_score )",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null);
  if (error || !data) return [];
  const rows = data as any[];
  // Qui id/score non servono: interessa solo se il pin è risolvibile
  // (pins[i] truthy), non lo slot esatto nelle griglie. remote_type sì:
  // le full remote ora si risolvono (griglia-paese o isola) e devono
  // uscire da questo bucket.
  const pins = resolveCityPins(
    rows.map((p) => ({
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      office_lat: p.office_lat,
      office_lon: p.office_lon,
      remote_type: p.remote_type ?? null,
    })),
  );
  const out: PositionNoCoord[] = [];
  rows.forEach((p, i) => {
    if (pins[i]) return; // ha un pin città → non è "senza coordinate"
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    out.push({
      id: String(p.id),
      title: p.title,
      company: p.company,
      status: p.status,
      role_family: p.role_family ?? null,
      score: typeof score?.total_score === "number" ? score.total_score : null,
      is_remote: p.remote_type === "full_remote",
      remote_type: p.remote_type ?? null,
      location: p.location ?? null,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      created_at: p.created_at ?? null,
    });
  });
  return out;
}

// ── Position type distribution ──────────────────────────────────────
export async function getPositionTypeDistribution(): Promise<
  RoleFamilyCount[]
> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoTypeDistribution(dp);
  const w = await ws();
  // Coerente con getScoreDistribution: se la versione locale fallisce
  // (es. better-sqlite3 binding mancante), fall-through a Supabase
  // invece di restituire silenziosamente [] e perdere la donut.
  if (w) {
    try {
      return local.getPositionTypeDistributionLocal(w);
    } catch {
      /* fall through */
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  // Legge `role_family` dalla colonna popolata dal team analyst.
  // Score: preferisci positions.score, fallback su scores.total_score via join.
  // Critic: applications.critic_score.
  const { data, error } = await supabase
    .from("positions")
    .select(
      "role_family, score, scores(total_score), applications(critic_score)",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null);
  if (error || !data) return [];
  const rows = (data as any[]).map((r) => {
    const scoresRel = Array.isArray(r.scores) ? r.scores[0] : r.scores;
    const appRel = Array.isArray(r.applications)
      ? r.applications[0]
      : r.applications;
    return {
      role_family: r.role_family as string | null,
      score: (r.score as number | null) ?? scoresRel?.total_score ?? null,
      critic: (appRel?.critic_score as number | null) ?? null,
    };
  });
  return aggregateRoleFamilies(rows);
}

// ── Scout stats ─────────────────────────────────────────────────────
export async function getScoutStats() {
  const w = await ws();
  if (w) {
    try {
      return local.getScoutStatsLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const [posRes, appRes] = await Promise.all([
    supabase
      .from("positions")
      .select("id, found_by, status")
      .is("deleted_at", null),
    supabase
      .from("applications")
      .select("position_id")
      .or("status.eq.response,response.not.is.null")
      .is("deleted_at", null),
  ]);
  if (posRes.error || !posRes.data) return [];
  const respondedPositionIds = new Set(
    ((appRes.data as any[]) ?? []).map((a: any) => a.position_id),
  );
  const grouped: Record<
    string,
    { total: number; excluded: number; applied: number; responded: number }
  > = {};
  for (const row of posRes.data) {
    const key = row.found_by ?? "sconosciuto";
    if (!grouped[key])
      grouped[key] = { total: 0, excluded: 0, applied: 0, responded: 0 };
    grouped[key].total++;
    if (row.status === "excluded") grouped[key].excluded++;
    if (row.status === "applied" || row.status === "response")
      grouped[key].applied++;
    if (respondedPositionIds.has(row.id)) grouped[key].responded++;
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
export async function getScorerStats() {
  const w = await ws();
  if (w) {
    try {
      return local.getScorerStatsLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scores")
    .select("scored_by, total_score")
    .is("deleted_at", null);
  if (error || !data) return [];
  const grouped: Record<string, number[]> = {};
  for (const row of data) {
    const key = row.scored_by ?? "sconosciuto";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row.total_score);
  }
  return Object.entries(grouped)
    .map(([scorer, scores]) => ({
      scorer,
      total: scores.length,
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      high: scores.filter((s) => s >= 70).length,
      mid: scores.filter((s) => s >= 40 && s < 70).length,
      low: scores.filter((s) => s < 40).length,
    }))
    .sort((a, b) => b.total - a.total);
}

// Storico completo per la pagina /messages: come getPendingMessages ma senza
// il filtro acknowledged — i letti restano in lista, la pagina li mostra
// separati. Cloud: RLS filtra per user_id implicito.
export async function getMessagesHistory(
  limit = 200,
): Promise<PendingMessage[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoPendingMessages(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getMessagesHistoryLocal(w, limit);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  // [JHT-CHAT-UNIFY] Via il filtro `delivered_via='web'`. Quella colonna dice
  // su quale CANALE è stata spinta la notifica, non se il messaggio fa parte
  // della conversazione: con Telegram configurato `jht-notify-user` scriveva
  // 'telegram' e quel turno spariva dalla chat del sito. È una delle ragioni
  // per cui la chat web sembrava muta pur avendo l'agente risposto.
  const { data, error } = await supabase
    .from("pending_user_messages")
    .select(
      "id, agent, body, kind, author, related_position_id, delivered_via, delivered_at, " +
        "acknowledged_at, user_reply, user_reply_at, agent_seen_reply_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as PendingMessage[];
}

// Conteggio esatto dei non letti per il banner in dashboard: la lista
// limitata a 20 saturava il vecchio contatore ("20 non letti" anche con 50).
export async function getPendingMessagesCount(): Promise<number> {
  const dp = await activeDemoPersona();
  if (dp) return (await demo.demoPendingMessages(dp)).length;
  const w = await ws();
  if (w) {
    try {
      return local.countPendingMessagesLocal(w);
    } catch {
      return 0;
    }
  }
  if (!isSupabaseConfigured) return 0;

  const supabase = await createClient();
  // Non letti = turni dell'AGENTE non ancora ack-ati (quelli scritti
  // dall'utente li ha già letti chi li ha scritti).
  const { count, error } = await supabase
    .from("pending_user_messages")
    .select("id", { count: "exact", head: true })
    .eq("author", "agent")
    .is("acknowledged_at", null);
  if (error || count == null) return 0;
  return count;
}

// ── Team activity (per-agente nel tempo) ───────────────────────────
// Prefissi di ruolo validi per mappare by_agent (es. 'analista-2' → 'analista').
const ROLE_PREFIX_SET = new Set<string>(TEAM_ACTIVITY_ROLES);

type PosMeta = {
  id: string | number;
  legacy_id: number | null;
  title: string | null;
  company: string | null;
  source: string | null;
  loc_city: string | null;
};
const isLegacyPid = (p: string) => /^\d+$/.test(p);

// Sorgente accurata per-istanza: l'event-log sincronizzato position_transitions
// (by_agent = istanza reale: scout-1, analista-2, scorer-4…). Copre scout /
// analista / scorer; scrittore/critico restano sulle applications (le
// transizioni sono position-centric). pid = position_legacy_id (intero) →
// risolto a uuid in enrichRecent. RLS già filtra per utente. Vuoto per gli
// account senza event-log → i chiamanti ricadono sulla derivazione da colonne.
async function fetchTransitionEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fromIso?: string,
  untilIso?: string,
): Promise<TeamActivityEvent[]> {
  // PostgREST taglia a ~1000 righe/richiesta: con event-log oltre 1000
  // transizioni una query secca perderebbe (senza order) le più recenti in
  // ordine fisico → il feed si fermerebbe a giorni indietro. Pagina per `ts`
  // DESC con .range() finché la pagina è piena, così la copertura è completa.
  const PAGE = 1000;
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from("position_transitions")
      .select("position_legacy_id, by_agent, ts")
      .not("by_agent", "is", null)
      .order("ts", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (fromIso) q = q.gte("ts", fromIso);
    if (untilIso) q = q.lt("ts", untilIso);
    const { data, error } = await q;
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows.flatMap((r) => {
    const role = String(r.by_agent ?? "").split("-")[0] as TeamActivityRole;
    if (!ROLE_PREFIX_SET.has(role)) return [];
    return [
      {
        role,
        actor: normActor(role, r.by_agent),
        ts: r.ts as string,
        pid: r.position_legacy_id != null ? String(r.position_legacy_id) : null,
      },
    ];
  });
}

// Arricchisce il feed/log con titolo·azienda·id leggibile, gestendo entrambe le
// semantiche di pid: legacy_id (eventi da position_transitions) e uuid (eventi
// da applications). Per i legacy risolve anche pid→uuid così i link funzionano.
async function enrichRecent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  events: RecentActivityEvent[],
): Promise<void> {
  const pids = [
    ...new Set(events.map((e) => e.pid).filter((p): p is string => !!p)),
  ];
  if (!pids.length) return;
  const legacyIds = [...new Set(pids.filter(isLegacyPid).map(Number))];
  const uuids = pids.filter((p) => !isLegacyPid(p));
  const byLegacy = new Map<number, PosMeta>();
  const byUuid = new Map<string, PosMeta>();
  for (let i = 0; i < legacyIds.length; i += 150) {
    const chunk = legacyIds.slice(i, i + 150);
    const { data } = await supabase
      .from("positions")
      .select("id, legacy_id, title, company, source, loc_city")
      .in("legacy_id", chunk);
    for (const r of (data ?? []) as unknown as PosMeta[])
      if (r.legacy_id != null) byLegacy.set(r.legacy_id, r);
  }
  for (let i = 0; i < uuids.length; i += 150) {
    const chunk = uuids.slice(i, i + 150);
    const { data } = await supabase
      .from("positions")
      .select("id, legacy_id, title, company, source, loc_city")
      .in("id", chunk);
    for (const r of (data ?? []) as unknown as PosMeta[])
      byUuid.set(String(r.id), r);
  }
  for (const ev of events) {
    if (!ev.pid) continue;
    if (isLegacyPid(ev.pid)) {
      const m = byLegacy.get(Number(ev.pid));
      if (m) {
        ev.title = m.title;
        ev.company = m.company;
        ev.legacyId = m.legacy_id;
        ev.source = m.source;
        ev.city = m.loc_city;
        ev.pid = String(m.id);
      }
    } else {
      const m = byUuid.get(ev.pid);
      if (m) {
        ev.title = m.title;
        ev.company = m.company;
        ev.legacyId = m.legacy_id;
        ev.source = m.source;
        ev.city = m.loc_city;
      }
    }
  }

  // Score assegnato (eventi scorer): lookup mirata su `scores` per i soli pid
  // scorer, ormai risolti a uuid sopra. Una riga per posizione → mappa pid→score.
  const scorerPids = [
    ...new Set(
      events
        .filter((e) => e.role === "scorer" && e.pid && !isLegacyPid(e.pid))
        .map((e) => e.pid as string),
    ),
  ];
  if (scorerPids.length) {
    const byScore = new Map<string, number>();
    for (let i = 0; i < scorerPids.length; i += 150) {
      const chunk = scorerPids.slice(i, i + 150);
      const { data } = await supabase
        .from("scores")
        .select("position_id, total_score")
        .in("position_id", chunk);
      for (const r of (data ?? []) as {
        position_id: string;
        total_score: number | null;
      }[])
        if (r.total_score != null)
          byScore.set(String(r.position_id), r.total_score);
    }
    for (const ev of events)
      if (ev.role === "scorer" && ev.pid && byScore.has(ev.pid))
        ev.score = byScore.get(ev.pid)!;
  }
}

// Local: SQLite (getTeamActivityLocal). Cloud: Supabase, una query per
// timestamp filtrata sulla finestra (.gte) per restare sotto il cap di 1000
// righe/richiesta e ridurre il traffico. Stesso buildTeamActivity → numeri
// identici nelle due modalità. Vedi lib/team-activity.ts per le sorgenti.
export async function getTeamActivity(opts?: {
  from?: string;
  to?: string;
}): Promise<TeamActivity> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoTeamActivity(dp, opts);
  const { from, to } = resolveActivityRange(opts, new Date());
  const w = await ws();
  if (w) {
    try {
      return local.getTeamActivityLocal(w, from, to);
    } catch {
      return buildTeamActivity([], from, to);
    }
  }
  if (!isSupabaseConfigured) return buildTeamActivity([], from, to);

  const supabase = await createClient();
  // Range [from 00:00 UTC, to+1 00:00 UTC): estremo destro esclusivo così il
  // giorno `to` è incluso per intero.
  const fromIso = `${from}T00:00:00.000Z`;
  const untilIso = `${addDaysKey(to, 1)}T00:00:00.000Z`;

  // actorCol = colonna con l'id istanza (es. found_by). null per l'Analista,
  // che su last_checked non lo registra → normActor ricade sul ruolo.
  const fetchEvents = async (
    table: string,
    col: string,
    actorCol: string | null,
    idCol: string,
    role: TeamActivityRole,
    softDelete: boolean,
  ): Promise<TeamActivityEvent[]> => {
    const select = [col, actorCol, idCol].filter(Boolean).join(", ");
    let q = supabase
      .from(table)
      .select(select)
      .gte(col, fromIso)
      .lt(col, untilIso);
    if (softDelete) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as any[])
      .filter((r) => !!r[col])
      .map((r) => ({
        role,
        actor: normActor(role, actorCol ? r[actorCol] : null),
        ts: r[col] as string,
        pid: r[idCol] != null ? String(r[idCol]) : null,
      }));
  };

  // Sorgente per-istanza: event-log (position_transitions) se presente,
  // altrimenti derivazione dalle colonne *_by (account senza event-log).
  const tx = await fetchTransitionEvents(supabase, fromIso, untilIso);
  const events: TeamActivityEvent[] = tx.length
    ? [
        ...tx,
        ...(
          await Promise.all([
            fetchEvents(
              "applications",
              "written_at",
              "written_by",
              "position_id",
              "scrittore",
              true,
            ),
            fetchEvents(
              "applications",
              "critic_reviewed_at",
              "reviewed_by",
              "position_id",
              "critico",
              true,
            ),
          ])
        ).flat(),
      ]
    : (
        await Promise.all([
          fetchEvents("positions", "found_at", "found_by", "id", "scout", true),
          fetchEvents(
            "positions",
            "last_checked",
            null,
            "id",
            "analista",
            true,
          ),
          fetchEvents(
            "scores",
            "scored_at",
            "scored_by",
            "position_id",
            "scorer",
            false,
          ),
          fetchEvents(
            "applications",
            "written_at",
            "written_by",
            "position_id",
            "scrittore",
            true,
          ),
          fetchEvents(
            "applications",
            "critic_reviewed_at",
            "reviewed_by",
            "position_id",
            "critico",
            true,
          ),
        ])
      ).flat();

  const act = buildTeamActivity(events, from, to);
  await enrichRecent(supabase, act.recent);
  return act;
}

// ── Activity log: TUTTE le azioni (per la pagina dedicata) ──────────
// Local: SQLite (UNION). Cloud: una fetch per sorgente (senza finestra),
// ordinata e arricchita con titolo/azienda/id. NB cap Supabase ~1000 righe
// per query: ok per gli account attuali (<1000 posizioni/score).
export async function getTeamActivityLog(): Promise<RecentActivityEvent[]> {
  const dp = await activeDemoPersona();
  if (dp) return demo.demoTeamActivityLog(dp);
  const w = await ws();
  if (w) {
    try {
      return local.getTeamActivityLogLocal(w);
    } catch {
      return [];
    }
  }
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const fetchAll = async (
    table: string,
    col: string,
    actorCol: string | null,
    idCol: string,
    role: TeamActivityRole,
    softDelete: boolean,
  ): Promise<RecentActivityEvent[]> => {
    const select = [col, actorCol, idCol].filter(Boolean).join(", ");
    let q = supabase.from(table).select(select).not(col, "is", null);
    if (softDelete) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      role,
      actor: normActor(role, actorCol ? r[actorCol] : null),
      ts: r[col] as string,
      pid: r[idCol] != null ? String(r[idCol]) : null,
    }));
  };

  // Event-log per-istanza se presente; altrimenti derivazione da colonne.
  const tx = await fetchTransitionEvents(supabase);
  const events: RecentActivityEvent[] = tx.length
    ? [
        ...tx,
        ...(
          await Promise.all([
            fetchAll(
              "applications",
              "written_at",
              "written_by",
              "position_id",
              "scrittore",
              true,
            ),
            fetchAll(
              "applications",
              "critic_reviewed_at",
              "reviewed_by",
              "position_id",
              "critico",
              true,
            ),
          ])
        ).flat(),
      ]
    : (
        await Promise.all([
          fetchAll("positions", "found_at", "found_by", "id", "scout", true),
          fetchAll("positions", "last_checked", null, "id", "analista", true),
          fetchAll(
            "scores",
            "scored_at",
            "scored_by",
            "position_id",
            "scorer",
            false,
          ),
          fetchAll(
            "applications",
            "written_at",
            "written_by",
            "position_id",
            "scrittore",
            true,
          ),
          fetchAll(
            "applications",
            "critic_reviewed_at",
            "reviewed_by",
            "position_id",
            "critico",
            true,
          ),
        ])
      ).flat();
  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  await enrichRecent(supabase, events);
  return events;
}
