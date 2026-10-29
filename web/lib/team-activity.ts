// Aggregazione attività del team — fondamento condiviso tra il path SQLite
// locale (local-queries) e il path Supabase (queries). Entrambi raccolgono la
// stessa lista di eventi grezzi { role, actor, ts } e la passano a
// buildTeamActivity su un range [from, to] esplicito, così le tre viste
// (leaderboard / timeline / heatmap) mostrano numeri identici qualunque sia la
// fonte e qualunque sia il range scelto dall'utente.
//
// Granularità: per ISTANZA di agente (es. scout-1, scout-2), non solo per
// ruolo. L'id istanza viene dalle colonne *_by:
//   scout     → positions.found_at        / found_by
//   scorer    → scores.scored_at          / scored_by
//   scrittore → applications.written_at    / written_by
//   critico   → applications.critic_reviewed_at / reviewed_by
//   analista  → positions.last_checked     / (nessun id istanza) → 'analista'
// Tutte le sorgenti vivono su tabelle sincronizzate su Supabase (companies,
// che porterebbe analyzed_by, NON è sincronizzata — gap noto: la evitiamo).

export type TeamActivityRole =
  | "scout"
  | "analista"
  | "scorer"
  | "scrittore"
  | "critico";

export const TEAM_ACTIVITY_ROLES: TeamActivityRole[] = [
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
];

// Limiti del range custom (giorni). Oltre MAX la heatmap diventa illeggibile e
// le query cloud rischiano di sforare il cap righe → clampiamo.
export const ACTIVITY_RANGE_MAX_DAYS = 366;
export const ACTIVITY_DEFAULT_DAYS = 30;

export interface TeamActivityEvent {
  role: TeamActivityRole;
  actor: string; // id istanza già normalizzato (es. 'scout-1' o, in fallback, il ruolo)
  ts: string; // timestamp ISO-ish ('YYYY-MM-DD...'); slice(0,10) = giorno
  pid: string | null; // id della posizione gestita (positions.id) → link al dettaglio
}

// Evento del feed "Attività recente", arricchito col contesto della posizione
// (titolo/azienda/id leggibile) tramite una query mirata sui soli pid recenti.
export interface RecentActivityEvent extends TeamActivityEvent {
  title?: string | null;
  company?: string | null;
  legacyId?: number | null;
  // Contesto extra per rendere il feed più parlante:
  // - score: il punteggio assegnato (eventi scorer) → 0-100
  // - source: la fonte dove la posizione è stata trovata (eventi scout)
  // - city: la città della posizione (es. "Berlino", "Lisbona")
  score?: number | null;
  source?: string | null;
  city?: string | null;
}

// Normalizza l'id istanza: trim + lowercase; vuoto/null → nome del ruolo.
// Il lowercase unifica varianti di casing reali (es. 'critico-s1' / 'CRITICO-S1').
export function normActor(
  role: TeamActivityRole,
  raw: string | null | undefined,
): string {
  const v = (raw ?? "").trim().toLowerCase();
  return v.length > 0 ? v : role;
}

export interface TeamActivityActor {
  actor: string;
  role: TeamActivityRole;
  daily: number[]; // lunghezza = dates.length, allineato a dates[]
  total: number; // azioni nel range
  lastActiveAt: string | null;
}

export interface TeamActivityRoleDay {
  date: string; // YYYY-MM-DD
  counts: Record<TeamActivityRole, number>;
}

export interface TeamActivity {
  from: string; // YYYY-MM-DD (inclusivo)
  to: string; // YYYY-MM-DD (inclusivo)
  days: number; // numero di giorni nel range
  generatedAt: string; // ISO now (server)
  dates: string[]; // asse dei giorni (YYYY-MM-DD), cronologico, zero-filled
  roles: TeamActivityRole[];
  actors: TeamActivityActor[]; // una entry per istanza
  roleDaily: TeamActivityRoleDay[]; // somma per ruolo/giorno (per la timeline)
  roleTotals: Record<TeamActivityRole, number>;
  totalAll: number;
  recent: RecentActivityEvent[]; // ultimi eventi nel range, ts desc (max RECENT_LIMIT), arricchiti
  timeline: TeamActivityEvent[]; // eventi nel range per lo scatter temporale (cap TIMELINE_LIMIT)
}

export const RECENT_LIMIT = 40;
export const TIMELINE_LIMIT = 2500;

function emptyCounts(): Record<TeamActivityRole, number> {
  return { scout: 0, analista: 0, scorer: 0, scrittore: 0, critico: 0 };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDay(s: string | null | undefined): s is string {
  if (!s || !DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t);
}

// Aggiunge n giorni (anche negativi) a una chiave 'YYYY-MM-DD' (UTC).
export function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Numero di giorni inclusivi tra due chiavi (from<=to).
function spanDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86400000) + 1;
}

// Risolve il range richiesto dall'utente in chiavi giorno valide e clampate.
// Default: ultimi ACTIVITY_DEFAULT_DAYS giorni fino a oggi. Garantisce
// from<=to e ampiezza <= ACTIVITY_RANGE_MAX_DAYS.
export function resolveActivityRange(
  opts: { from?: string; to?: string } | undefined,
  now: Date,
): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  let to = isValidDay(opts?.to) ? opts!.to! : today;
  let from = isValidDay(opts?.from)
    ? opts!.from!
    : addDaysKey(to, -(ACTIVITY_DEFAULT_DAYS - 1));
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  if (spanDays(from, to) > ACTIVITY_RANGE_MAX_DAYS) {
    from = addDaysKey(to, -(ACTIVITY_RANGE_MAX_DAYS - 1));
  }
  return { from, to };
}

export function buildTeamActivity(
  events: TeamActivityEvent[],
  fromKey: string,
  toKey: string,
): TeamActivity {
  // Asse dei giorni zero-filled da fromKey a toKey inclusi (UTC).
  const dates: string[] = [];
  const dayIndex = new Map<string, number>();
  let cur = fromKey;
  let guard = 0;
  while (cur <= toKey && guard <= ACTIVITY_RANGE_MAX_DAYS + 1) {
    dayIndex.set(cur, dates.length);
    dates.push(cur);
    cur = addDaysKey(cur, 1);
    guard++;
  }

  const actorMap = new Map<string, TeamActivityActor>();
  const roleDaily: TeamActivityRoleDay[] = dates.map((date) => ({
    date,
    counts: emptyCounts(),
  }));
  const roleTotals = emptyCounts();
  let totalAll = 0;
  const recentPool: TeamActivityEvent[] = [];

  for (const ev of events) {
    const key = ev.ts && ev.ts.length >= 10 ? ev.ts.slice(0, 10) : null;
    if (!key) continue;

    const akey = `${ev.role} ${ev.actor}`;
    let a = actorMap.get(akey);
    if (!a) {
      a = {
        actor: ev.actor,
        role: ev.role,
        daily: new Array(dates.length).fill(0),
        total: 0,
        lastActiveAt: null,
      };
      actorMap.set(akey, a);
    }
    // Ultimo visto: confronto stringa ISO (monotòno per timestamp ben formati).
    if (!a.lastActiveAt || ev.ts > a.lastActiveAt) a.lastActiveAt = ev.ts;

    const idx = dayIndex.get(key);
    if (idx === undefined) continue; // fuori range: conta solo per lastActiveAt
    a.daily[idx]++;
    a.total++;
    roleDaily[idx].counts[ev.role]++;
    roleTotals[ev.role]++;
    totalAll++;
    recentPool.push(ev);
  }

  // Feed "Attività recente": ultimi eventi nel range, dal più recente.
  recentPool.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  const recent = recentPool.slice(0, RECENT_LIMIT);
  const timeline = recentPool.slice(0, TIMELINE_LIMIT);

  return {
    from: fromKey,
    to: toKey,
    days: dates.length,
    generatedAt: new Date().toISOString(),
    dates,
    roles: TEAM_ACTIVITY_ROLES,
    actors: [...actorMap.values()],
    roleDaily,
    roleTotals,
    totalAll,
    recent,
    timeline,
  };
}

// ── The same activity, from counts made at the source ───────────────────
// A reader that sits next to the team's database (the desktop's, for a profile with no cloud account) counts
// per role, instance and day there, so that its reply does not grow with the history. This builds from them
// what `buildTeamActivity` builds from every event: the same days, the same totals, the same instances.
export interface TeamActivityCounts {
  /** Events per role, raw instance id and day, inside the range. */
  daily: { role: string; actor: string | null; day: string; n: number }[];
  /** The newest events inside the range, any order. */
  newest: { role: string; actor: string | null; ts: string | null; pid: string | null }[];
  /** The last event of each instance, whatever the range. */
  seen: { role: string; actor: string | null; last: string | null }[];
  /** The positions of the newest events: what the feed shows next to them. */
  meta: Record<string, { legacy_id: number | null; title: string | null; company: string | null }>;
}

const KNOWN_ROLES = new Set<string>(TEAM_ACTIVITY_ROLES);

export function buildTeamActivityFromCounts(
  counts: TeamActivityCounts,
  fromKey: string,
  toKey: string,
): TeamActivity {
  const dates: string[] = [];
  const dayIndex = new Map<string, number>();
  let cur = fromKey;
  let guard = 0;
  while (cur <= toKey && guard <= ACTIVITY_RANGE_MAX_DAYS + 1) {
    dayIndex.set(cur, dates.length);
    dates.push(cur);
    cur = addDaysKey(cur, 1);
    guard++;
  }
  const actorMap = new Map<string, TeamActivityActor>();
  const roleDaily: TeamActivityRoleDay[] = dates.map((date) => ({ date, counts: emptyCounts() }));
  const roleTotals = emptyCounts();
  let totalAll = 0;
  const actorOf = (role: TeamActivityRole, raw: string | null): TeamActivityActor => {
    const actor = normActor(role, raw);
    const key = `${role} ${actor}`;
    let found = actorMap.get(key);
    if (!found) {
      found = { actor, role, daily: new Array(dates.length).fill(0), total: 0, lastActiveAt: null };
      actorMap.set(key, found);
    }
    return found;
  };

  for (const row of counts.seen) {
    if (!KNOWN_ROLES.has(row.role)) continue;
    const a = actorOf(row.role as TeamActivityRole, row.actor);
    if (row.last && (!a.lastActiveAt || row.last > a.lastActiveAt)) a.lastActiveAt = row.last;
  }
  for (const row of counts.daily) {
    if (!KNOWN_ROLES.has(row.role) || !Number.isInteger(row.n) || row.n < 0) continue;
    const idx = dayIndex.get(row.day);
    if (idx === undefined) continue;
    const role = row.role as TeamActivityRole;
    const a = actorOf(role, row.actor);
    a.daily[idx] += row.n;
    a.total += row.n;
    roleDaily[idx].counts[role] += row.n;
    roleTotals[role] += row.n;
    totalAll += row.n;
  }

  const pool: TeamActivityEvent[] = counts.newest
    .filter((ev): ev is typeof ev & { ts: string } => KNOWN_ROLES.has(ev.role) && !!ev.ts && ev.ts.length >= 10)
    .map((ev) => ({
      role: ev.role as TeamActivityRole,
      actor: normActor(ev.role as TeamActivityRole, ev.actor),
      ts: ev.ts,
      pid: ev.pid,
    }));
  pool.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  const recent: RecentActivityEvent[] = pool.slice(0, RECENT_LIMIT);
  for (const ev of recent) {
    const m = ev.pid ? counts.meta[ev.pid] : undefined;
    if (m) {
      ev.title = m.title;
      ev.company = m.company;
      ev.legacyId = m.legacy_id;
    }
  }
  return {
    from: fromKey,
    to: toKey,
    days: dates.length,
    generatedAt: new Date().toISOString(),
    dates,
    roles: TEAM_ACTIVITY_ROLES,
    actors: [...actorMap.values()],
    roleDaily,
    roleTotals,
    totalAll,
    recent,
    timeline: pool.slice(0, TIMELINE_LIMIT),
  };
}
