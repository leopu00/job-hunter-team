// [JHT-WEB-DEMO] Implementazioni demo delle query dati. Ogni funzione
// rispecchia ESATTAMENTE la firma/shape della gemella in lib/queries.ts,
// che vi delega quando il cookie demo è attivo. Import da lib/queries.ts
// SOLO di tipi (elisi a compile-time) per non creare cicli runtime; le
// poche logiche condivise (filtri faceted, verdict mapping) sono replicate
// qui con commento — se cambiano di là vanno allineate.
import {
  matchesPositionQuery,
  parsePositionQuery,
} from "@/lib/position-search";
import type {
  DashboardStats,
  PendingMessage,
  PositionWithScore,
  Position,
  Score,
  PositionHighlight,
  Company,
  Application,
  PositionTicket,
} from "@/lib/types";
import type {
  PositionFilterOpts,
  DashboardPosition,
  PositionFacet,
  LocationCountry,
  LocationCity,
  SwipeReviewedRow,
  PositionNoCoord,
} from "@/lib/queries";
import type { PositionCoord } from "@/lib/local-queries";
import {
  buildTeamActivity,
  resolveActivityRange,
  type TeamActivity,
  type TeamActivityEvent,
  type RecentActivityEvent,
} from "@/lib/team-activity";
import {
  aggregateRoleFamilies,
  UNCATEGORIZED_LABEL,
  type RoleFamilyCount,
} from "@/lib/position-classifier";
import { getRequestLocale } from "@/lib/request-locale";
import type { Locale } from "@/i18n/config";
import { demoCompanyFor } from "./seeds/companies";
import type { Verdict } from "@/lib/position-verdict";
import {
  getDemoPositionsData,
  type DemoPosition,
  type DemoPersonaKey,
} from "@/lib/demo/data";
import {
  readDemoFeedback,
  demoVerdictOf,
  type DemoFeedbackMap,
} from "@/lib/demo/mode";

// Locale della request: la voce degli agenti (notes/scoreNotes/criticNotes/
// pros/cons) è localizzata via overlay in seeds/i18n; gli annunci restano
// in inglese. Fuori dal request scope (mai atteso) si ripiega sull'italiano.
async function demoLocale(): Promise<Locale> {
  try {
    return await getRequestLocale();
  } catch {
    return "it";
  }
}

async function data(key: DemoPersonaKey): Promise<DemoPosition[]> {
  return getDemoPositionsData(key, await demoLocale());
}

async function active(key: DemoPersonaKey): Promise<DemoPosition[]> {
  return (await data(key)).filter((p) => p.status !== "excluded");
}

function toPositionWithScore(p: DemoPosition): PositionWithScore {
  const { demo_score_row, demo_highlights, lat, lon, ...rest } = p;
  void demo_highlights;
  void lat;
  void lon;
  return {
    ...rest,
    score: p.score ?? undefined,
    scores: demo_score_row ?? undefined,
  };
}

// ── Stats ───────────────────────────────────────────────────────────
export async function demoDashboardStats(
  key: DemoPersonaKey,
): Promise<DashboardStats> {
  const all = await data(key);
  const count = (s: string) => all.filter((p) => p.status === s).length;
  const TO_WRITE = new Set(["scored", "writing", "review"]);
  const to_write = all.filter(
    (p) => p.write_requested && TO_WRITE.has(p.status),
  ).length;
  const scored_requested = all.filter(
    (p) => p.write_requested && p.status === "scored",
  ).length;
  return {
    total: all.length,
    new: count("new"),
    checked: count("checked"),
    scored: count("scored"),
    writing: count("writing"),
    review: count("review"),
    ready: count("ready"),
    applied: count("applied"),
    excluded: count("excluded"),
    response: count("response"),
    scored_open: count("scored") - scored_requested,
    to_write,
  };
}

// ── Filtri faceted + sort (replica di applyFacetFilters/sort cloud) ──
function facetCityKey(
  country: string | null | undefined,
  city: string | null | undefined,
): string {
  const c = (country ?? "").trim() || "(unknown)";
  const ci = (city ?? "").trim() || "(country-only)";
  return `${c}|${ci}`;
}

function applyFilters(
  rows: PositionWithScore[],
  opts?: PositionFilterOpts,
): PositionWithScore[] {
  let out = rows;
  // O-60 — la ricerca vale anche in demo: la stessa funzione dei due rami
  // veri, così la persona che prova il prodotto non trova un campo che non
  // fa niente.
  const search = parsePositionQuery(opts?.q);
  if (search.text) out = out.filter((p) => matchesPositionQuery(p, search));
  if (opts?.statuses?.length) {
    const set = new Set(opts.statuses);
    out = out.filter((p) => set.has(p.status));
  }
  if (opts?.remoteTypes?.length) {
    const set = new Set(opts.remoteTypes);
    out = out.filter((p) => p.remote_type && set.has(p.remote_type));
  }
  if (opts?.sources?.length) {
    const set = new Set(opts.sources);
    out = out.filter((p) => p.source && set.has(p.source));
  }
  if (opts?.verdicts?.length) {
    const set = new Set(opts.verdicts);
    out = out.filter((p) => p.critic_verdict && set.has(p.critic_verdict));
  }
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

const SORT_KEYS = [
  "id",
  "title",
  "company",
  "score",
  "critic",
  "found_at",
  "remote",
  "salary",
  "monthly",
  "last_action_by",
  "status",
  "location",
  "source",
];

function applySort(
  rows: PositionWithScore[],
  opts?: PositionFilterOpts,
): PositionWithScore[] {
  const sortKey =
    opts?.sort && SORT_KEYS.includes(opts.sort) ? opts.sort : null;
  if (!sortKey) return rows;
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
        return (
          (p as unknown as Record<string, string | number | null>)[sortKey] ??
          null
        );
    }
  };
  return [...rows].sort((a, b) => {
    const va = getVal(a),
      vb = getVal(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number")
      return (va - vb) * dirMul;
    return String(va).localeCompare(String(vb)) * dirMul;
  });
}

export async function demoPositions(
  key: DemoPersonaKey,
  opts?: PositionFilterOpts,
): Promise<PositionWithScore[]> {
  // Default della query cloud: found_at desc.
  let rows = (await data(key))
    .map(toPositionWithScore)
    .sort((a, b) => (b.found_at > a.found_at ? 1 : -1));
  rows = applyFilters(rows, opts);
  rows = applySort(rows, opts);
  if (opts?.offset || opts?.limit) {
    const start = opts.offset ?? 0;
    const end = opts.limit ? start + opts.limit : undefined;
    rows = rows.slice(start, end);
  }
  return rows;
}

// ── Dashboard positions ─────────────────────────────────────────────
export async function demoDashboardPositions(
  key: DemoPersonaKey,
): Promise<DashboardPosition[]> {
  return (await active(key))
    .slice()
    .sort((a, b) => (b.last_action_at > a.last_action_at ? 1 : -1))
    .map((p) => ({
      id: p.id,
      legacy_id: p.legacy_id,
      title: p.title,
      company: p.company,
      location: p.location,
      remote_type: p.remote_type,
      status: p.status,
      score: p.score,
      role_family: p.role_family ?? null,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      source: p.source,
      salary_min: p.salary_min,
      salary_max: p.salary_max,
      salary_currency: p.salary_currency,
      found_at: p.found_at,
      scored_at: p.demo_score_row?.scored_at ?? null,
      last_action_at: p.last_action_at,
      last_action_by: p.last_action_by,
      last_action_actor: p.last_action_actor,
      critic_score: p.critic_score,
      critic_verdict: p.critic_verdict,
      // Le 4 più recenti restano "nuove" (pallino unseen dimostrabile),
      // il resto figura già visto.
      seen: Date.parse(p.found_at) < Date.now() - 24 * 3600_000,
    }));
}

export async function demoApplicationSubmissionDates(
  key: DemoPersonaKey,
): Promise<string[]> {
  return (await data(key))
    .filter((p) => p.status === "applied" || p.status === "response")
    .map((p) => p.last_action_at)
    .sort();
}

// ── Distribuzioni ───────────────────────────────────────────────────
export async function demoScoreDistribution(key: DemoPersonaKey) {
  const scores = (await active(key)).map((p) => p.score);
  const withScore = scores.filter((s): s is number => s != null && s > 0);
  const buckets = [
    { label: "76–100", min: 76, max: 100, color: "var(--color-green)" },
    { label: "61–75", min: 61, max: 75, color: "var(--color-yellow)" },
    { label: "41–60", min: 41, max: 60, color: "var(--color-orange)" },
    { label: "≤ 40", min: 0, max: 40, color: "var(--color-red)" },
  ].map((b) => ({
    label: b.label,
    count: withScore.filter((s) => s >= b.min && s <= b.max).length,
    color: b.color,
  }));
  const sum = withScore.reduce((a, s) => a + s, 0);
  return {
    buckets,
    total: scores.length,
    withScore: withScore.length,
    avgScore: withScore.length > 0 ? Math.round(sum / withScore.length) : null,
    scores: withScore,
  };
}

export async function demoSourceDistribution(
  key: DemoPersonaKey,
): Promise<Array<{ source: string; count: number }>> {
  const counts: Record<string, number> = {};
  for (const p of await active(key)) {
    const s = p.source ?? "sconosciuta";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export async function demoTypeDistribution(
  key: DemoPersonaKey,
): Promise<RoleFamilyCount[]> {
  return aggregateRoleFamilies(
    (await active(key)).map((p) => ({
      role_family: p.role_family ?? null,
      score: p.score,
      critic: p.critic_score,
    })),
  );
}

// ── Facets (sidebar /positions: universo COMPLETO, incluse excluded) ─
export async function demoFacets(
  key: DemoPersonaKey,
): Promise<PositionFacet[]> {
  return (await data(key)).map((p) => ({
    id: p.id,
    role_family: p.role_family ?? null,
    score: p.score,
    critic_score: p.critic_score,
    loc_country: p.loc_country ?? null,
    loc_city: p.loc_city ?? null,
    status: p.status,
    title: p.title,
    company: p.company,
  }));
}

// ── Mappa: coords / no-coords / tree località ──────────────────────
export async function demoCoords(
  key: DemoPersonaKey,
): Promise<PositionCoord[]> {
  return (await active(key))
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => ({
      id: p.id,
      title: p.title,
      company: p.company,
      status: p.status,
      role_family: p.role_family ?? null,
      score: p.score,
      lat: p.lat as number,
      lon: p.lon as number,
      is_remote: p.remote_type === "full_remote",
      remote_type: p.remote_type,
      location: p.location,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      office_address: null,
      created_at: p.found_at,
    }));
}

export async function demoNoCoords(
  key: DemoPersonaKey,
): Promise<PositionNoCoord[]> {
  return (await active(key))
    .filter((p) => p.lat == null || p.lon == null)
    .map((p) => ({
      id: p.id,
      title: p.title,
      company: p.company,
      status: p.status,
      role_family: p.role_family ?? null,
      score: p.score,
      is_remote: p.remote_type === "full_remote",
      remote_type: p.remote_type,
      location: p.location,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      created_at: p.found_at,
    }));
}

export async function demoLocations(
  key: DemoPersonaKey,
): Promise<LocationCountry[]> {
  const byCountry = new Map<string, Map<string | null, DemoPosition[]>>();
  for (const p of await active(key)) {
    const country = p.loc_country?.trim() || "(unknown)";
    const city = p.loc_city?.trim() || null;
    const cMap = byCountry.get(country) ?? new Map();
    const arr = cMap.get(city) ?? [];
    arr.push(p);
    cMap.set(city, arr);
    byCountry.set(country, cMap);
  }
  const out: LocationCountry[] = [];
  for (const [country, cMap] of byCountry) {
    const cities: LocationCity[] = [];
    let total = 0;
    for (const [city, positions] of cMap) {
      positions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      cities.push({
        city,
        count: positions.length,
        positions: positions.map((p) => ({
          id: p.id,
          title: p.title,
          company: p.company,
          score: p.score,
        })),
      });
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

// ── Feedback overlay (cookie) ───────────────────────────────────────
export async function demoLatestFeedbackForLegacyId(
  legacyId: number,
): Promise<{ action: string; score: number | null } | null> {
  const fb = await readDemoFeedback();
  const e = fb[String(legacyId)];
  return e ? { action: e.a, score: e.s } : null;
}

export async function demoVerdictMapByLegacyId(): Promise<
  Record<string, Verdict>
> {
  const fb = await readDemoFeedback();
  const out: Record<string, Verdict> = {};
  for (const [k, e] of Object.entries(fb)) out[k] = demoVerdictOf(e);
  return out;
}

// ── Swipe decks ─────────────────────────────────────────────────────
export async function demoSwipeDecks(key: DemoPersonaKey): Promise<{
  pending: PositionWithScore[];
  reviewed: SwipeReviewedRow[];
}> {
  const fb: DemoFeedbackMap = await readDemoFeedback();
  const rows = (await data(key))
    .filter((p) => ["scored", "ready", "excluded"].includes(p.status))
    .sort((a, b) => (a.found_at > b.found_at ? 1 : -1));
  const pending: PositionWithScore[] = [];
  const reviewed: SwipeReviewedRow[] = [];
  for (const p of rows) {
    const e = p.legacy_id != null ? fb[String(p.legacy_id)] : undefined;
    if (e) {
      reviewed.push({
        position: toPositionWithScore(p),
        action: e.a,
        fb_score: e.s,
      });
    } else if (p.status === "scored" || p.status === "ready") {
      pending.push(toPositionWithScore(p));
    }
  }
  return { pending, reviewed };
}

// ── Dettaglio posizione ─────────────────────────────────────────────
export async function demoPositionById(
  key: DemoPersonaKey,
  id: string,
): Promise<{
  position: Position;
  score: Score | null;
  highlights: PositionHighlight[];
  company: Company | null;
  application: Application | null;
  tickets: PositionTicket[];
} | null> {
  const p = (await data(key)).find((x) => x.id === id);
  if (!p) return null;
  const application: Application | null =
    p.critic_score != null
      ? {
          id: `demo-app-${p.legacy_id}`,
          position_id: p.id,
          cv_path: null,
          cl_path: null,
          cv_pdf_path: null,
          cl_pdf_path: null,
          cv_drive_id: null,
          cl_drive_id: null,
          critic_verdict:
            (p.critic_verdict as Application["critic_verdict"]) ?? null,
          critic_score: p.critic_score,
          critic_notes: p.demo_critic_notes,
          status:
            p.status === "applied"
              ? "applied"
              : p.status === "response"
                ? "response"
                : "ready",
          written_at: p.last_action_at,
          applied_at:
            p.status === "applied" || p.status === "response"
              ? p.last_action_at
              : null,
          applied_via: null,
          response: null,
          response_at: p.status === "response" ? p.last_action_at : null,
          written_by: "scrittore-1",
          reviewed_by: "critico",
          applied: p.status === "applied" || p.status === "response",
          interview_round: null,
        }
      : null;
  const {
    demo_score_row,
    demo_highlights,
    demo_critic_notes,
    lat,
    lon,
    ...position
  } = p;
  void lat;
  void lon;
  void demo_critic_notes;
  return {
    position: position as Position,
    score: demo_score_row,
    highlights: demo_highlights,
    // [JHT-WEB-DEMO 25/07] Prima era `null`, e la card azienda non compariva
    // mai in demo. Il dossier è derivato in modo deterministico dai dati della
    // posizione (vedi seeds/companies.ts): senza logo, che un'azienda inventata
    // non può avere, e senza prosa da localizzare.
    company: demoCompanyFor({
      persona: key,
      name: p.company,
      location: p.location ?? null,
      score: p.score,
      analyzedAt: p.last_action_at,
    }),
    application,
    tickets: [],
  };
}

// ── Team activity demo ──────────────────────────────────────────────
// Gli eventi sono DERIVATI dalle stesse posizioni demo (stessa storia
// che l'utente vede in pipeline): trovata→scout, analizzata→analista,
// scored→scorer, CV scritto→scrittore, revisione→critico. Numeri e
// timeline quindi combaciano con dashboard e /positions.
function demoActivityEvents(rows: DemoPosition[]): TeamActivityEvent[] {
  const ev: TeamActivityEvent[] = [];
  for (const p of rows) {
    ev.push({
      role: "scout",
      actor: p.found_by ?? "scout",
      ts: p.found_at,
      pid: p.id,
    });
    if (p.last_checked)
      ev.push({
        role: "analista",
        actor: "analista",
        ts: p.last_checked,
        pid: p.id,
      });
    if (p.demo_score_row)
      ev.push({
        role: "scorer",
        actor: p.demo_score_row.scored_by ?? "scorer",
        ts: p.demo_score_row.scored_at,
        pid: p.id,
      });
    if (p.critic_score != null) {
      ev.push({
        role: "scrittore",
        actor: "scrittore-1",
        ts: p.last_action_at,
        pid: p.id,
      });
      ev.push({
        role: "critico",
        actor: "critico",
        ts: p.last_action_at,
        pid: p.id,
      });
    } else if (p.status === "writing") {
      ev.push({
        role: "scrittore",
        actor: "scrittore-1",
        ts: p.last_action_at,
        pid: p.id,
      });
    }
  }
  return ev;
}

function enrichDemoEvents(evts: RecentActivityEvent[], rows: DemoPosition[]) {
  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const e of evts) {
    const p = e.pid ? byId.get(e.pid) : undefined;
    if (!p) continue;
    e.title = p.title;
    e.company = p.company;
    e.legacyId = p.legacy_id;
    e.city = p.loc_city;
    if (e.role === "scorer") e.score = p.score;
    if (e.role === "scout") e.source = p.source;
  }
}

export async function demoTeamActivity(
  key: DemoPersonaKey,
  opts?: { from?: string; to?: string },
): Promise<TeamActivity> {
  const { from, to } = resolveActivityRange(opts, new Date());
  const rows = await data(key);
  const act = buildTeamActivity(demoActivityEvents(rows), from, to);
  enrichDemoEvents(act.recent, rows);
  return act;
}

export async function demoTeamActivityLog(
  key: DemoPersonaKey,
): Promise<RecentActivityEvent[]> {
  const rows = await data(key);
  const evts = demoActivityEvents(rows).sort((a, b) =>
    a.ts < b.ts ? 1 : -1,
  ) as RecentActivityEvent[];
  enrichDemoEvents(evts, rows);
  return evts;
}

// ── Messaggi demo dagli agenti ──────────────────────────────────────
// Tre messaggi (digest Capitano, domanda Assistente, coaching Mentor)
// localizzati nelle 7 lingue del sito, con titoli delle posizioni della
// persona interpolati — così il drawer messaggi in navbar è vivo anche
// in demo. Solo i tre agenti "conversazionali" scrivono all'utente
// (assistente/mentor/capitano, come CORE_AGENTS in MessagesList): gli
// operativi tipo Scout non mandano mai messaggi (feedback utente 23/07).
const MSG: Record<
  Locale,
  {
    capitano: (t: string, c: string) => string;
    assistente: string;
    mentor: (t: string, c: string) => string;
  }
> = {
  it: {
    capitano: (t, c) =>
      `Ho preparato 3 candidature ad alta priorità. Guarda prima "${t}" di ${c}: score alto e requisiti perfettamente allineati al tuo profilo.`,
    assistente:
      "Per calibrare meglio lo Scorer mi serve una preferenza: meglio più posizioni full remote o accetti l'ibrido se lo stipendio è sopra il tuo target?",
    mentor: (t, c) =>
      `Hai ricevuto una risposta da ${c} per "${t}": prepariamo il colloquio. Ti ho messo da parte 5 domande probabili e i punti del tuo percorso da mettere in evidenza.`,
  },
  en: {
    capitano: (t, c) =>
      `I prepared 3 high-priority applications. Check "${t}" at ${c} first: high score and requirements perfectly aligned with your profile.`,
    assistente:
      "To calibrate the Scorer I need one preference: more full-remote positions, or is hybrid fine when salary is above your target?",
    mentor: (t, c) =>
      `You got a reply from ${c} about "${t}": let's prep the interview. I set aside 5 likely questions and the parts of your background worth emphasising.`,
  },
  es: {
    capitano: (t, c) =>
      `He preparado 3 candidaturas de alta prioridad. Mira primero "${t}" en ${c}: puntuación alta y requisitos perfectamente alineados con tu perfil.`,
    assistente:
      "Para calibrar el Scorer necesito una preferencia: ¿más posiciones full remote o aceptas híbrido si el salario supera tu objetivo?",
    mentor: (t, c) =>
      `Has recibido respuesta de ${c} para "${t}": preparemos la entrevista. Te he apartado 5 preguntas probables y los puntos de tu trayectoria que conviene destacar.`,
  },
  fr: {
    capitano: (t, c) =>
      `J'ai préparé 3 candidatures prioritaires. Regarde d'abord « ${t} » chez ${c} : score élevé et exigences parfaitement alignées avec ton profil.`,
    assistente:
      "Pour calibrer le Scorer, j'ai besoin d'une préférence : plus de postes full remote, ou l'hybride te convient si le salaire dépasse ton objectif ?",
    mentor: (t, c) =>
      `Tu as reçu une réponse de ${c} pour « ${t} » : préparons l'entretien. Je t'ai mis de côté 5 questions probables et les points de ton parcours à mettre en avant.`,
  },
  de: {
    capitano: (t, c) =>
      `Ich habe 3 Bewerbungen mit hoher Priorität vorbereitet. Sieh dir zuerst „${t}" bei ${c} an: hoher Score und Anforderungen, die perfekt zu deinem Profil passen.`,
    assistente:
      "Um den Scorer zu kalibrieren, brauche ich eine Präferenz: mehr Full-Remote-Stellen, oder ist hybrid in Ordnung, wenn das Gehalt über deinem Ziel liegt?",
    mentor: (t, c) =>
      `Du hast eine Antwort von ${c} zu „${t}" erhalten: Bereiten wir das Gespräch vor. Ich habe 5 wahrscheinliche Fragen und die Stärken deines Werdegangs für dich zusammengestellt.`,
  },
  hu: {
    capitano: (t, c) =>
      `Előkészítettem 3 kiemelt jelentkezést. Nézd meg először a(z) „${t}" pozíciót a ${c} cégnél: magas pontszám, a követelmények tökéletesen illenek a profilodhoz.`,
    assistente:
      "A Scorer kalibrálásához kell egy preferencia: több teljesen távoli pozíció, vagy a hibrid is jó, ha a fizetés a célod felett van?",
    mentor: (t, c) =>
      `Választ kaptál a ${c} cégtől a(z) „${t}" pozícióra: készüljünk az interjúra. Összegyűjtöttem 5 valószínű kérdést és a hátterednek azokat a pontjait, amelyeket érdemes kiemelni.`,
  },
  pt: {
    capitano: (t, c) =>
      `Preparei 3 candidaturas de alta prioridade. Vê primeiro "${t}" na ${c}: pontuação alta e requisitos perfeitamente alinhados com o teu perfil.`,
    assistente:
      "Para calibrar o Scorer preciso de uma preferência: mais posições full remote, ou aceitas híbrido se o salário estiver acima do teu objetivo?",
    mentor: (t, c) =>
      `Recebeste resposta da ${c} para "${t}": vamos preparar a entrevista. Separei 5 perguntas prováveis e os pontos do teu percurso a destacar.`,
  },
};

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

export async function demoPendingMessages(
  key: DemoPersonaKey,
): Promise<PendingMessage[]> {
  const locale = await getRequestLocale();
  const m = MSG[locale] ?? MSG.it;
  const rows = await data(key);
  const top = rows
    .filter((p) => p.status !== "excluded" && p.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  // Il Mentor aggancia la posizione che ha ricevuto risposta (ce n'è
  // sempre almeno una nel dataset); fallback difensivo sulla top.
  const responded =
    rows
      .filter((p) => p.status === "response")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? top;
  const mk = (
    id: string,
    agent: string,
    body: string,
    kind: PendingMessage["kind"],
    h: number,
  ): PendingMessage => ({
    id,
    agent,
    body,
    kind,
    author: "agent",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: hoursAgoIso(h),
    acknowledged_at: null,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: hoursAgoIso(h),
  });
  return [
    mk(
      "demo-msg-1",
      "capitano",
      m.capitano(top?.title ?? "-", top?.company ?? "-"),
      "digest",
      1,
    ),
    mk("demo-msg-2", "assistente", m.assistente, "question", 4),
    mk(
      "demo-msg-3",
      "mentor",
      m.mentor(responded?.title ?? "-", responded?.company ?? "-"),
      "notification",
      9,
    ),
  ];
}
